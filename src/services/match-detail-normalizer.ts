import { matchCompleteness, completenessWarnings } from "./match-completeness";
import type {
  MatchDetail,
  MatchEndState,
  MatchKillEvent,
  MatchPlayerDetail,
  MatchRoundDetail,
  MatchRoundPlayerStat,
  MatchSpikeEvent,
  MatchTeamDetail,
} from "../domain/types";
import { teamLabel } from "../domain/team-labels";
import { valorantPatchFromGameVersion } from "./game-version";
import { derivePlayerKast } from "./kast";

type UnknownRecord = Record<string, unknown>;
type NormalizedPlayer = MatchPlayerDetail & {
  damageDealtTotal: number | null;
  damageReceivedTotal: number | null;
};

type CompetitiveDamageTotals = {
  dealt: number;
  received: number;
};

export function normalizeMatchDetail(
  raw: unknown,
  options: { region: string; platform: string; source: MatchDetail["source"] },
): MatchDetail | null {
  if (!isRecord(raw)) {
    return null;
  }

  const matchId =
    stringAt(raw, ["metadata", "match_id"]) ??
    stringAt(raw, ["metadata", "matchid"]) ??
    stringAt(raw, ["meta", "id"]) ??
    stringAt(raw, ["match_id"]) ??
    stringAt(raw, ["matchId"]);

  if (!matchId) {
    return null;
  }

  const scoredRoundCount = scoredRoundCountFromRaw(raw);
  const rounds = readRounds(raw, scoredRoundCount);
  const killEvents = readKillEvents(raw);
  const players = readPlayers(raw, killEvents, rounds, scoredRoundCount);
  const teams = readTeams(raw, players);
  const endState = readEndState(raw, teams);
  const averageTierName =
    stringAt(raw, ["metadata", "average_tier", "name"]) ??
    stringAt(raw, ["metadata", "average_rank", "name"]) ??
    deriveAverageTierName(players);
  const gameVersion = stringAt(raw, ["metadata", "game_version"]);

  const detail: MatchDetail = {
    matchId,
    region: options.region,
    platform: options.platform,
    mode:
      stringAt(raw, ["metadata", "queue", "name"]) ??
      stringAt(raw, ["metadata", "queue", "id"]) ??
      stringAt(raw, ["metadata", "mode"]) ??
      stringAt(raw, ["meta", "mode"]) ??
      "unknown",
    mapName:
      stringAt(raw, ["metadata", "map", "name"]) ??
      stringAt(raw, ["metadata", "map"]) ??
      stringAt(raw, ["meta", "map", "name"]) ??
      stringAt(raw, ["map", "name"]) ??
      null,
    gameVersion,
    patch: valorantPatchFromGameVersion(gameVersion),
    startedAt:
      stringAt(raw, ["metadata", "started_at"]) ??
      stringAt(raw, ["metadata", "game_start"]) ??
      stringAt(raw, ["metadata", "game_start_patched"]) ??
      stringAt(raw, ["meta", "started_at"]) ??
      null,
    durationMs: numberAt(raw, ["metadata", "duration", "millis"]) ?? numberAt(raw, ["metadata", "game_length_in_ms"]),
    averageTierName,
    endState,
    teams,
    rounds,
    killEvents,
    killRoundOffset:
      isRecord(valueAt(raw, ["metadata", "queue"])) || killEvents.some((event) => event.round === 0) ? 1 : 0,
    source: options.source,
    warnings: [],
  };
  detail.evidence = matchCompleteness(detail, raw);
  detail.warnings = completenessWarnings(detail.evidence);
  return detail;
}

