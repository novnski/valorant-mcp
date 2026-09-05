import type { MatchSummary, MatchTeamComposition, ValorantMode } from "../domain/types";
import { valorantPatchFromGameVersion } from "./game-version";
import { derivePlayerKast } from "./kast";

type UnknownRecord = Record<string, unknown>;

export function normalizeMatches(
  rawMatches: unknown[],
  puuid: string,
): {
  summaries: MatchSummary[];
  rawByMatchId: Map<string, unknown>;
} {
  const rawByMatchId = new Map<string, unknown>();
  const summaries: MatchSummary[] = [];

  for (const raw of rawMatches) {
    if (!isRecord(raw)) {
      continue;
    }

    const matchId =
      stringAt(raw, ["metadata", "match_id"]) ??
      stringAt(raw, ["metadata", "matchid"]) ??
      stringAt(raw, ["meta", "id"]) ??
      stringAt(raw, ["match_id"]) ??
      stringAt(raw, ["matchId"]);

    if (!matchId) {
      continue;
    }

    const player = findPlayer(raw, puuid);
    const teamId = stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]);
    const team = findTeam(raw, teamId);
    const roundsWon =
      numberAt(player, ["stats", "rounds", "won"]) ??
      numberAt(player, ["rounds_won"]) ??
      numberAt(team, ["rounds", "won"]);
    const roundsLost =
      numberAt(player, ["stats", "rounds", "lost"]) ??
      numberAt(player, ["rounds_lost"]) ??
      numberAt(team, ["rounds", "lost"]);
    const totalRounds = (roundsWon ?? 0) + (roundsLost ?? 0);
    const mode = normalizeMode(
      stringAt(raw, ["metadata", "queue", "id"]) ??
        stringAt(raw, ["metadata", "queue", "name"]) ??
        stringAt(raw, ["metadata", "queue", "mode_type"]) ??
        stringAt(raw, ["metadata", "queue"]) ??
        stringAt(raw, ["metadata", "mode"]) ??
        stringAt(raw, ["metadata", "mode_id"]) ??
        stringAt(raw, ["meta", "mode"]) ??
        stringAt(raw, ["queue"]),
    );
    const totalScore = numberAt(player, ["stats", "score"]) ?? numberAt(player, ["score"]);
    const totalDamage =
      numberAt(player, ["stats", "damage", "dealt"]) ??
      numberAt(player, ["damage", "made"]) ??
      numberAt(player, ["damage_made"]);
    const damageReceived =
      numberAt(player, ["stats", "damage", "received"]) ??
      numberAt(player, ["damage", "received"]) ??
      numberAt(player, ["damage_received"]);

    const gameVersion = stringAt(raw, ["metadata", "game_version"]);
    const summary: MatchSummary = {
      matchId,
      mode,
      mapName:
        stringAt(raw, ["metadata", "map", "name"]) ??
        stringAt(raw, ["metadata", "map"]) ??
        stringAt(raw, ["meta", "map", "name"]) ??
        stringAt(raw, ["map", "name"]) ??
        null,
      gameVersion,
      patch: valorantPatchFromGameVersion(gameVersion),
      agentName:
        stringAt(player, ["agent", "name"]) ??
        stringAt(player, ["character", "name"]) ??
        stringAt(player, ["agent"]) ??
        null,
      seasonId:
        stringAt(raw, ["metadata", "season", "id"]) ??
        stringAt(raw, ["metadata", "season_id"]) ??
        stringAt(raw, ["meta", "season", "id"]) ??
        stringAt(raw, ["season", "id"]) ??
        null,
      seasonShort:
        stringAt(raw, ["metadata", "season", "short"]) ??
        stringAt(raw, ["metadata", "season_short"]) ??
        stringAt(raw, ["meta", "season", "short"]) ??
        stringAt(raw, ["season", "short"]) ??
        null,
      startedAt:
        stringAt(raw, ["metadata", "started_at"]) ??
        stringAt(raw, ["metadata", "game_start"]) ??
        stringAt(raw, ["metadata", "game_start_patched"]) ??
        stringAt(raw, ["meta", "started_at"]) ??
        null,
      durationMs:
        numberAt(raw, ["metadata", "duration", "millis"]) ??
        numberAt(raw, ["metadata", "game_length_in_ms"]) ??
        numberAt(raw, ["meta", "duration", "millis"]) ??
        null,
      result: normalizeResult(player, team, roundsWon, roundsLost),
      roundsWon,
      roundsLost,
      kills: numberAt(player, ["stats", "kills"]) ?? numberAt(player, ["kills"]),
      deaths: numberAt(player, ["stats", "deaths"]) ?? numberAt(player, ["deaths"]),
      assists: numberAt(player, ["stats", "assists"]) ?? numberAt(player, ["assists"]),
      score: totalScore,
      tierId:
        numberAt(player, ["tier", "id"]) ??
        numberAt(player, ["tier"]) ??
        numberAt(player, ["competitive_tier"]) ??
        numberAt(player, ["stats", "tier"]),
      tierName: stringAt(player, ["tier", "name"]) ?? stringAt(player, ["rank", "name"]),
      placement: placementForPlayer(raw, puuid),
      acs:
        numberAt(player, ["stats", "average_combat_score"]) ??
        numberAt(player, ["average_combat_score"]) ??
        (totalScore !== null && totalRounds > 0 ? totalScore / totalRounds : null),
      adr:
        numberAt(player, ["stats", "damage", "average"]) ??
        (totalDamage !== null && totalRounds > 0 ? totalDamage / totalRounds : totalDamage),
      damageDelta: damageDeltaPerRound(totalDamage, damageReceived, totalRounds),
      kast:
        numberAt(player, ["stats", "kast"]) ??
        numberAt(player, ["kast"]) ??
        derivePlayerKast(raw, puuid, totalRounds > 0 ? totalRounds : null),
      headshots:
        numberAt(player, ["stats", "headshots"]) ??
        numberAt(player, ["shots", "head"]) ??
        numberAt(player, ["headshots"]),
      bodyshots:
        numberAt(player, ["stats", "bodyshots"]) ??
        numberAt(player, ["shots", "body"]) ??
        numberAt(player, ["bodyshots"]),
      legshots:
        numberAt(player, ["stats", "legshots"]) ?? numberAt(player, ["shots", "leg"]) ?? numberAt(player, ["legshots"]),
      weapons: weaponTags(raw, puuid),
      teammates: teammateTags(raw, puuid, teamId),
      opponents: opponentTags(raw, puuid, teamId),
      opponentAgents: opponentAgentTags(raw, puuid, teamId),
      teamCompositions: teamCompositions(raw),
      highlights: highlightTags(raw, puuid),
      partySize: partySizeForPlayer(raw, puuid, teamId),
    };

    summaries.push(summary);
    rawByMatchId.set(matchId, raw);
  }

  return { summaries, rawByMatchId };
}

