import { losesEvidence } from "../services/match-completeness";
import { Database } from "bun:sqlite";
import { query, transaction } from "./query";

import { normalizeMapSpatialPosition } from "../domain/map-spatial-resources";
import type { MatchDetail } from "../domain/types";
import { nearestMapCallout } from "../mcp/game-knowledge";
import { MatchRoundEvidenceService } from "../services/match-round-evidence-service";
import {
  MatchCacheError,
  matchBaseProjectionVersion,
  matchFocusProjectionVersion,
  type CachedFocusProjectionRead,
  type CachedMatchRead,
  type MatchCache,
  type SaveMatchInput,
  type SaveMatchResult,
} from "./match-cache";
import { matchCompletenessScore, matchPayloadId, scrubSensitive, sha256, stableJson } from "./match-cache-projector";
import { prepareMatchCachePath, resolveMatchCachePath, restrictMatchCacheFile } from "./match-cache-path";

const schemaVersion = 3;

type MatchRow = {
  match_id: string;
  platform: string;
  region: string;
  raw_json: string;
  payload_hash: string;
  completeness_score: number;
  source_endpoint: "recent-list-v4" | "match-detail-v4";
  base_projection_json: string | null;
  base_projection_version: string | null;
  base_projection_input_hash: string | null;
  first_saved_at: string;
};

type FocusRow = {
  projection_json: string;
  projected_at: string;
  input_payload_hash: string;
};

export class SqliteMatchCache implements MatchCache {
  private constructor(
    private readonly db: Database,
    readonly path: string,
  ) {}