function readPlayers(
  raw: UnknownRecord,
  killEvents: MatchKillEvent[],
  rounds: MatchRoundDetail[],
  scoredRoundCount: number | null,
): NormalizedPlayer[] {
  const candidates = [
    valueAt(raw, ["players", "all_players"]),
    valueAt(raw, ["players"]),
    valueAt(raw, ["data", "players"]),
    valueAt(raw, ["stats"]),
  ];

  for (const candidate of candidates) {
    const rows = normalizePlayerCollection(candidate);
    if (rows.length > 0) {
      const kastByPlayer = deriveKastByPlayer(raw, scoredRoundCount);
      const multikillByPlayer = multikillHighlightsByPlayer(killEvents);
      const threePlusKillRoundsByPlayer = countThreePlusKillRoundsByPlayer(killEvents);
      const clutchByPlayer = clutchHighlightsByPlayer(killEvents, rows, rounds);
      const openingDuelsByPlayer = openingDuelsByPlayerFromEvents(killEvents);
      const competitiveDamageByPlayer = competitiveDamageTotalsByPlayer(rows, rounds, scoredRoundCount);
      return rows.map((player) => {
        const derivedHighlights = player.puuid
          ? [...(clutchByPlayer.get(player.puuid) ?? []), ...(multikillByPlayer.get(player.puuid) ?? [])]
          : [];
        const derivedMax = highestMultikill(derivedHighlights);
        const openingDuels = player.puuid
          ? (openingDuelsByPlayer.get(player.puuid) ?? { firstKills: 0, firstDeaths: 0 })
          : { firstKills: 0, firstDeaths: 0 };
        const competitiveDamage = player.puuid ? competitiveDamageByPlayer.get(player.puuid) : null;
        return {
          ...player,
          damageDealtTotal: competitiveDamage?.dealt ?? player.damageDealtTotal,
          damageReceivedTotal: competitiveDamage?.received ?? player.damageReceivedTotal,
          damageDelta: competitiveDamage ? competitiveDamage.dealt - competitiveDamage.received : player.damageDelta,
          kast: player.kast ?? (player.puuid ? (kastByPlayer.get(player.puuid) ?? null) : null),
          firstKills: player.firstKills ?? openingDuels.firstKills,
          firstDeaths: player.firstDeaths ?? openingDuels.firstDeaths,
          threePlusKillRounds:
            player.threePlusKillRounds ??
            (player.puuid
              ? (threePlusKillRoundsByPlayer.get(player.puuid) ?? (killEvents.length > 0 ? 0 : null))
              : null),
          multiKills: derivedMax !== null ? Math.max(player.multiKills ?? 0, derivedMax) : player.multiKills,
          highlights: derivedHighlights,
        };
      });
    }
  }

  return [];
}

function normalizePlayerCollection(candidate: unknown): NormalizedPlayer[] {
  if (Array.isArray(candidate)) {
    return candidate.filter(isRecord).map(mapPlayer);
  }

  if (isRecord(candidate)) {
    if (stringAt(candidate, ["puuid"]) || stringAt(candidate, ["account", "puuid"])) {
      return [mapPlayer(candidate)];
    }

    const grouped = Object.values(candidate).flatMap((value) => (Array.isArray(value) ? value : []));
    return grouped.filter(isRecord).map(mapPlayer);
  }

  return [];
}

function mapPlayer(player: UnknownRecord): NormalizedPlayer {
  const teamId = stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]) ?? "unknown";
  const headshots =
    numberAt(player, ["stats", "headshots"]) ?? numberAt(player, ["shots", "head"]) ?? numberAt(player, ["headshots"]);
  const bodyshots =
    numberAt(player, ["stats", "bodyshots"]) ?? numberAt(player, ["shots", "body"]) ?? numberAt(player, ["bodyshots"]);
  const legshots =
    numberAt(player, ["stats", "legshots"]) ?? numberAt(player, ["shots", "leg"]) ?? numberAt(player, ["legshots"]);
  const hits = (headshots ?? 0) + (bodyshots ?? 0) + (legshots ?? 0);
  const damageMade =
    numberAt(player, ["stats", "damage", "dealt"]) ??
    numberAt(player, ["damage", "made"]) ??
    numberAt(player, ["damage_made"]);
  const damageReceived =
    numberAt(player, ["stats", "damage", "received"]) ??
    numberAt(player, ["damage", "received"]) ??
    numberAt(player, ["damage_received"]);
  const explicitAdr = numberAt(player, ["stats", "damage", "average"]) ?? numberAt(player, ["damage", "average"]);
  const abilityCasts = readAbilityCasts(player);

  return {
    puuid: stringAt(player, ["puuid"]) ?? stringAt(player, ["account", "puuid"]) ?? stringAt(player, ["subject"]),
    gameName: stringAt(player, ["name"]) ?? stringAt(player, ["account", "name"]) ?? "Unknown",
    tagLine: stringAt(player, ["tag"]) ?? stringAt(player, ["account", "tag"]),
    teamId,
    partyId:
      stringAt(player, ["party_id"]) ??
      stringAt(player, ["partyId"]) ??
      stringAt(player, ["party", "id"]) ??
      stringAt(player, ["session_playtime", "party_id"]),
    agentName:
      stringAt(player, ["agent", "name"]) ?? stringAt(player, ["character", "name"]) ?? stringAt(player, ["agent"]),
    level: numberAt(player, ["level"]) ?? numberAt(player, ["account", "level"]),
    tierId:
      numberAt(player, ["tier", "id"]) ??
      numberAt(player, ["tier"]) ??
      numberAt(player, ["competitive_tier"]) ??
      numberAt(player, ["stats", "tier"]),
    tierName: stringAt(player, ["tier", "name"]) ?? stringAt(player, ["rank", "name"]),
    score: numberAt(player, ["stats", "score"]) ?? numberAt(player, ["score"]),
    trackerScore:
      numberAt(player, ["stats", "tracker_score"]) ?? numberAt(player, ["tracker_score"]) ?? numberAt(player, ["trs"]),
    kills: numberAt(player, ["stats", "kills"]) ?? numberAt(player, ["kills"]),
    deaths: numberAt(player, ["stats", "deaths"]) ?? numberAt(player, ["deaths"]),
    assists: numberAt(player, ["stats", "assists"]) ?? numberAt(player, ["assists"]),
    acs: numberAt(player, ["stats", "average_combat_score"]) ?? numberAt(player, ["average_combat_score"]),
    adr: explicitAdr,
    damageDelta: damageMade !== null && damageReceived !== null ? damageMade - damageReceived : null,
    damageDealtTotal: damageMade,
    damageReceivedTotal: damageReceived,
    headshotRate: hits > 0 && headshots !== null ? headshots / hits : null,
    kast: numberAt(player, ["stats", "kast"]) ?? numberAt(player, ["kast"]),
    firstKills: numberAt(player, ["stats", "first_kills"]) ?? numberAt(player, ["first_kills"]),
    firstDeaths: numberAt(player, ["stats", "first_deaths"]) ?? numberAt(player, ["first_deaths"]),
    threePlusKillRounds:
      numberAt(player, ["stats", "three_plus_kill_rounds"]) ?? numberAt(player, ["three_plus_kill_rounds"]),
    multiKills: numberAt(player, ["stats", "multi_kills"]) ?? numberAt(player, ["multi_kills"]),
    highlights: [],
    spentOverall: numberAt(player, ["economy", "spent", "overall"]) ?? numberAt(player, ["spent", "overall"]),
    spentAverage: numberAt(player, ["economy", "spent", "average"]) ?? numberAt(player, ["spent", "average"]),
    loadoutOverall:
      numberAt(player, ["economy", "loadout_value", "overall"]) ?? numberAt(player, ["loadout_value", "overall"]),
    loadoutAverage:
      numberAt(player, ["economy", "loadout_value", "average"]) ?? numberAt(player, ["loadout_value", "average"]),
    abilityCasts,
  };
}