function placementForPlayer(raw: UnknownRecord, puuid: string): number | null {
  const players = allPlayers(raw)
    .map((player) => ({
      puuid: stringAt(player, ["puuid"]) ?? stringAt(player, ["account", "puuid"]) ?? stringAt(player, ["subject"]),
      score: numberAt(player, ["stats", "score"]) ?? numberAt(player, ["score"]),
    }))
    .filter((player): player is { puuid: string; score: number } => player.puuid !== null && player.score !== null)
    .sort((left, right) => right.score - left.score);

  if (players.length < 2) {
    return null;
  }

  const index = players.findIndex((player) => player.puuid === puuid);
  return index === -1 ? null : index + 1;
}

function highlightTags(raw: UnknownRecord, puuid: string): string[] {
  const clutchTags = clutchHighlightTags(raw, puuid);
  const kills = valueAt(raw, ["kills"]);
  if (!Array.isArray(kills)) {
    return clutchTags;
  }

  const byRound = new Map<number, number>();
  for (const kill of kills) {
    if (!isRecord(kill) || stringAt(valueAt(kill, ["killer"]), ["puuid"]) !== puuid) {
      continue;
    }
    const round = numberAt(kill, ["round"]);
    if (round === null) {
      continue;
    }
    byRound.set(round, (byRound.get(round) ?? 0) + 1);
  }

  const multikillTags = Array.from(byRound.values())
    .filter((killsInRound) => killsInRound >= 2)
    .sort((left, right) => right - left)
    .map((killsInRound) => `${killsInRound}k`);
  return [...clutchTags, ...multikillTags];
}

