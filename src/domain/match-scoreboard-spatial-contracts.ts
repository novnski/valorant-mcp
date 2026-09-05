import { killRoundOffset } from "../services/match-kill-round";
import type { MatchDetail, MatchPlayerDetail } from "./types";
import { inferInitialAttackerTeam, sideForRound } from "../services/match-side";
import { normalizeMapSpatialPosition, normalizedMapSpatialResource } from "./map-spatial-resources";

export const USER_MATCH_SCOREBOARD_VERSION = "user-match-scoreboard-v1" as const;
export const USER_SPATIAL_EVIDENCE_VERSION = "user-spatial-evidence-v1" as const;

export type UserMatchScoreboardProjectionV1 = {
  version: typeof USER_MATCH_SCOREBOARD_VERSION;
  matchId: string;
  teams: Array<{
    teamId: string;
    players: Array<{
      puuid: string | null;
      riotId: string;
      utility: {
        totalCasts: number | null;
        grenade: number | null;
        ability1: number | null;
        ability2: number | null;
        ultimate: number | null;
      };
      trades: { kills: number; perRound: number | null } | null;
      clutches: { labels: string[] } | null;
      multikills: { highest: number | null; threePlusRounds: number | null };
      economy: { averageSpend: number | null; averageLoadout: number | null };
    }>;
  }>;
  limitations: string[];
};

export type UserSpatialEvidenceProjectionV1 = {
  version: typeof USER_SPATIAL_EVIDENCE_VERSION;
  matchId: string;
  map: { name: string; assetUrl: string; width: 1; height: 1 } | null;
  unavailableReason: string | null;
  options: {
    teams: Array<{ value: string; count: number }>;
    outcomes: Array<{ value: "round-win" | "round-loss" | "unknown"; count: number }>;
    metrics: Array<{ value: "observed-player" | "target"; count: number }>;
    sides: Array<{ value: "attack" | "defense" | "unknown"; count: number }>;
  };
  samples: Array<{
    roundNumber: number | null;
    eventId: string;
    eventKind: "kill";
    role: "observed-player" | "target";
    teamId: string | null;
    side: "attack" | "defense" | null;
    outcome: "round-win" | "round-loss" | "unknown";
    player: { puuid: string | null; riotId: string } | null;
    /** Where the player was facing, in radians, when the event fired. */
    viewRadians: number | null;
    x: number;
    y: number;
  }>;
  coverage: {
    transformAvailable: boolean;
    totalKillEvents: number;
    eventsWithPositions: number;
    validSamples: number;
    invalidSamples: number;
    uniquePlayers: number;
    rounds: number;
  };
  limitations: string[];
};

export function buildUserMatchScoreboardProjectionV1(
  detail: MatchDetail,
  focusPuuid: string | null,
): UserMatchScoreboardProjectionV1 {
  const focusTrades = detail.performance?.focusPuuid === focusPuuid ? detail.performance.impact : null;
  return parseUserMatchScoreboardProjectionV1({
    version: USER_MATCH_SCOREBOARD_VERSION,
    matchId: detail.matchId,
    teams: detail.teams.map((team) => ({
      teamId: team.teamId,
      players: team.players.map((player) => ({
        puuid: player.puuid,
        riotId: riotId(player),
        utility: {
          totalCasts: player.abilityCasts.total,
          grenade: player.abilityCasts.grenade,
          ability1: player.abilityCasts.ability1,
          ability2: player.abilityCasts.ability2,
          ultimate: player.abilityCasts.ultimate,
        },
        trades:
          focusPuuid && player.puuid === focusPuuid && typeof focusTrades?.tradeKills === "number"
            ? { kills: focusTrades.tradeKills, perRound: focusTrades.tradesPerRound }
            : null,
        clutches: clutchLabels(player.highlights),
        multikills: { highest: player.multiKills, threePlusRounds: player.threePlusKillRounds },
        economy: { averageSpend: player.spentAverage, averageLoadout: player.loadoutAverage },
      })),
    })),
    limitations: focusPuuid && focusTrades === null ? ["Trade evidence is unavailable for the selected player."] : [],
  });
}