function readAbilityCasts(player: UnknownRecord): MatchPlayerDetail["abilityCasts"] {
  const grenade = numberAt(player, ["ability_casts", "grenade"]);
  const ability1 = numberAt(player, ["ability_casts", "ability1"]) ?? numberAt(player, ["ability_casts", "ability_1"]);
  const ability2 = numberAt(player, ["ability_casts", "ability2"]) ?? numberAt(player, ["ability_casts", "ability_2"]);
  const ultimate = numberAt(player, ["ability_casts", "ultimate"]);
  const values = [grenade, ability1, ability2, ultimate].filter((value): value is number => value !== null);
  return {
    grenade,
    ability1,
    ability2,
    ultimate,
    total: values.length ? values.reduce((total, value) => total + value, 0) : null,
  };
}

function readTeams(raw: UnknownRecord, players: NormalizedPlayer[]): MatchTeamDetail[] {
  const teams = valueAt(raw, ["teams"]);
  const teamRows = Array.isArray(teams)
    ? teams.filter(isRecord).map((team) => {
        const teamId = stringAt(team, ["team_id"]) ?? stringAt(team, ["id"]) ?? "unknown";
        const roundsWon = numberAt(team, ["rounds", "won"]) ?? numberAt(team, ["rounds_won"]);
        const roundsLost = numberAt(team, ["rounds", "lost"]) ?? numberAt(team, ["rounds_lost"]);
        return makeTeam(
          teamId,
          roundsWon,
          roundsLost,
          normalizeTeamWon(booleanAt(team, ["won"]), roundsWon, roundsLost),
          players,
          stringAt(team, ["average_tier", "name"]),
        );
      })
    : isRecord(teams)
      ? Object.entries(teams)
          .filter(([, score]) => typeof score === "number")
          .map(([teamId, score], _index, allTeams) => {
            const otherScore = allTeams.find(([otherTeamId]) => otherTeamId !== teamId)?.[1];
            const roundsWon = typeof score === "number" ? score : null;
            const roundsLost = typeof otherScore === "number" ? otherScore : null;
            return makeTeam(
              teamId,
              roundsWon,
              roundsLost,
              normalizeTeamWon(null, roundsWon, roundsLost),
              players,
              null,
            );
          })
      : [];

  if (teamRows.length > 0) {
    return teamRows;
  }

  return Array.from(new Set(players.map((player) => player.teamId))).map((teamId) =>
    makeTeam(teamId, null, null, null, players, null),
  );
}

function normalizeTeamWon(
  explicit: boolean | null,
  roundsWon: number | null,
  roundsLost: number | null,
): boolean | null {
  if (roundsWon !== null && roundsLost !== null) {
    if (roundsWon === roundsLost) return null;
    if (explicit === null) return roundsWon > roundsLost;
  }
  return explicit;
}