function clutchHighlightTags(raw: UnknownRecord, puuid: string): string[] {
  const players = allPlayers(raw)
    .map((player) => ({
      puuid: stringAt(player, ["puuid"]) ?? stringAt(player, ["account", "puuid"]) ?? stringAt(player, ["subject"]),
      teamId: stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]) ?? "",
    }))
    .filter((player): player is { puuid: string; teamId: string } => player.puuid !== null && player.teamId !== "");
  const targetTeam = players.find((player) => player.puuid === puuid)?.teamId;
  if (!targetTeam) {
    return [];
  }

  const initialAliveByTeam = new Map<string, Set<string>>();
  const teamByPlayer = new Map<string, string>();
  for (const player of players) {
    const teamKey = normalizedTeamKey(player.teamId);
    teamByPlayer.set(player.puuid, teamKey);
    const alive = initialAliveByTeam.get(teamKey) ?? new Set<string>();
    alive.add(player.puuid);
    initialAliveByTeam.set(teamKey, alive);
  }

  const winningTeamByRound = roundWinners(raw);
  const kills = valueAt(raw, ["kills"]);
  if (!Array.isArray(kills)) {
    return [];
  }

  const eventsByRound = new Map<number, UnknownRecord[]>();
  for (const kill of kills) {
    if (!isRecord(kill)) {
      continue;
    }
    const round = numberAt(kill, ["round"]);
    if (round === null) {
      continue;
    }
    eventsByRound.set(round, [...(eventsByRound.get(round) ?? []), kill]);
  }

  const clutchValues: number[] = [];
  for (const [roundNumber, roundKills] of eventsByRound) {
    const winningTeam = winningTeamByRound.get(roundNumber);
    if (!winningTeam || winningTeam !== normalizedTeamKey(targetTeam)) {
      continue;
    }
    const aliveByTeam = cloneAliveTeams(initialAliveByTeam);
    let maxOpponents = 0;
    const orderedKills = [...roundKills].sort(
      (left, right) =>
        (numberAt(left, ["time_in_round_in_ms"]) ?? numberAt(left, ["time_in_round_ms"]) ?? 999_999) -
        (numberAt(right, ["time_in_round_in_ms"]) ?? numberAt(right, ["time_in_round_ms"]) ?? 999_999),
    );
    for (const kill of orderedKills) {
      const killer = valueAt(kill, ["killer"]);
      const victim = valueAt(kill, ["victim"]);
      const killerPuuid = stringAt(killer, ["puuid"]);
      const victimPuuid = stringAt(victim, ["puuid"]);
      if (!killerPuuid || !victimPuuid) {
        continue;
      }
      const killerTeam = normalizedTeamKey(stringAt(killer, ["team"]) ?? teamByPlayer.get(killerPuuid) ?? "");
      const victimTeam = normalizedTeamKey(stringAt(victim, ["team"]) ?? teamByPlayer.get(victimPuuid) ?? "");
      const killerAlive = aliveByTeam.get(killerTeam);
      const victimAlive = aliveByTeam.get(victimTeam);
      if (
        killerPuuid === puuid &&
        killerTeam === winningTeam &&
        killerAlive?.size === 1 &&
        killerAlive.has(killerPuuid) &&
        victimAlive &&
        victimAlive.size >= 1
      ) {
        maxOpponents = Math.max(maxOpponents, victimAlive.size);
      }
      victimAlive?.delete(victimPuuid);
    }
    if (maxOpponents > 0) {
      clutchValues.push(maxOpponents);
    }
  }

  return clutchValues.sort((left, right) => right - left).map((opponents) => `1v${opponents} Clutch`);
}