export function buildUserSpatialEvidenceProjectionV1(detail: MatchDetail): UserSpatialEvidenceProjectionV1 {
  const map = normalizedMapSpatialResource(detail.mapName);
  const initialAttackerTeam = inferInitialAttackerTeam(detail);
  const eventOffset = killRoundOffset(detail);
  let invalidSamples = 0;
  let eventsWithPositions = 0;
  const samples: UserSpatialEvidenceProjectionV1["samples"] = [];
  detail.killEvents.forEach((event, eventIndex) => {
    const roundNumber = event.round === null ? null : event.round + eventOffset;
    const round =
      roundNumber === null ? null : (detail.rounds.find((candidate) => candidate.number === roundNumber) ?? null);
    const eventId = `r${roundNumber ?? "unknown"}-kill-${eventIndex}`;
    const candidates = [
      ...event.playerLocations.map((location) => ({
        role: "observed-player" as const,
        teamId: location.teamId,
        player: { puuid: location.puuid, riotId: tagged(location.gameName, location.tagLine) },
        position: location.location,
        viewRadians: location.viewRadians,
      })),
      /* The victim's own facing is not recorded with their death position. */
      ...(event.victimLocation
        ? [
            {
              role: "target" as const,
              teamId: event.victimTeam,
              player: { puuid: event.victimPuuid, riotId: tagged(event.victimName, event.victimTag) },
              position: event.victimLocation,
              viewRadians: null,
            },
          ]
        : []),
    ];
    if (candidates.length) eventsWithPositions += 1;
    for (const candidate of candidates) {
      const position = normalizeMapSpatialPosition(detail.mapName, candidate.position);
      if (!map || !position) {
        invalidSamples += 1;
        continue;
      }
      const outcome =
        !round?.winningTeam || !candidate.teamId
          ? "unknown"
          : sameTeam(round.winningTeam, candidate.teamId)
            ? "round-win"
            : "round-loss";
      samples.push({
        roundNumber,
        eventId,
        eventKind: "kill",
        role: candidate.role,
        teamId: candidate.teamId,
        side:
          roundNumber && candidate.teamId
            ? sideForRound(detail, candidate.teamId, roundNumber, initialAttackerTeam)
            : null,
        outcome,
        player: candidate.player,
        viewRadians: candidate.viewRadians,
        x: position.x,
        y: position.y,
      });
    }
  });
  const uniquePlayers = new Set(
    samples.flatMap((sample) =>
      sample.player?.puuid || sample.player?.riotId ? [sample.player.puuid ?? sample.player.riotId] : [],
    ),
  ).size;
  return parseUserSpatialEvidenceProjectionV1({
    version: USER_SPATIAL_EVIDENCE_VERSION,
    matchId: detail.matchId,
    map,
    unavailableReason: map
      ? null
      : "Spatial evidence is unavailable because this map has no documented coordinate transform.",
    options: {
      teams: counted(samples.flatMap((sample) => (sample.teamId ? [sample.teamId] : []))),
      outcomes: counted(
        samples.map((sample) => sample.outcome),
      ) as UserSpatialEvidenceProjectionV1["options"]["outcomes"],
      metrics: counted(samples.map((sample) => sample.role)) as UserSpatialEvidenceProjectionV1["options"]["metrics"],
      sides: counted(
        samples.map((sample) => sample.side ?? "unknown"),
      ) as UserSpatialEvidenceProjectionV1["options"]["sides"],
    },
    samples,
    coverage: {
      transformAvailable: Boolean(map),
      totalKillEvents: detail.killEvents.length,
      eventsWithPositions,
      validSamples: samples.length,
      invalidSamples,
      uniquePlayers,
      rounds: new Set(samples.flatMap((sample) => (sample.roundNumber === null ? [] : [sample.roundNumber]))).size,
    },
    limitations: ["Points are sparse event snapshots, not movement paths, POV, intent, or crosshair placement."],
  });
}

export function parseUserMatchScoreboardProjectionV1(input: unknown): UserMatchScoreboardProjectionV1 {
  const root = exact(input, ["version", "matchId", "teams", "limitations"], "scoreboard");
  if (root.version !== USER_MATCH_SCOREBOARD_VERSION) throw new Error("Unsupported user match scoreboard version");
  string(root.matchId, "scoreboard.matchId", 128);
  array(root.teams, "scoreboard.teams", 8).forEach((value, teamIndex) => {
    const team = exact(value, ["teamId", "players"], `scoreboard.teams[${teamIndex}]`);
    string(team.teamId, `scoreboard.teams[${teamIndex}].teamId`, 80);
    array(team.players, `scoreboard.teams[${teamIndex}].players`, 20).forEach((value, playerIndex) =>
      parseScoreboardPlayer(value, `scoreboard.teams[${teamIndex}].players[${playerIndex}]`),
    );
  });
  stringArray(root.limitations, "scoreboard.limitations", 20, 300);
  return input as UserMatchScoreboardProjectionV1;
}