function readEndState(raw: UnknownRecord, teams: MatchTeamDetail[]): MatchEndState {
  const rawRounds = [valueAt(raw, ["rounds"]), valueAt(raw, ["data", "rounds"])].find(Array.isArray);
  const terminalResults = (Array.isArray(rawRounds) ? rawRounds : [])
    .filter(isRecord)
    .map((round) => stringAt(round, ["result"]) ?? stringAt(round, ["end_type"]))
    .filter((result): result is string => result !== null)
    .map((result) => result.toLowerCase());

  if (terminalResults.some((result) => result.includes("remake"))) {
    return { kind: "remake", label: "Remake", evidence: "round-result" };
  }
  if (terminalResults.some((result) => result.includes("surrender"))) {
    return { kind: "surrendered", label: "Surrendered", evidence: "round-result" };
  }

  const scoredTeams = teams.filter((team) => team.roundsWon !== null);
  if (scoredTeams.length >= 2) {
    const scores = scoredTeams.map((team) => team.roundsWon as number);
    if (scores.some((score) => score > 0) && scores.every((score) => score === scores[0])) {
      return { kind: "draw", label: "Draw", evidence: "team-score" };
    }
  }

  if (teams.some((team) => team.won === true)) {
    return { kind: "completed", label: "Completed", evidence: "team-result" };
  }
  if (valueAt(raw, ["metadata", "is_completed"]) === true) {
    return { kind: "completed", label: "Completed", evidence: "metadata" };
  }
  return { kind: "unknown", label: "End state unavailable", evidence: null };
}

function makeTeam(
  teamId: string,
  roundsWon: number | null,
  roundsLost: number | null,
  won: boolean | null,
  players: NormalizedPlayer[],
  averageTierName: string | null,
): MatchTeamDetail {
  const teamPlayers = players.filter((player) => player.teamId.toLowerCase() === teamId.toLowerCase());
  return {
    teamId,
    label: teamLabel(teamId),
    roundsWon,
    roundsLost,
    won,
    averageTierName: averageTierName ?? deriveAverageTierName(teamPlayers),
    players: teamPlayers.map((player) => enrichPlayerWithTeamRounds(player, roundsWon, roundsLost)),
  };
}

function deriveAverageTierName(players: MatchPlayerDetail[]): string | null {
  const tiers = players
    .map((player) => player.tierId)
    .filter((tierId): tierId is number => tierId !== null && tierId > 2);
  if (!tiers.length) {
    return null;
  }
  const averageTierId = Math.round(tiers.reduce((total, tierId) => total + tierId, 0) / tiers.length);
  return rankNameFromTierId(averageTierId);
}

function rankNameFromTierId(tierId: number): string | null {
  if (tierId === 27) {
    return "Radiant";
  }
  if (tierId < 3 || tierId > 26) {
    return null;
  }
  const divisions = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"];
  const index = tierId - 3;
  const rank = divisions[Math.floor(index / 3)];
  const division = (index % 3) + 1;
  return rank ? `${rank} ${division}` : null;
}

function enrichPlayerWithTeamRounds(
  player: NormalizedPlayer,
  roundsWon: number | null,
  roundsLost: number | null,
): MatchPlayerDetail {
  const { damageDealtTotal, damageReceivedTotal, ...publicPlayer } = player;
  const totalRounds = (roundsWon ?? 0) + (roundsLost ?? 0);
  if (totalRounds <= 0) {
    return { ...publicPlayer, damageDelta: null };
  }

  return {
    ...publicPlayer,
    acs: player.acs ?? (player.score !== null ? player.score / totalRounds : null),
    adr: player.adr ?? (damageDealtTotal !== null ? damageDealtTotal / totalRounds : null),
    damageDelta:
      damageDealtTotal !== null && damageReceivedTotal !== null
        ? (damageDealtTotal - damageReceivedTotal) / totalRounds
        : player.damageDelta === null
          ? null
          : player.damageDelta / totalRounds,
  };
}