function roundWinners(raw: UnknownRecord): Map<number, string> {
  const rounds = valueAt(raw, ["rounds"]);
  const winners = new Map<number, string>();
  if (!Array.isArray(rounds)) {
    return winners;
  }
  rounds.filter(isRecord).forEach((round, index) => {
    const winner = stringAt(round, ["winning_team"]) ?? stringAt(round, ["winningTeam"]);
    if (!winner) {
      return;
    }
    const explicitRound = numberAt(round, ["round"]) ?? numberAt(round, ["round_num"]) ?? numberAt(round, ["id"]);
    const displayRound =
      explicitRound !== null ? (explicitRound === index ? explicitRound + 1 : explicitRound) : index + 1;
    const teamKey = normalizedTeamKey(winner);
    winners.set(displayRound, teamKey);
    winners.set(displayRound - 1, teamKey);
  });
  return winners;
}

function cloneAliveTeams(source: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map(Array.from(source.entries()).map(([team, players]) => [team, new Set(players)]));
}

function normalizedTeamKey(value: string): string {
  return value.trim().toLowerCase();
}

function weaponTags(raw: UnknownRecord, puuid: string): string[] {
  const counts = new Map<string, number>();
  const kills = valueAt(raw, ["kills"]);
  if (Array.isArray(kills)) {
    for (const kill of kills) {
      if (!isRecord(kill) || stringAt(valueAt(kill, ["killer"]), ["puuid"]) !== puuid) {
        continue;
      }
      const weapon = stringAt(kill, ["weapon", "name"]) ?? stringAt(kill, ["weapon"]);
      if (!weapon) {
        continue;
      }
      counts.set(weapon, (counts.get(weapon) ?? 0) + 1);
    }
  }

  for (const row of roundWeaponRows(raw, puuid)) {
    counts.set(row.weapon, Math.max(counts.get(row.weapon) ?? 0, row.rounds));
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([weapon]) => weapon);
}