  static open(path: string): SqliteMatchCache {
    prepareMatchCachePath(path);
    let db: Database;
    try {
      db = new Database(path, { create: true });
      restrictMatchCacheFile(path);
      migrate(db);
    } catch (error) {
      throw new MatchCacheError("Could not open the local Valorant match cache", { cause: error });
    }
    return new SqliteMatchCache(db, path);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SqliteMatchCache {
    return SqliteMatchCache.open(resolveMatchCachePath(env));
  }

  readMatch(matchId: string, platform: string): CachedMatchRead | null {
    const row = query(
      this.db,
      `SELECT match_id, platform, region, raw_json, payload_hash, completeness_score, source_endpoint,
              base_projection_json, base_projection_version, base_projection_input_hash, first_saved_at
       FROM cached_matches WHERE match_id = ? AND platform = ? LIMIT 1`,
    ).get(matchId, platform) as MatchRow | null;
    if (!row) return null;
    let raw: unknown;
    let baseProjection: MatchDetail | null = null;
    try {
      raw = JSON.parse(row.raw_json);
    } catch (error) {
      throw new MatchCacheError(`Cached match ${matchId} contains invalid raw JSON`, { cause: error });
    }
    if (
      row.base_projection_json &&
      row.base_projection_version === matchBaseProjectionVersion &&
      row.base_projection_input_hash === row.payload_hash
    ) {
      try {
        baseProjection = JSON.parse(row.base_projection_json) as MatchDetail;
      } catch {
        // The raw provider payload remains authoritative and can regenerate this projection locally.
        baseProjection = null;
      }
    }
    query(this.db, `UPDATE cached_matches SET last_accessed_at = ? WHERE match_id = ? AND platform = ?`).run(
      new Date().toISOString(),
      matchId,
      platform,
    );
    return {
      matchId: row.match_id,
      platform: row.platform,
      region: row.region,
      raw,
      rawJson: row.raw_json,
      payloadHash: row.payload_hash,
      completenessScore: row.completeness_score,
      savedAt: row.first_saved_at,
      sourceEndpoint: row.source_endpoint,
      baseProjection,
      baseProjectionVersion: row.base_projection_version,
      baseProjectionInputHash: row.base_projection_input_hash,
    };
  }

  readFocusProjection(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    payloadHash: string,
  ): CachedFocusProjectionRead | null {
    const row = query(
      this.db,
      `SELECT projection_json, projected_at, input_payload_hash
       FROM cached_focus_projections
       WHERE match_id = ? AND platform = ? AND focus_key = ?
         AND projection_version = ? AND input_payload_hash = ?
       LIMIT 1`,
    ).get(matchId, platform, focusKey(focusPuuid), matchFocusProjectionVersion, payloadHash) as FocusRow | null;
    if (!row) return null;
    try {
      return {
        detail: { ...(JSON.parse(row.projection_json) as MatchDetail), source: "cache" },
        savedAt: row.projected_at,
        payloadHash: row.input_payload_hash,
      };
    } catch (error) {
      throw new MatchCacheError(`Cached focus projection for ${matchId} contains invalid JSON`, { cause: error });
    }
  }

  saveMatch(input: SaveMatchInput): SaveMatchResult {
    const scrubbed = scrubSensitive(input.raw);
    const payloadId = matchPayloadId(scrubbed);
    if (payloadId !== input.matchId) {
      throw new MatchCacheError(`Refusing to cache mismatched match payload for ${input.matchId}`);
    }
    const rawJson = stableJson(scrubbed);
    const payloadHash = sha256(rawJson);
    const score = matchCompletenessScore(input.baseProjection);
    const now = new Date().toISOString();
    return transaction(this.db, () => {
      const existing = query(
        this.db,
        `SELECT payload_hash, completeness_score, first_saved_at, source_endpoint, base_projection_json
         FROM cached_matches WHERE match_id = ? AND platform = ? LIMIT 1`,
      ).get(input.matchId, input.platform) as {
        payload_hash: string;
        completeness_score: number;
        first_saved_at: string;
        source_endpoint: string;
        base_projection_json: string | null;
      } | null;
      const existingIsRicher =
        existing &&
        ((existing.payload_hash !== payloadHash &&
          existing.base_projection_json !== null &&
          losesEvidence(JSON.parse(existing.base_projection_json) as MatchDetail, input.baseProjection)) ||
          existing.completeness_score > score ||
          (existing.completeness_score === score &&
            existing.source_endpoint === "match-detail-v4" &&
            input.sourceEndpoint === "recent-list-v4"));
      if (existingIsRicher) {
        query(
          this.db,
          `UPDATE cached_matches SET last_accessed_at = ?, last_validated_at = ?
           WHERE match_id = ? AND platform = ?`,
        ).run(now, now, input.matchId, input.platform);
        return { savedAt: existing.first_saved_at, payloadHash: existing.payload_hash, projected: false };
      }

      const projectionJson = stableJson({ ...input.baseProjection, source: "cache" });
      query(
        this.db,
        `INSERT INTO cached_matches (
          match_id, platform, region, mode, map_name, season_id, game_version, started_at, duration_ms,
          raw_json, payload_hash, completeness_score, completeness_json, source_endpoint,
          base_projection_json, base_projection_version, base_projection_input_hash,
          first_saved_at, last_validated_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, platform) DO UPDATE SET
          region = excluded.region,
          mode = excluded.mode,
          map_name = excluded.map_name,
          season_id = excluded.season_id,
          game_version = excluded.game_version,
          started_at = excluded.started_at,
          duration_ms = excluded.duration_ms,
          raw_json = excluded.raw_json,
          payload_hash = excluded.payload_hash,
          completeness_score = excluded.completeness_score,
          completeness_json = excluded.completeness_json,
          source_endpoint = excluded.source_endpoint,
          base_projection_json = excluded.base_projection_json,
          base_projection_version = excluded.base_projection_version,
          base_projection_input_hash = excluded.base_projection_input_hash,
          last_validated_at = excluded.last_validated_at,
          last_accessed_at = excluded.last_accessed_at`,
      ).run(
        input.matchId,
        input.platform,
        input.region,
        input.baseProjection.mode,
        input.baseProjection.mapName,
        seasonId(scrubbed),
        input.baseProjection.gameVersion,
        input.baseProjection.startedAt,
        input.baseProjection.durationMs,
        rawJson,
        payloadHash,
        score,
        stableJson(completeness(input.baseProjection)),
        input.sourceEndpoint,
        projectionJson,
        matchBaseProjectionVersion,
        payloadHash,
        existing?.first_saved_at ?? now,
        now,
        now,
      );
      replaceNormalizedRows(this.db, input.baseProjection);
      if (existing && existing.payload_hash !== payloadHash) {
        query(this.db, `DELETE FROM cached_focus_projections WHERE match_id = ? AND platform = ?`).run(
          input.matchId,
          input.platform,
        );
        query(this.db, `DELETE FROM cached_derived_projections WHERE match_id = ? AND platform = ?`).run(
          input.matchId,
          input.platform,
        );
      }
      return { savedAt: existing?.first_saved_at ?? now, payloadHash, projected: true };
    });
  }

  saveFocusProjection(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    payloadHash: string,
    detail: MatchDetail,
  ): void {
    const now = new Date().toISOString();
    query(
      this.db,
      `INSERT INTO cached_focus_projections (
        match_id, platform, focus_key, projection_version, input_payload_hash, projection_json, projected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id, platform, focus_key) DO UPDATE SET
        projection_version = excluded.projection_version,
        input_payload_hash = excluded.input_payload_hash,
        projection_json = excluded.projection_json,
        projected_at = excluded.projected_at`,
    ).run(
      matchId,
      platform,
      focusKey(focusPuuid),
      matchFocusProjectionVersion,
      payloadHash,
      stableJson({ ...detail, source: "cache" }),
      now,
    );
  }

  readDerivedProjection<T>(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    kind: string,
    version: string,
    payloadHash: string,
  ): T | null {
    const row = query(
      this.db,
      `SELECT projection_json FROM cached_derived_projections
       WHERE match_id = ? AND platform = ? AND focus_key = ? AND projection_kind = ?
         AND projection_version = ? AND input_payload_hash = ?
       LIMIT 1`,
    ).get(matchId, platform, focusKey(focusPuuid), kind, version, payloadHash) as { projection_json: string } | null;
    if (!row) return null;
    try {
      return JSON.parse(row.projection_json) as T;
    } catch (error) {
      throw new MatchCacheError(`Cached ${kind} projection for ${matchId} contains invalid JSON`, { cause: error });
    }
  }

  saveDerivedProjection(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    kind: string,
    version: string,
    payloadHash: string,
    value: unknown,
  ): void {
    query(
      this.db,
      `INSERT INTO cached_derived_projections (
        match_id, platform, focus_key, projection_kind, projection_version,
        input_payload_hash, projection_json, projected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id, platform, focus_key, projection_kind) DO UPDATE SET
        projection_version = excluded.projection_version,
        input_payload_hash = excluded.input_payload_hash,
        projection_json = excluded.projection_json,
        projected_at = excluded.projected_at`,
    ).run(
      matchId,
      platform,
      focusKey(focusPuuid),
      kind,
      version,
      payloadHash,
      stableJson(value),
      new Date().toISOString(),
    );
  }

  countMatches(): number {
    return (query(this.db, `SELECT COUNT(*) AS count FROM cached_matches`).get() as { count: number }).count;
  }

  close(): void {
    this.db.close(true);
  }
}

function migrate(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS cached_matches (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      region TEXT NOT NULL,
      mode TEXT NOT NULL,
      map_name TEXT,
      season_id TEXT,
      game_version TEXT,
      started_at TEXT,
      duration_ms INTEGER,
      raw_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      completeness_score INTEGER NOT NULL,
      completeness_json TEXT NOT NULL,
      source_endpoint TEXT NOT NULL,
      base_projection_json TEXT,
      base_projection_version TEXT,
      base_projection_input_hash TEXT,
      first_saved_at TEXT NOT NULL,
      last_validated_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      PRIMARY KEY (match_id, platform)
    );
    CREATE INDEX IF NOT EXISTS cached_matches_history
      ON cached_matches (started_at DESC, match_id);

    CREATE TABLE IF NOT EXISTS cached_focus_projections (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      focus_key TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      input_payload_hash TEXT NOT NULL,
      projection_json TEXT NOT NULL,
      projected_at TEXT NOT NULL,
      PRIMARY KEY (match_id, platform, focus_key),
      FOREIGN KEY (match_id, platform) REFERENCES cached_matches(match_id, platform) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cached_derived_projections (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      focus_key TEXT NOT NULL,
      projection_kind TEXT NOT NULL,
      projection_version TEXT NOT NULL,
      input_payload_hash TEXT NOT NULL,
      projection_json TEXT NOT NULL,
      projected_at TEXT NOT NULL,
      PRIMARY KEY (match_id, platform, focus_key, projection_kind),
      FOREIGN KEY (match_id, platform) REFERENCES cached_matches(match_id, platform) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cached_match_players (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      puuid TEXT NOT NULL,
      game_name TEXT NOT NULL,
      tag_line TEXT,
      team_id TEXT NOT NULL,
      party_id TEXT,
      agent_name TEXT,
      tier_id INTEGER,
      tier_name TEXT,
      score INTEGER,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      acs REAL,
      adr REAL,
      kast REAL,
      damage_delta REAL,
      headshot_rate REAL,
      economy_json TEXT NOT NULL,
      ability_casts_json TEXT NOT NULL,
      PRIMARY KEY (match_id, platform, puuid),
      FOREIGN KEY (match_id, platform) REFERENCES cached_matches(match_id, platform) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS cached_match_players_by_player
      ON cached_match_players (puuid, match_id);

    CREATE TABLE IF NOT EXISTS cached_match_rounds (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      winning_team TEXT,
      result TEXT,
      ceremony TEXT,
      spike_plant_json TEXT,
      spike_defuse_json TEXT,
      team_scores_json TEXT NOT NULL,
      PRIMARY KEY (match_id, platform, round_number),
      FOREIGN KEY (match_id, platform) REFERENCES cached_matches(match_id, platform) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cached_round_players (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      player_key TEXT NOT NULL,
      puuid TEXT,
      game_name TEXT NOT NULL,
      tag_line TEXT,
      team_id TEXT,
      score INTEGER,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      loadout_value INTEGER,
      remaining_credits INTEGER,
      weapon_name TEXT,
      armor_name TEXT,
      damage_events_json TEXT NOT NULL,
      ability_casts_json TEXT NOT NULL,
      evidence_flags_json TEXT NOT NULL,
      PRIMARY KEY (match_id, platform, round_number, player_key),
      FOREIGN KEY (match_id, platform, round_number) REFERENCES cached_match_rounds(match_id, platform, round_number) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cached_kill_events (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      event_index INTEGER NOT NULL,
      raw_round INTEGER,
      time_in_round_ms INTEGER,
      time_in_match_ms INTEGER,
      killer_puuid TEXT,
      killer_name TEXT NOT NULL,
      killer_team TEXT,
      victim_puuid TEXT,
      victim_name TEXT NOT NULL,
      victim_team TEXT,
      weapon_name TEXT,
      assistants_json TEXT NOT NULL,
      victim_x REAL,
      victim_y REAL,
      distance_meters REAL,
      PRIMARY KEY (match_id, platform, event_index),
      FOREIGN KEY (match_id, platform) REFERENCES cached_matches(match_id, platform) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cached_event_positions (
      match_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      event_index INTEGER NOT NULL,
      position_index INTEGER NOT NULL,
      puuid TEXT,
      game_name TEXT NOT NULL,
      tag_line TEXT,
      team_id TEXT,
      agent_name TEXT,
      raw_x REAL NOT NULL,
      raw_y REAL NOT NULL,
      map_x REAL,
      map_y REAL,
      view_radians REAL,
      map_facing_radians REAL,
      callout_name TEXT,
      callout_distance REAL,
      callout_confidence TEXT,
      PRIMARY KEY (match_id, platform, event_index, position_index),
      FOREIGN KEY (match_id, platform, event_index) REFERENCES cached_kill_events(match_id, platform, event_index) ON DELETE CASCADE
    );
  `);
  ensureColumn(db, "cached_round_players", "deaths", "deaths INTEGER");
  ensureColumn(db, "cached_round_players", "assists", "assists INTEGER");
  const version = (query(db, `PRAGMA user_version`).get() as { user_version: number }).user_version;
  if (version > schemaVersion)
    throw new MatchCacheError(`Match cache schema ${version} is newer than supported schema ${schemaVersion}`);
  db.exec(`PRAGMA user_version = ${schemaVersion}`);
}

function replaceNormalizedRows(db: Database, detail: MatchDetail): void {
  const key = [detail.matchId, detail.platform];
  query(db, `DELETE FROM cached_event_positions WHERE match_id = ? AND platform = ?`).run(...key);
  query(db, `DELETE FROM cached_kill_events WHERE match_id = ? AND platform = ?`).run(...key);
  query(db, `DELETE FROM cached_round_players WHERE match_id = ? AND platform = ?`).run(...key);
  query(db, `DELETE FROM cached_match_rounds WHERE match_id = ? AND platform = ?`).run(...key);
  query(db, `DELETE FROM cached_match_players WHERE match_id = ? AND platform = ?`).run(...key);

  const playerByKey = new Map<
    string,
    { puuid: string | null; gameName: string; tagLine: string | null; teamId: string; agentName: string | null }
  >();
  for (const team of detail.teams) {
    for (const player of team.players) {
      const keyValue = player.puuid ?? `${player.gameName.toLowerCase()}#${player.tagLine?.toLowerCase() ?? ""}`;
      playerByKey.set(keyValue, player);
      query(
        db,
        `INSERT INTO cached_match_players (
          match_id, platform, puuid, game_name, tag_line, team_id, party_id, agent_name,
          tier_id, tier_name, score, kills, deaths, assists, acs, adr, kast, damage_delta,
          headshot_rate, economy_json, ability_casts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        detail.matchId,
        detail.platform,
        player.puuid ?? keyValue,
        player.gameName,
        player.tagLine,
        player.teamId,
        player.partyId,
        player.agentName,
        player.tierId,
        player.tierName,
        player.score,
        player.kills,
        player.deaths,
        player.assists,
        player.acs,
        player.adr,
        player.kast,
        player.damageDelta,
        player.headshotRate,
        stableJson({
          spentOverall: player.spentOverall,
          spentAverage: player.spentAverage,
          loadoutOverall: player.loadoutOverall,
          loadoutAverage: player.loadoutAverage,
        }),
        stableJson(player.abilityCasts),
      );
    }
  }

  const roundEvidence = new MatchRoundEvidenceService().analyze(detail);
  for (const round of detail.rounds) {
    query(
      db,
      `INSERT INTO cached_match_rounds (
        match_id, platform, round_number, winning_team, result, ceremony,
        spike_plant_json, spike_defuse_json, team_scores_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      detail.matchId,
      detail.platform,
      round.number,
      round.winningTeam,
      round.result,
      round.ceremony,
      round.spikePlant ? stableJson(round.spikePlant) : null,
      round.spikeDefuse ? stableJson(round.spikeDefuse) : null,
      stableJson(round.teamScores),
    );
    round.playerStats.forEach((player, index) => {
      const identityKey = `${player.gameName.toLowerCase()}#${player.tagLine?.toLowerCase() ?? ""}`;
      const playerKey = player.puuid ?? (identityKey || String(index));
      const evidencePlayer = roundEvidence?.rounds
        .find((row) => row.roundNumber === round.number)
        ?.players.find((candidate) =>
          player.puuid && candidate.puuid
            ? player.puuid === candidate.puuid
            : identityKey === `${candidate.gameName.toLowerCase()}#${candidate.tagLine?.toLowerCase() ?? ""}`,
        );
      query(
        db,
        `INSERT INTO cached_round_players (
          match_id, platform, round_number, player_key, puuid, game_name, tag_line, team_id,
          score, kills, deaths, assists, loadout_value, remaining_credits, weapon_name, armor_name,
          damage_events_json, ability_casts_json, evidence_flags_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        detail.matchId,
        detail.platform,
        round.number,
        playerKey,
        player.puuid,
        player.gameName,
        player.tagLine,
        player.teamId,
        player.score,
        player.kills,
        evidencePlayer?.deaths ?? null,
        evidencePlayer?.assists ?? null,
        player.loadoutValue,
        player.remainingCredits,
        player.weaponName,
        player.armorName,
        stableJson(player.damageEvents),
        stableJson(player.abilityCasts),
        stableJson({
          wasAfk: player.wasAfk,
          receivedPenalty: player.receivedPenalty,
          stayedInSpawn: player.stayedInSpawn,
        }),
      );
    });
  }

  detail.killEvents.forEach((event, eventIndex) => {
    query(
      db,
      `INSERT INTO cached_kill_events (
        match_id, platform, event_index, raw_round, time_in_round_ms, time_in_match_ms,
        killer_puuid, killer_name, killer_team, victim_puuid, victim_name, victim_team,
        weapon_name, assistants_json, victim_x, victim_y, distance_meters
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      detail.matchId,
      detail.platform,
      eventIndex,
      event.round,
      event.timeInRoundMs,
      event.timeInMatchMs,
      event.killerPuuid,
      event.killerName,
      event.killerTeam,
      event.victimPuuid,
      event.victimName,
      event.victimTeam,
      event.weaponName,
      stableJson({ names: event.assistants, puuids: event.assistantPuuids }),
      event.victimLocation?.x ?? null,
      event.victimLocation?.y ?? null,
      event.distanceMeters,
    );
    event.playerLocations.forEach((location, positionIndex) => {
      const normalized = normalizeMapSpatialPosition(detail.mapName, location.location);
      const callout = nearestMapCallout(detail.mapName, location.location);
      const rosterKey = location.puuid ?? `${location.gameName.toLowerCase()}#${location.tagLine?.toLowerCase() ?? ""}`;
      const roster = playerByKey.get(rosterKey);
      query(
        db,
        `INSERT INTO cached_event_positions (
          match_id, platform, event_index, position_index, puuid, game_name, tag_line, team_id,
          agent_name, raw_x, raw_y, map_x, map_y, view_radians, map_facing_radians,
          callout_name, callout_distance, callout_confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        detail.matchId,
        detail.platform,
        eventIndex,
        positionIndex,
        location.puuid,
        location.gameName,
        location.tagLine,
        location.teamId,
        roster?.agentName ?? null,
        location.location.x,
        location.location.y,
        normalized?.x ?? null,
        normalized?.y ?? null,
        location.viewRadians,
        normalized && location.viewRadians !== null
          ? mapFacing(detail.mapName, location.location, location.viewRadians)
          : null,
        callout?.name ?? null,
        callout?.distanceMeters ?? null,
        callout?.confidence ?? null,
      );
    });
  });
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const columns = query(db, `PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function focusKey(focusPuuid: string | null): string {
  return focusPuuid?.trim() || "__none__";
}

function completeness(detail: MatchDetail): Record<string, number> {
  return {
    players: detail.teams.reduce((count, team) => count + team.players.length, 0),
    rounds: detail.rounds.length,
    killEvents: detail.killEvents.length,
    positionedKillEvents: detail.killEvents.filter((event) => event.victimLocation || event.playerLocations.length)
      .length,
    roundPlayerRows: detail.rounds.reduce((count, round) => count + round.playerStats.length, 0),
  };
}

function seasonId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const metadata = (raw as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const season = (metadata as Record<string, unknown>).season;
  if (!season || typeof season !== "object" || Array.isArray(season)) return null;
  return typeof (season as Record<string, unknown>).id === "string" ? (season as Record<string, string>).id : null;
}

function mapFacing(mapName: string | null, location: { x: number; y: number }, viewRadians: number): number | null {
  const start = normalizeMapSpatialPosition(mapName, location);
  const end = normalizeMapSpatialPosition(mapName, {
    x: location.x + Math.cos(viewRadians) * 1_000,
    y: location.y + Math.sin(viewRadians) * 1_000,
  });
  return start && end ? Math.atan2(end.y - start.y, end.x - start.x) : null;
}