function competitiveDamageTotalsByPlayer(
  players: NormalizedPlayer[],
  rounds: MatchRoundDetail[],
  scoredRoundCount: number | null,
): Map<string, CompetitiveDamageTotals> {
  if (scoredRoundCount === null || scoredRoundCount <= 0 || rounds.length !== scoredRoundCount) {
    return new Map();
  }

  const teamByPlayer = new Map(
    players
      .filter((player): player is NormalizedPlayer & { puuid: string } => player.puuid !== null)
      .map((player) => [player.puuid, normalizedTeamKey(player.teamId)]),
  );
  const roundsSeenByPlayer = new Map<string, number>();
  const totals = new Map<string, CompetitiveDamageTotals>();

  for (const round of rounds) {
    for (const playerStat of round.playerStats) {
      if (!playerStat.puuid) continue;
      roundsSeenByPlayer.set(playerStat.puuid, (roundsSeenByPlayer.get(playerStat.puuid) ?? 0) + 1);
      const actorTeam = normalizedTeamKey(playerStat.teamId ?? teamByPlayer.get(playerStat.puuid) ?? "");
      const actorTotals = totals.get(playerStat.puuid) ?? { dealt: 0, received: 0 };

      for (const event of playerStat.damageEvents) {
        const targetTeam = normalizedTeamKey(event.targetTeam ?? teamByPlayer.get(event.targetPuuid ?? "") ?? "");
        if (!actorTeam || !targetTeam || actorTeam === targetTeam) continue;
        actorTotals.dealt += event.damage;
        if (event.targetPuuid) {
          const targetTotals = totals.get(event.targetPuuid) ?? { dealt: 0, received: 0 };
          targetTotals.received += event.damage;
          totals.set(event.targetPuuid, targetTotals);
        }
      }
      totals.set(playerStat.puuid, actorTotals);
    }
  }

  return new Map(Array.from(totals.entries()).filter(([puuid]) => roundsSeenByPlayer.get(puuid) === scoredRoundCount));
}

function scoredRoundCountFromRaw(raw: UnknownRecord): number | null {
  const teams = valueAt(raw, ["teams"]);
  if (Array.isArray(teams)) {
    const totals = teams
      .filter(isRecord)
      .map((team) => {
        const won = numberAt(team, ["rounds", "won"]) ?? numberAt(team, ["rounds_won"]);
        const lost = numberAt(team, ["rounds", "lost"]) ?? numberAt(team, ["rounds_lost"]);
        return won !== null || lost !== null ? (won ?? 0) + (lost ?? 0) : null;
      })
      .filter((value): value is number => value !== null && value > 0);
    return totals.length ? Math.max(...totals) : null;
  }

  if (isRecord(teams)) {
    const scores = Object.values(teams).filter(
      (score): score is number => typeof score === "number" && Number.isFinite(score),
    );
    return scores.length >= 2 ? scores.reduce((total, score) => total + score, 0) : null;
  }

  return null;
}

function readRounds(raw: UnknownRecord, scoredRoundCount: number | null): MatchRoundDetail[] {
  const rounds = valueAt(raw, ["rounds"]);
  if (!Array.isArray(rounds)) {
    return [];
  }

  const cumulativeScores = new Map<string, number>();
  const roundRows = rounds.filter(isRecord);
  const visibleRounds =
    scoredRoundCount !== null && scoredRoundCount > 0 && roundRows.length > scoredRoundCount
      ? roundRows.slice(0, scoredRoundCount)
      : roundRows;
  return visibleRounds.map((round, index) => {
    const winningTeam = stringAt(round, ["winning_team"]) ?? stringAt(round, ["winningTeam"]);
    if (winningTeam) {
      cumulativeScores.set(winningTeam, (cumulativeScores.get(winningTeam) ?? 0) + 1);
    }

    return {
      number: displayRoundNumber(round, index),
      winningTeam,
      result: stringAt(round, ["result"]) ?? stringAt(round, ["end_type"]),
      ceremony: stringAt(round, ["ceremony"]),
      spikePlant: readSpikeEvent(valueAt(round, ["plant"])),
      spikeDefuse: readSpikeEvent(valueAt(round, ["defuse"])),
      teamScores: Array.from(cumulativeScores.entries()).map(([teamId, roundsWon]) => ({ teamId, roundsWon })),
      playerStats: readRoundPlayerStats(round),
    };
  });
}

function displayRoundNumber(round: UnknownRecord, index: number): number {
  const explicitRound = numberAt(round, ["round"]) ?? numberAt(round, ["round_num"]);
  if (explicitRound !== null) {
    return explicitRound === index ? explicitRound + 1 : explicitRound;
  }

  const id = numberAt(round, ["id"]);
  return id !== null ? id + 1 : index + 1;
}

function readSpikeEvent(value: unknown): MatchSpikeEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const player = valueAt(value, ["player"]);
  return {
    playerName: stringAt(player, ["name"]) ?? stringAt(value, ["player_name"]) ?? stringAt(value, ["name"]),
    playerTag: stringAt(player, ["tag"]) ?? stringAt(value, ["player_tag"]) ?? stringAt(value, ["tag"]),
    teamId: stringAt(player, ["team"]) ?? stringAt(value, ["team"]) ?? stringAt(value, ["team_id"]),
    site: stringAt(value, ["site"]) ?? stringAt(value, ["plant_site"]) ?? stringAt(value, ["bomb_site"]),
    timeInRoundMs:
      numberAt(value, ["time_in_round_in_ms"]) ??
      numberAt(value, ["time_in_round_ms"]) ??
      numberAt(value, ["round_time_in_ms"]) ??
      numberAt(value, ["round_time_ms"]),
  };
}