function roundWeaponRows(raw: UnknownRecord, puuid: string): Array<{ weapon: string; rounds: number }> {
  const counts = new Map<string, number>();
  const rounds = valueAt(raw, ["rounds"]);
  if (!Array.isArray(rounds)) {
    return [];
  }

  for (const round of rounds) {
    if (!isRecord(round)) {
      continue;
    }
    const stats = valueAt(round, ["stats"]);
    if (!Array.isArray(stats)) {
      continue;
    }
    for (const row of stats) {
      if (!isRecord(row)) {
        continue;
      }
      const player = valueAt(row, ["player"]);
      const rowPuuid = stringAt(player, ["puuid"]) ?? stringAt(row, ["puuid"]);
      if (rowPuuid !== puuid) {
        continue;
      }
      const economy = valueAt(row, ["economy"]);
      const weapon =
        stringAt(economy, ["weapon", "name"]) ??
        stringAt(economy, ["weapon"]) ??
        stringAt(row, ["weapon", "name"]) ??
        stringAt(row, ["weapon"]);
      if (weapon) {
        counts.set(weapon, (counts.get(weapon) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries()).map(([weapon, rounds]) => ({ weapon, rounds }));
}

function teammateTags(raw: UnknownRecord, puuid: string, teamId: string | null): string[] {
  if (!teamId) {
    return [];
  }

  return allPlayers(raw)
    .filter((player) => {
      const playerPuuid =
        stringAt(player, ["puuid"]) ?? stringAt(player, ["account", "puuid"]) ?? stringAt(player, ["subject"]);
      const playerTeam = stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]);
      return playerPuuid !== puuid && playerTeam?.toLowerCase() === teamId.toLowerCase();
    })
    .map((player) => {
      const name = stringAt(player, ["name"]) ?? stringAt(player, ["account", "name"]) ?? "Unknown";
      const tag = stringAt(player, ["tag"]) ?? stringAt(player, ["account", "tag"]);
      return tag ? `${name}#${tag}` : name;
    })
    .filter((name) => name !== "Unknown")
    .sort((left, right) => left.localeCompare(right));
}

function opponentTags(raw: UnknownRecord, puuid: string, teamId: string | null): string[] {
  return opponentPlayers(raw, puuid, teamId)
    .map((player) => {
      const name = stringAt(player, ["name"]) ?? stringAt(player, ["account", "name"]) ?? "Unknown";
      const tag = stringAt(player, ["tag"]) ?? stringAt(player, ["account", "tag"]);
      return tag ? `${name}#${tag}` : name;
    })
    .filter((name) => name !== "Unknown")
    .sort((left, right) => left.localeCompare(right));
}

function opponentAgentTags(raw: UnknownRecord, puuid: string, teamId: string | null): string[] {
  return Array.from(
    new Set(
      opponentPlayers(raw, puuid, teamId)
        .map(
          (player) =>
            stringAt(player, ["agent", "name"]) ??
            stringAt(player, ["character", "name"]) ??
            stringAt(player, ["agent"]),
        )
        .filter((agent): agent is string => Boolean(agent)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function opponentPlayers(raw: UnknownRecord, puuid: string, teamId: string | null): UnknownRecord[] {
  if (!teamId) {
    return [];
  }

  return allPlayers(raw).filter((player) => {
    const playerPuuid =
      stringAt(player, ["puuid"]) ?? stringAt(player, ["account", "puuid"]) ?? stringAt(player, ["subject"]);
    const playerTeam = stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]);
    return playerPuuid !== puuid && playerTeam !== null && playerTeam.toLowerCase() !== teamId.toLowerCase();
  });
}

function partySizeForPlayer(raw: UnknownRecord, puuid: string, teamId: string | null): number | null {
  if (!teamId) {
    return null;
  }
  const player = findPlayer(raw, puuid);
  const partyId =
    stringAt(player, ["party_id"]) ??
    stringAt(player, ["partyId"]) ??
    stringAt(player, ["party", "id"]) ??
    stringAt(player, ["session_playtime", "party_id"]);
  if (!partyId) {
    return null;
  }
  const size = allPlayers(raw).filter((candidate) => {
    const candidateTeam = stringAt(candidate, ["team_id"]) ?? stringAt(candidate, ["team"]);
    const candidatePartyId =
      stringAt(candidate, ["party_id"]) ??
      stringAt(candidate, ["partyId"]) ??
      stringAt(candidate, ["party", "id"]) ??
      stringAt(candidate, ["session_playtime", "party_id"]);
    return candidateTeam?.toLowerCase() === teamId.toLowerCase() && candidatePartyId === partyId;
  }).length;
  return Math.min(Math.max(size || 1, 1), 5);
}

function allPlayers(raw: UnknownRecord): UnknownRecord[] {
  const collections = [
    valueAt(raw, ["players", "all_players"]),
    valueAt(raw, ["players"]),
    valueAt(raw, ["data", "players"]),
  ];
  for (const collection of collections) {
    const rows = playerRows(collection);
    if (rows.length > 0) {
      return rows;
    }
  }
  return [];
}

function teamCompositions(raw: UnknownRecord): MatchTeamComposition[] {
  const grouped = new Map<string, { teamId: string; agents: string[] }>();
  for (const player of allPlayers(raw)) {
    const teamId = stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]);
    const agentName =
      stringAt(player, ["agent", "name"]) ?? stringAt(player, ["character", "name"]) ?? stringAt(player, ["agent"]);
    if (!teamId || !agentName) continue;
    const key = normalizedTeamKey(teamId);
    const current = grouped.get(key) ?? { teamId, agents: [] };
    current.agents.push(agentName);
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).flatMap(({ teamId, agents }) => {
    const uniqueAgents = Array.from(new Set(agents)).sort((left, right) => left.localeCompare(right));
    if (agents.length !== 5 || uniqueAgents.length !== 5) return [];
    const won = valueAt(findTeam(raw, teamId), ["won"]);
    return [{ teamId, agents: uniqueAgents, won: typeof won === "boolean" ? won : null }];
  });
}

function playerRows(collection: unknown): UnknownRecord[] {
  if (Array.isArray(collection)) {
    return collection.filter(isRecord);
  }

  if (isRecord(collection)) {
    if (stringAt(collection, ["puuid"]) || stringAt(collection, ["account", "puuid"])) {
      return [collection];
    }

    return Object.values(collection).flatMap((value) => (Array.isArray(value) ? value.filter(isRecord) : []));
  }

  return [];
}

function findPlayer(raw: UnknownRecord, puuid: string): UnknownRecord | null {
  const playerCollections = [
    valueAt(raw, ["stats"]),
    valueAt(raw, ["players", "all_players"]),
    valueAt(raw, ["players"]),
    valueAt(raw, ["data", "players"]),
  ];

  for (const collection of playerCollections) {
    if (isRecord(collection) && stringAt(collection, ["puuid"]) === puuid) {
      return collection;
    }

    if (!Array.isArray(collection)) {
      continue;
    }

    const found = collection.find((entry) => {
      if (!isRecord(entry)) {
        return false;
      }

      return (
        stringAt(entry, ["puuid"]) === puuid ||
        stringAt(entry, ["account", "puuid"]) === puuid ||
        stringAt(entry, ["subject"]) === puuid
      );
    });

    if (isRecord(found)) {
      return found;
    }
  }

  return null;
}

function findTeam(raw: UnknownRecord, teamId: string | null): UnknownRecord | null {
  if (!teamId) {
    return null;
  }

  const teams = valueAt(raw, ["teams"]);
  if (isRecord(teams)) {
    const normalized = teamId.toLowerCase();
    const ownScore = numberAt(teams, [normalized]);
    const otherScore = Object.entries(teams).find(([key]) => key !== normalized)?.[1];
    if (ownScore !== null && typeof otherScore === "number") {
      return {
        team_id: teamId,
        won: ownScore > otherScore,
        rounds: {
          won: ownScore,
          lost: otherScore,
        },
      };
    }
  }

  if (!Array.isArray(teams)) {
    return null;
  }

  const found = teams.find((entry) => isRecord(entry) && stringAt(entry, ["team_id"]) === teamId);
  return isRecord(found) ? found : null;
}

function normalizeMode(value: string | null): ValorantMode | string {
  if (!value) {
    return "all";
  }

  const compact = value.toLowerCase().replace(/[\s_-]/g, "");
  if (compact === "competitive") {
    return "competitive";
  }
  if (compact === "unrated" || compact === "standard") {
    return "unrated";
  }
  if (compact === "swiftplay") {
    return "swiftplay";
  }
  if (compact === "spikerush") {
    return "spikerush";
  }
  if (compact === "deathmatch") {
    return "deathmatch";
  }
  if (compact === "teamdeathmatch" || compact === "hurm") {
    return "teamdeathmatch";
  }
  if (compact === "custom" || compact === "customgame") {
    return "custom";
  }

  return value.toLowerCase();
}

function damageDeltaPerRound(
  totalDamage: number | null,
  damageReceived: number | null,
  totalRounds: number,
): number | null {
  if (totalDamage === null || damageReceived === null || totalRounds <= 0) {
    return null;
  }
  return (totalDamage - damageReceived) / totalRounds;
}

function normalizeResult(
  player: UnknownRecord | null,
  team: UnknownRecord | null,
  roundsWon: number | null,
  roundsLost: number | null,
): MatchSummary["result"] {
  if (roundsWon !== null && roundsLost !== null && roundsWon > 0 && roundsWon === roundsLost) {
    return "draw";
  }

  const won = valueAt(team, ["won"]);
  if (won === true) {
    return "win";
  }
  if (won === false) {
    return "loss";
  }

  const result = stringAt(player, ["result"]) ?? stringAt(player, ["team", "result"]);
  if (!result) {
    return "unknown";
  }

  const normalized = result.toLowerCase();
  if (normalized.includes("win")) {
    return "win";
  }
  if (normalized.includes("loss") || normalized.includes("lose")) {
    return "loss";
  }
  if (normalized.includes("draw")) {
    return "draw";
  }

  return "unknown";
}

function stringAt(source: unknown, path: string[]): string | null {
  const value = valueAt(source, path);
  return typeof value === "string" && value.trim() ? value : null;
}

function numberAt(source: unknown, path: string[]): number | null {
  const value = valueAt(source, path);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valueAt(source: unknown, path: string[]): unknown {
  let cursor = source;
  for (const key of path) {
    if (!isRecord(cursor)) {
      return null;
    }
    cursor = cursor[key];
  }
  return cursor;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