export function parseUserSpatialEvidenceProjectionV1(input: unknown): UserSpatialEvidenceProjectionV1 {
  const root = exact(
    input,
    ["version", "matchId", "map", "unavailableReason", "options", "samples", "coverage", "limitations"],
    "spatial",
  );
  if (root.version !== USER_SPATIAL_EVIDENCE_VERSION) throw new Error("Unsupported user spatial version");
  string(root.matchId, "spatial.matchId", 128);
  nullableString(root.unavailableReason, "spatial.unavailableReason", 300);
  if (root.map !== null) {
    const map = exact(root.map, ["name", "assetUrl", "width", "height"], "spatial.map");
    string(map.name, "spatial.map.name", 80);
    trustedMapAsset(map.assetUrl);
    if (map.width !== 1 || map.height !== 1) throw new Error("spatial map dimensions must be normalized");
  }
  const options = exact(root.options, ["teams", "outcomes", "metrics", "sides"], "spatial.options");
  parseOptions(options.teams, "spatial.options.teams", 20, null);
  parseOptions(options.outcomes, "spatial.options.outcomes", 3, ["round-win", "round-loss", "unknown"]);
  parseOptions(options.metrics, "spatial.options.metrics", 2, ["observed-player", "target"]);
  parseOptions(options.sides, "spatial.options.sides", 3, ["attack", "defense", "unknown"]);
  const samples = array(root.samples, "spatial.samples", 10_000);
  samples.forEach(parseSpatialSample);
  const coverage = exact(
    root.coverage,
    [
      "transformAvailable",
      "totalKillEvents",
      "eventsWithPositions",
      "validSamples",
      "invalidSamples",
      "uniquePlayers",
      "rounds",
    ],
    "spatial.coverage",
  );
  boolean(coverage.transformAvailable, "spatial.coverage.transformAvailable");
  for (const key of [
    "totalKillEvents",
    "eventsWithPositions",
    "validSamples",
    "invalidSamples",
    "uniquePlayers",
    "rounds",
  ] as const)
    integer(coverage[key], `spatial.coverage.${key}`, 0);
  if (coverage.validSamples !== samples.length) throw new Error("spatial.coverage.validSamples must match samples");
  if ((root.map === null) === coverage.transformAvailable)
    throw new Error("spatial transform availability is inconsistent");
  stringArray(root.limitations, "spatial.limitations", 20, 300);
  return input as UserSpatialEvidenceProjectionV1;
}

function parseScoreboardPlayer(input: unknown, path: string): void {
  const row = exact(input, ["puuid", "riotId", "utility", "trades", "clutches", "multikills", "economy"], path);
  nullableString(row.puuid, `${path}.puuid`, 128);
  string(row.riotId, `${path}.riotId`, 160);
  const utility = exact(row.utility, ["totalCasts", "grenade", "ability1", "ability2", "ultimate"], `${path}.utility`);
  for (const key of Object.keys(utility)) nullableInteger(utility[key], `${path}.utility.${key}`, 0);
  if (row.trades !== null) {
    const trades = exact(row.trades, ["kills", "perRound"], `${path}.trades`);
    integer(trades.kills, `${path}.trades.kills`, 0);
    nullableNumber(trades.perRound, `${path}.trades.perRound`, 0);
  }
  if (row.clutches !== null) {
    const clutches = exact(row.clutches, ["labels"], `${path}.clutches`);
    stringArray(clutches.labels, `${path}.clutches.labels`, 20, 80);
  }
  const multikills = exact(row.multikills, ["highest", "threePlusRounds"], `${path}.multikills`);
  nullableInteger(multikills.highest, `${path}.multikills.highest`, 0);
  nullableInteger(multikills.threePlusRounds, `${path}.multikills.threePlusRounds`, 0);
  const economy = exact(row.economy, ["averageSpend", "averageLoadout"], `${path}.economy`);
  nullableNumber(economy.averageSpend, `${path}.economy.averageSpend`, 0);
  nullableNumber(economy.averageLoadout, `${path}.economy.averageLoadout`, 0);
}