function readRoundPlayerStats(round: UnknownRecord): MatchRoundPlayerStat[] {
  const stats = valueAt(round, ["stats"]);
  if (!Array.isArray(stats)) {
    return [];
  }

  return stats.filter(isRecord).map((row) => {
    const player = valueAt(row, ["player"]);
    const stat = valueAt(row, ["stats"]);
    const economy = valueAt(row, ["economy"]);
    const abilityCasts = readAbilityCasts(row);
    return {
      puuid: stringAt(player, ["puuid"]) ?? stringAt(row, ["puuid"]),
      gameName: stringAt(player, ["name"]) ?? stringAt(row, ["name"]) ?? "Unknown",
      tagLine: stringAt(player, ["tag"]) ?? stringAt(row, ["tag"]),
      teamId: stringAt(player, ["team"]) ?? stringAt(row, ["team"]) ?? stringAt(row, ["team_id"]),
      score: numberAt(stat, ["score"]) ?? numberAt(row, ["score"]),
      kills: numberAt(stat, ["kills"]) ?? numberAt(row, ["kills"]),
      headshots: numberAt(stat, ["headshots"]) ?? numberAt(row, ["headshots"]),
      bodyshots: numberAt(stat, ["bodyshots"]) ?? numberAt(row, ["bodyshots"]),
      legshots: numberAt(stat, ["legshots"]) ?? numberAt(row, ["legshots"]),
      loadoutValue: numberAt(economy, ["loadout_value"]) ?? numberAt(row, ["loadout_value"]),
      remainingCredits: numberAt(economy, ["remaining"]) ?? numberAt(row, ["remaining"]),
      weaponName:
        stringAt(economy, ["weapon", "name"]) ??
        stringAt(economy, ["weapon"]) ??
        stringAt(row, ["weapon", "name"]) ??
        stringAt(row, ["weapon"]),
      armorName:
        stringAt(economy, ["armor", "name"]) ??
        stringAt(economy, ["armor"]) ??
        stringAt(row, ["armor", "name"]) ??
        stringAt(row, ["armor"]),
      damageEvents: readDamageEvents(valueAt(row, ["damage_events"])),
      abilityCasts,
      wasAfk: booleanAt(row, ["was_afk"]) ?? false,
      receivedPenalty: booleanAt(row, ["received_penalty"]) ?? false,
      stayedInSpawn: booleanAt(row, ["stayed_in_spawn"]) ?? false,
    };
  });
}

function readDamageEvents(value: unknown): MatchRoundPlayerStat["damageEvents"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((event) => {
    const target = valueAt(event, ["player"]);
    return {
      targetPuuid: stringAt(target, ["puuid"]) ?? stringAt(event, ["puuid"]),
      targetName: stringAt(target, ["name"]) ?? stringAt(event, ["name"]) ?? "Unknown",
      targetTag: stringAt(target, ["tag"]) ?? stringAt(event, ["tag"]),
      targetTeam: stringAt(target, ["team"]) ?? stringAt(event, ["team"]) ?? stringAt(event, ["team_id"]),
      damage: numberAt(event, ["damage"]) ?? 0,
      headshots: numberAt(event, ["headshots"]) ?? 0,
      bodyshots: numberAt(event, ["bodyshots"]) ?? 0,
      legshots: numberAt(event, ["legshots"]) ?? 0,
    };
  });
}

function readKillEvents(raw: UnknownRecord): MatchKillEvent[] {
  const kills = valueAt(raw, ["kills"]);
  if (!Array.isArray(kills)) {
    return [];
  }

  return kills.filter(isRecord).map((kill) => {
    const killer = valueAt(kill, ["killer"]);
    const victim = valueAt(kill, ["victim"]);
    const assistants = valueAt(kill, ["assistants"]);
    const victimLocation = readPosition(valueAt(kill, ["location"]));
    const playerLocations = readPlayerLocations(valueAt(kill, ["player_locations"]));
    const killerPuuid = stringAt(killer, ["puuid"]);
    const killerName = stringAt(killer, ["name"]) ?? "Unknown";
    const killerTag = stringAt(killer, ["tag"]);
    const killerLocation =
      playerLocations.find((location) =>
        sameIdentity(location.puuid, location.gameName, location.tagLine, killerPuuid, killerName, killerTag),
      )?.location ?? null;
    return {
      round: numberAt(kill, ["round"]),
      timeInRoundMs: numberAt(kill, ["time_in_round_in_ms"]) ?? numberAt(kill, ["time_in_round_ms"]),
      timeInMatchMs: numberAt(kill, ["time_in_match_in_ms"]) ?? numberAt(kill, ["time_in_match_ms"]),
      killerPuuid,
      killerName,
      killerTag,
      killerTeam: stringAt(killer, ["team"]),
      victimPuuid: stringAt(victim, ["puuid"]),
      victimName: stringAt(victim, ["name"]) ?? "Unknown",
      victimTag: stringAt(victim, ["tag"]),
      victimTeam: stringAt(victim, ["team"]),
      weaponName: stringAt(kill, ["weapon", "name"]) ?? stringAt(kill, ["weapon"]),
      assistants: Array.isArray(assistants)
        ? assistants
            .filter(isRecord)
            .map((assistant) => stringAt(assistant, ["name"]))
            .filter((name): name is string => name !== null)
        : [],
      assistantPuuids: Array.isArray(assistants)
        ? assistants
            .filter(isRecord)
            .map((assistant) => stringAt(assistant, ["puuid"]))
            .filter((puuid): puuid is string => puuid !== null)
        : [],
      victimLocation,
      playerLocations,
      distanceMeters:
        victimLocation && killerLocation
          ? Math.hypot(victimLocation.x - killerLocation.x, victimLocation.y - killerLocation.y) / 100
          : null,
    };
  });
}

function readPosition(value: unknown): { x: number; y: number } | null {
  const x = numberAt(value, ["x"]);
  const y = numberAt(value, ["y"]);
  return x === null || y === null ? null : { x, y };
}

function readPlayerLocations(value: unknown): MatchKillEvent["playerLocations"] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((row) => {
    const location = readPosition(valueAt(row, ["location"]));
    if (!location) return [];
    const player = valueAt(row, ["player"]);
    return [
      {
        puuid: stringAt(player, ["puuid"]),
        gameName: stringAt(player, ["name"]) ?? "Unknown",
        tagLine: stringAt(player, ["tag"]),
        teamId: stringAt(player, ["team"]),
        viewRadians: numberAt(row, ["view_radians"]),
        location,
      },
    ];
  });
}

function sameIdentity(
  leftPuuid: string | null,
  leftName: string,
  leftTag: string | null,
  rightPuuid: string | null,
  rightName: string,
  rightTag: string | null,
): boolean {
  if (leftPuuid && rightPuuid) return leftPuuid === rightPuuid;
  return leftName === rightName && leftTag === rightTag;
}

function multikillHighlightsByPlayer(events: MatchKillEvent[]): Map<string, string[]> {
  const roundCountsByPlayer = new Map<string, Map<number, number>>();
  for (const event of events) {
    if (!event.killerPuuid || event.round === null) {
      continue;
    }
    const roundCounts = roundCountsByPlayer.get(event.killerPuuid) ?? new Map<number, number>();
    roundCounts.set(event.round, (roundCounts.get(event.round) ?? 0) + 1);
    roundCountsByPlayer.set(event.killerPuuid, roundCounts);
  }

  return new Map(
    Array.from(roundCountsByPlayer.entries()).map(([puuid, roundCounts]) => [
      puuid,
      Array.from(roundCounts.values())
        .filter((killsInRound) => killsInRound >= 2)
        .sort((left, right) => right - left)
        .map((killsInRound) => `${killsInRound}k`),
    ]),
  );
}