function parseSpatialSample(input: unknown, index: number): void {
  const path = `spatial.samples[${index}]`;
  const row = exact(
    input,
    ["roundNumber", "eventId", "eventKind", "role", "teamId", "side", "outcome", "player", "viewRadians", "x", "y"],
    path,
  );
  nullableInteger(row.roundNumber, `${path}.roundNumber`, 1);
  string(row.eventId, `${path}.eventId`, 160);
  oneOf(row.eventKind, ["kill"], `${path}.eventKind`);
  oneOf(row.role, ["observed-player", "target"], `${path}.role`);
  nullableString(row.teamId, `${path}.teamId`, 80);
  nullableOneOf(row.side, ["attack", "defense"], `${path}.side`);
  oneOf(row.outcome, ["round-win", "round-loss", "unknown"], `${path}.outcome`);
  if (row.player !== null) {
    const player = exact(row.player, ["puuid", "riotId"], `${path}.player`);
    nullableString(player.puuid, `${path}.player.puuid`, 128);
    string(player.riotId, `${path}.player.riotId`, 160);
  }
  if (row.viewRadians !== null && (typeof row.viewRadians !== "number" || !Number.isFinite(row.viewRadians)))
    throw new Error(`${path}.viewRadians must be a finite number or null`);
  ratio(row.x, `${path}.x`);
  ratio(row.y, `${path}.y`);
}
function parseOptions(value: unknown, path: string, max: number, allowed: readonly string[] | null): void {
  array(value, path, max).forEach((entry, index) => {
    const row = exact(entry, ["value", "count"], `${path}[${index}]`);
    string(row.value, `${path}[${index}].value`, 80);
    if (allowed) oneOf(row.value, allowed, `${path}[${index}].value`);
    integer(row.count, `${path}[${index}].count`, 0);
  });
}
function clutchLabels(highlights: string[]): { labels: string[] } | null {
  const labels = highlights.filter((label) => /\bclutch\b/i.test(label)).slice(0, 20);
  return labels.length ? { labels } : null;
}
function riotId(player: MatchPlayerDetail): string {
  return tagged(player.gameName, player.tagLine);
}
function tagged(name: string, tag: string | null): string {
  return tag ? `${name}#${tag}` : name;
}
function sameTeam(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
function counted<T extends string>(values: T[]): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}
function exact(input: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${path} must be an object`);
  const row = input as Record<string, unknown>;
  if (keys.some((key) => !Object.hasOwn(row, key))) throw new Error(`${path} missing field`);
  const unknown = Object.keys(row).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`${path} unknown field ${unknown}`);
  return row;
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${path} must be a bounded array`);
  return value;
}
function string(value: unknown, path: string, max: number): void {
  if (typeof value !== "string" || !value || value.length > max) throw new Error(`${path} must be a bounded string`);
}
function nullableString(value: unknown, path: string, max: number): void {
  if (value !== null) string(value, path, max);
}
function integer(value: unknown, path: string, min: number): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    throw new Error(`${path} must be an integer`);
}
function nullableInteger(value: unknown, path: string, min: number): void {
  if (value !== null) integer(value, path, min);
}
function nullableNumber(value: unknown, path: string, min: number): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < min))
    throw new Error(`${path} must be a finite number`);
}
function ratio(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${path} must be a ratio`);
}
function boolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
}
function trustedMapAsset(value: unknown): void {
  string(value, "spatial.map.assetUrl", 2048);
  if (!/^\/assets\/game\/maps\/[a-f0-9-]+\/displayicon\.png$/.test(value as string))
    throw new Error("spatial.map.assetUrl must use the first-party game asset route");
}
function oneOf(value: unknown, options: readonly string[], path: string): void {
  if (typeof value !== "string" || !options.includes(value)) throw new Error(`${path} has an invalid value`);
}
function nullableOneOf(value: unknown, options: readonly string[], path: string): void {
  if (value !== null) oneOf(value, options, path);
}
function stringArray(value: unknown, path: string, max: number, maxLength: number): void {
  array(value, path, max).forEach((entry, index) => string(entry, `${path}[${index}]`, maxLength));
}