function highestMultikill(highlights: string[]): number | null {
  const values = highlights
    .filter((highlight) => /^\d+k$/.test(highlight))
    .map((highlight) => Number.parseInt(highlight, 10))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function clutchHighlightsByPlayer(
  events: MatchKillEvent[],
  players: MatchPlayerDetail[],
  rounds: MatchRoundDetail[],
): Map<string, string[]> {
  const teamByPlayer = new Map<string, string>();
  const initialAliveByTeam = new Map<string, Set<string>>();
  for (const player of players) {
    if (!player.puuid) {
      continue;
    }
    const teamKey = normalizedTeamKey(player.teamId);
    teamByPlayer.set(player.puuid, teamKey);
    const alive = initialAliveByTeam.get(teamKey) ?? new Set<string>();
    alive.add(player.puuid);
    initialAliveByTeam.set(teamKey, alive);
  }

  const winningTeamByRound = new Map<number, string>();
  for (const round of rounds) {
    if (!round.winningTeam) {
      continue;
    }
    const teamKey = normalizedTeamKey(round.winningTeam);
    winningTeamByRound.set(round.number, teamKey);
    winningTeamByRound.set(round.number - 1, teamKey);
  }

  const maxClutchByPlayer = new Map<string, number[]>();
  const eventsByRound = new Map<number, MatchKillEvent[]>();
  for (const event of events) {
    if (event.round === null || !event.killerPuuid || !event.victimPuuid) {
      continue;
    }
    eventsByRound.set(event.round, [...(eventsByRound.get(event.round) ?? []), event]);
  }

  for (const [roundNumber, roundEvents] of eventsByRound) {
    const winningTeam = winningTeamByRound.get(roundNumber);
    if (!winningTeam) {
      continue;
    }
    const aliveByTeam = cloneAliveTeams(initialAliveByTeam);
    const orderedEvents = [...roundEvents].sort(
      (left, right) => (left.timeInRoundMs ?? 999_999) - (right.timeInRoundMs ?? 999_999),
    );
    const clutchByPlayer = new Map<string, number>();

    for (const event of orderedEvents) {
      if (!event.killerPuuid || !event.victimPuuid) {
        continue;
      }
      const killerTeam = normalizedTeamKey(event.killerTeam ?? teamByPlayer.get(event.killerPuuid) ?? "");
      const victimTeam = normalizedTeamKey(event.victimTeam ?? teamByPlayer.get(event.victimPuuid) ?? "");
      const killerAlive = aliveByTeam.get(killerTeam);
      const victimAlive = aliveByTeam.get(victimTeam);
      if (
        killerTeam === winningTeam &&
        killerAlive?.size === 1 &&
        killerAlive.has(event.killerPuuid) &&
        victimAlive &&
        victimAlive.size >= 1
      ) {
        clutchByPlayer.set(event.killerPuuid, Math.max(clutchByPlayer.get(event.killerPuuid) ?? 0, victimAlive.size));
      }
      victimAlive?.delete(event.victimPuuid);
    }

    for (const [puuid, opponents] of clutchByPlayer) {
      maxClutchByPlayer.set(puuid, [...(maxClutchByPlayer.get(puuid) ?? []), opponents]);
    }
  }

  return new Map(
    Array.from(maxClutchByPlayer.entries()).map(([puuid, values]) => [
      puuid,
      values.sort((left, right) => right - left).map((opponents) => `1v${opponents} Clutch`),
    ]),
  );
}

function cloneAliveTeams(source: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map(Array.from(source.entries()).map(([team, players]) => [team, new Set(players)]));
}

function normalizedTeamKey(value: string): string {
  return value.trim().toLowerCase();
}

function openingDuelsByPlayerFromEvents(
  events: MatchKillEvent[],
): Map<string, { firstKills: number; firstDeaths: number }> {
  const firstKillByRound = new Map<number, MatchKillEvent>();
  for (const event of events) {
    if (event.round === null || !event.killerPuuid || !event.victimPuuid) {
      continue;
    }
    const current = firstKillByRound.get(event.round);
    if (!current || (event.timeInRoundMs ?? 999_999) < (current.timeInRoundMs ?? 999_999)) {
      firstKillByRound.set(event.round, event);
    }
  }

  const result = new Map<string, { firstKills: number; firstDeaths: number }>();
  for (const event of firstKillByRound.values()) {
    if (event.killerPuuid) {
      const current = result.get(event.killerPuuid) ?? { firstKills: 0, firstDeaths: 0 };
      current.firstKills += 1;
      result.set(event.killerPuuid, current);
    }
    if (event.victimPuuid) {
      const current = result.get(event.victimPuuid) ?? { firstKills: 0, firstDeaths: 0 };
      current.firstDeaths += 1;
      result.set(event.victimPuuid, current);
    }
  }
  return result;
}

function countThreePlusKillRoundsByPlayer(events: MatchKillEvent[]): Map<string, number> {
  const killsByPlayerRound = new Map<string, { puuid: string; count: number }>();
  for (const event of events) {
    if (!event.killerPuuid) {
      continue;
    }
    const key = `${event.killerPuuid}:${event.round}`;
    const current = killsByPlayerRound.get(key) ?? { puuid: event.killerPuuid, count: 0 };
    current.count += 1;
    killsByPlayerRound.set(key, current);
  }

  const result = new Map<string, number>();
  for (const row of killsByPlayerRound.values()) {
    if (row.count >= 3) {
      result.set(row.puuid, (result.get(row.puuid) ?? 0) + 1);
    }
  }
  return result;
}

function deriveKastByPlayer(raw: UnknownRecord, scoredRoundCount: number | null): Map<string, number> {
  const players = normalizePlayerCollection(
    valueAt(raw, ["players", "all_players"]) ?? valueAt(raw, ["players"]) ?? valueAt(raw, ["data", "players"]),
  );
  const result = new Map<string, number>();
  for (const player of players) {
    if (!player.puuid) {
      continue;
    }
    const kast = derivePlayerKast(raw, player.puuid, scoredRoundCount);
    if (kast !== null) {
      result.set(player.puuid, kast);
    }
  }
  return result;
}

function stringAt(source: unknown, path: string[]): string | null {
  const value = valueAt(source, path);
  return typeof value === "string" && value.trim() ? value : null;
}

function numberAt(source: unknown, path: string[]): number | null {
  const value = valueAt(source, path);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanAt(source: unknown, path: string[]): boolean | null {
  const value = valueAt(source, path);
  return typeof value === "boolean" ? value : null;
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
