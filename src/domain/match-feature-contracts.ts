import type {
  MatchDetail,
  MatchDuelAnalysis,
  MatchEconomyAnalysis,
  MatchPerformanceAnalysis,
  MatchRoundPlayerStat,
} from "./types";

export const USER_MATCH_FEATURE_VERSION = "user-match-feature-v1" as const;
export const userMatchFeatures = ["performance", "economy", "damage", "objectives", "abilities", "duels"] as const;
export type UserMatchFeature = (typeof userMatchFeatures)[number];

type UserMatchFeatureEnvelopeV1 = {
  version: typeof USER_MATCH_FEATURE_VERSION;
  matchId: string;
  warnings: string[];
};

export type UserMatchFeatureDataV1 = {
  performance: Pick<MatchPerformanceAnalysis, "rounds" | "sideSplits" | "weapons" | "impact">;
  economy: { teams: MatchEconomyAnalysis["teams"] };
  damage: {
    opponents: Array<{
      puuid: string | null;
      riotId: string;
      agent: string | null;
      damageDealt: number;
      damageReceived: number;
      damageDelta: number;
    }>;
  };
  objectives: {
    focus: Pick<MatchPerformanceAnalysis["impact"], "plants" | "defuses">;
    events: Array<{
      roundNumber: number;
      kind: "plant" | "defuse";
      timeInRoundMs: number | null;
      actor: { puuid: string | null; gameName: string; tagLine: string | null; teamId: string | null };
      site: string | null;
    }>;
  };
  abilities: {
    focusPuuid: string;
    rounds: Array<{ roundNumber: number; casts: MatchRoundPlayerStat["abilityCasts"] }>;
  };
  duels: Pick<MatchDuelAnalysis, "matchups" | "topRivalry" | "biggestMismatch" | "crossTeamKills"> & {
    teams: [MatchDuelAnalysis["leftTeam"], MatchDuelAnalysis["rightTeam"]];
  };
};

export type UserMatchFeatureProjectionV1 =
  | (UserMatchFeatureEnvelopeV1 & { feature: UserMatchFeature; available: false; data: null })
  | {
      [Feature in UserMatchFeature]: UserMatchFeatureEnvelopeV1 & {
        feature: Feature;
        available: true;
        data: UserMatchFeatureDataV1[Feature];
      };
    }[UserMatchFeature];

export function buildUserMatchFeatureProjectionV1(
  detail: MatchDetail,
  feature: UserMatchFeature,
  focusPuuid: string | null,
): UserMatchFeatureProjectionV1 {
  const projected = projectFeature(detail, feature, focusPuuid);
  const envelope = {
    version: USER_MATCH_FEATURE_VERSION,
    matchId: detail.matchId,
    feature,
    warnings: playerWarnings(detail, feature),
  };
  return projected === null
    ? { ...envelope, available: false, data: null }
    : ({ ...envelope, available: true, data: projected } as UserMatchFeatureProjectionV1);
}

export function parseUserMatchFeature(value: string | null): UserMatchFeature | null {
  return userMatchFeatures.includes(value as UserMatchFeature) ? (value as UserMatchFeature) : null;
}

export function parseUserMatchFeatureProjectionV1(input: unknown): UserMatchFeatureProjectionV1 {
  const root = exactRecord(input, ["version", "matchId", "feature", "available", "data", "warnings"], "matchFeature");
  if (root.version !== USER_MATCH_FEATURE_VERSION) throw new Error("Invalid user-match-feature-v1 envelope");
  boundedString(root.matchId, "matchId", 1, 160);
  const feature = parseUserMatchFeature(typeof root.feature === "string" ? root.feature : null);
  if (!feature || typeof root.available !== "boolean") throw new Error("Invalid match feature selector");
  strings(root.warnings, "warnings", 20, 300);
  if (!root.available) {
    if (root.data !== null) throw new Error("Unavailable match feature data must be null");
    return input as UserMatchFeatureProjectionV1;
  }
  if (root.data === null) throw new Error("Available match feature data is required");
  if (feature === "performance") parsePerformance(root.data);
  else if (feature === "economy") parseEconomy(root.data);
  else if (feature === "damage") parseDamage(root.data);
  else if (feature === "objectives") parseObjectives(root.data);
  else if (feature === "abilities") parseAbilities(root.data);
  else parseDuels(root.data);
  return input as UserMatchFeatureProjectionV1;
}

function parsePerformance(value: unknown): void {
  const data = exactRecord(value, ["rounds", "sideSplits", "weapons", "impact"], "data");
  boundedArray(data.rounds, "data.rounds", 100).forEach((row, index) =>
    numericRow(
      row,
      ["roundNumber", "side", "kills", "deaths", "assists"],
      ["roundNumber", "kills", "deaths", "assists"],
      `data.rounds[${index}]`,
      { side: ["attack", "defense", null] },
    ),
  );
  boundedArray(data.sideSplits, "data.sideSplits", 2).forEach((row, index) =>
    numericRow(
      row,
      ["side", "rounds", "kills", "deaths", "assists", "kd"],
      ["rounds", "kills", "deaths", "assists", "kd"],
      `data.sideSplits[${index}]`,
      { side: ["attack", "defense"] },
    ),
  );
  boundedArray(data.weapons, "data.weapons", 100).forEach((row, index) => {
    const weapon = exactRecord(
      row,
      ["weaponName", "kills", "averageKillDistanceMeters", "killsWithDistance"],
      `data.weapons[${index}]`,
    );
    boundedString(weapon.weaponName, `data.weapons[${index}].weaponName`, 1, 80);
    for (const key of ["kills", "averageKillDistanceMeters", "killsWithDistance"])
      nullableFinite(weapon[key], `data.weapons[${index}].${key}`);
  });
  const impactKeys = [
    "firstKills",
    "firstDeaths",
    "roundsWonAfterFirstKill",
    "roundsLostAfterFirstDeath",
    "firstKillConversionRate",
    "firstDeathPunishRate",
    "lastDeaths",
    "tradeKills",
    "tradesPerRound",
    "plants",
    "defuses",
    "killsPerMinute",
  ];
  numericRow(data.impact, impactKeys, impactKeys, "data.impact");
}
function parseEconomy(value: unknown): void {
  const data = exactRecord(value, ["teams"], "data");
  boundedArray(data.teams, "data.teams", 4).forEach((row, teamIndex) => {
    const team = exactRecord(
      row,
      [
        "teamId",
        "label",
        "averageBank",
        "averageLoadout",
        "averageTotal",
        "roundsWithData",
        "completeRounds",
        "expectedRounds",
        "rounds",
      ],
      `data.teams[${teamIndex}]`,
    );
    boundedString(team.teamId, "teamId", 1, 80);
    boundedString(team.label, "label", 1, 100);
    for (const key of [
      "averageBank",
      "averageLoadout",
      "averageTotal",
      "roundsWithData",
      "completeRounds",
      "expectedRounds",
    ])
      nullableFinite(team[key], `${key}`);
    boundedArray(team.rounds, "rounds", 100).forEach((round, index) =>
      numericRow(
        round,
        ["roundNumber", "bank", "loadout", "total", "playerSamples", "expectedPlayers", "complete"],
        ["roundNumber", "bank", "loadout", "total", "playerSamples", "expectedPlayers"],
        `data.teams[${teamIndex}].rounds[${index}]`,
        { complete: [true, false] },
      ),
    );
  });
}
function parseDamage(value: unknown): void {
  const data = exactRecord(value, ["opponents"], "data");
  boundedArray(data.opponents, "data.opponents", 20).forEach((row, index) => {
    const opponent = exactRecord(
      row,
      ["puuid", "riotId", "agent", "damageDealt", "damageReceived", "damageDelta"],
      `data.opponents[${index}]`,
    );
    nullableString(opponent.puuid, "puuid", 128);
    boundedString(opponent.riotId, "riotId", 1, 100);
    nullableString(opponent.agent, "agent", 80);
    finite(opponent.damageDealt, "damageDealt");
    finite(opponent.damageReceived, "damageReceived");
    finite(opponent.damageDelta, "damageDelta");
    if (opponent.damageDelta !== (opponent.damageDealt as number) - (opponent.damageReceived as number))
      throw new Error("damageDelta must match dealt minus received");
  });
}
function parseObjectives(value: unknown): void {
  const data = exactRecord(value, ["focus", "events"], "data");
  numericRow(data.focus, ["plants", "defuses"], ["plants", "defuses"], "data.focus");
  boundedArray(data.events, "data.events", 200).forEach((row, index) => {
    const event = exactRecord(row, ["roundNumber", "kind", "timeInRoundMs", "actor", "site"], `data.events[${index}]`);
    finite(event.roundNumber, "roundNumber");
    if (event.kind !== "plant" && event.kind !== "defuse") throw new Error("Invalid objective kind");
    nullableFinite(event.timeInRoundMs, "timeInRoundMs");
    parseActor(event.actor, `data.events[${index}].actor`);
    nullableString(event.site, "site", 32);
  });
}
function parseAbilities(value: unknown): void {
  const data = exactRecord(value, ["focusPuuid", "rounds"], "data");
  boundedString(data.focusPuuid, "focusPuuid", 1, 128);
  boundedArray(data.rounds, "data.rounds", 100).forEach((row, index) => {
    const round = exactRecord(row, ["roundNumber", "casts"], `data.rounds[${index}]`);
    finite(round.roundNumber, "roundNumber");
    numericRow(
      round.casts,
      ["grenade", "ability1", "ability2", "ultimate", "total"],
      ["grenade", "ability1", "ability2", "ultimate", "total"],
      `data.rounds[${index}].casts`,
    );
  });
}
function parseDuels(value: unknown): void {
  const data = exactRecord(value, ["teams", "matchups", "topRivalry", "biggestMismatch", "crossTeamKills"], "data");
  boundedArray(data.teams, "data.teams", 2).forEach((row, index) => {
    const team = exactRecord(row, ["teamId", "label", "players"], `data.teams[${index}]`);
    boundedString(team.teamId, "teamId", 1, 80);
    boundedString(team.label, "label", 1, 100);
    boundedArray(team.players, "players", 10).forEach((player, playerIndex) =>
      parseDuelPlayer(player, `data.teams[${index}].players[${playerIndex}]`),
    );
  });
  boundedArray(data.matchups, "data.matchups", 100).forEach((row, index) =>
    parseMatchup(row, `data.matchups[${index}]`),
  );
  if (data.topRivalry !== null) parseMatchup(data.topRivalry, "data.topRivalry");
  if (data.biggestMismatch !== null) parseMatchup(data.biggestMismatch, "data.biggestMismatch");
  finite(data.crossTeamKills, "crossTeamKills");
}
function parseMatchup(value: unknown, path: string): void {
  const row = exactRecord(value, ["left", "right", "leftKills", "rightKills", "totalKills", "margin"], path);
  parseDuelPlayer(row.left, `${path}.left`);
  parseDuelPlayer(row.right, `${path}.right`);
  for (const key of ["leftKills", "rightKills", "totalKills", "margin"]) finite(row[key], `${path}.${key}`);
}
function parseDuelPlayer(value: unknown, path: string): void {
  const row = exactRecord(value, ["puuid", "gameName", "tagLine", "agentName", "teamId"], path);
  nullableString(row.puuid, `${path}.puuid`, 128);
  boundedString(row.gameName, `${path}.gameName`, 1, 64);
  nullableString(row.tagLine, `${path}.tagLine`, 32);
  nullableString(row.agentName, `${path}.agentName`, 80);
  boundedString(row.teamId, `${path}.teamId`, 1, 80);
}
function parseActor(value: unknown, path: string): void {
  const row = exactRecord(value, ["puuid", "gameName", "tagLine", "teamId"], path);
  nullableString(row.puuid, `${path}.puuid`, 128);
  boundedString(row.gameName, `${path}.gameName`, 1, 64);
  nullableString(row.tagLine, `${path}.tagLine`, 32);
  nullableString(row.teamId, `${path}.teamId`, 80);
}
function numericRow(
  value: unknown,
  keys: string[],
  numericKeys: string[],
  path: string,
  enums: Record<string, readonly unknown[]> = {},
): void {
  const row = exactRecord(value, keys, path);
  for (const key of numericKeys) nullableFinite(row[key], `${path}.${key}`);
  for (const [key, values] of Object.entries(enums))
    if (!values.includes(row[key])) throw new Error(`${path}.${key} is invalid`);
}
function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.includes(key)) || keys.some((key) => !(key in row)))
    throw new Error(`${path} has an invalid shape`);
  return row;
}
function boundedArray(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${path} must contain at most ${max} items`);
  return value;
}
function boundedString(value: unknown, path: string, min: number, max: number): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max)
    throw new Error(`${path} must be a bounded string`);
}
function nullableString(value: unknown, path: string, max: number): void {
  if (value !== null) boundedString(value, path, 0, max);
}
function finite(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}
function nullableFinite(value: unknown, path: string): void {
  if (value !== null) finite(value, path);
}
function strings(value: unknown, path: string, max: number, maxLength: number): void {
  boundedArray(value, path, max).forEach((entry, index) => boundedString(entry, `${path}[${index}]`, 0, maxLength));
}

function projectFeature(
  detail: MatchDetail,
  feature: UserMatchFeature,
  focusPuuid: string | null,
): UserMatchFeatureDataV1[UserMatchFeature] | null {
  if (feature === "performance")
    return detail.performance
      ? {
          rounds: detail.performance.rounds,
          sideSplits: detail.performance.sideSplits,
          weapons: detail.performance.weapons,
          impact: detail.performance.impact,
        }
      : null;
  if (feature === "economy")
    return detail.economy
      ? {
          teams: detail.economy.teams.map((team) => ({
            teamId: team.teamId,
            label: team.label,
            averageBank: team.averageBank,
            averageLoadout: team.averageLoadout,
            averageTotal: team.averageTotal,
            roundsWithData: team.roundsWithData,
            completeRounds: team.completeRounds,
            expectedRounds: team.expectedRounds,
            rounds: team.rounds,
          })),
        }
      : null;
  if (feature === "damage")
    return detail.performance
      ? {
          opponents: detail.performance.opponents.map(
            ({ puuid, gameName, tagLine, agentName, damageDealt, damageReceived }) => ({
              puuid,
              riotId: `${gameName}#${tagLine ?? ""}`,
              agent: agentName,
              damageDealt,
              damageReceived,
              damageDelta: damageDealt - damageReceived,
            }),
          ),
        }
      : null;
  if (feature === "objectives")
    return detail.performance
      ? {
          focus: { plants: detail.performance.impact.plants, defuses: detail.performance.impact.defuses },
          events: (detail.roundEvidence?.rounds ?? []).flatMap((round) =>
            round.events
              .filter((event): event is typeof event & { kind: "plant" | "defuse" } => event.kind !== "kill")
              .map((event) => ({
                roundNumber: round.roundNumber,
                kind: event.kind,
                timeInRoundMs: event.timeInRoundMs,
                actor: event.actor,
                site: event.site,
              })),
          ),
        }
      : null;
  if (feature === "abilities") {
    if (!focusPuuid) return null;
    const rounds = detail.rounds.flatMap((round) => {
      const player = round.playerStats.find((entry) => entry.puuid === focusPuuid);
      return player ? [{ roundNumber: round.number, casts: player.abilityCasts }] : [];
    });
    return rounds.length ? { focusPuuid, rounds } : null;
  }
  return detail.duels
    ? {
        teams: [detail.duels.leftTeam, detail.duels.rightTeam],
        matchups: detail.duels.matchups,
        topRivalry: detail.duels.topRivalry,
        biggestMismatch: detail.duels.biggestMismatch,
        crossTeamKills: detail.duels.crossTeamKills,
      }
    : null;
}

function playerWarnings(detail: MatchDetail, feature: UserMatchFeature): string[] {
  const source =
    feature === "performance"
      ? detail.performance?.warnings
      : feature === "economy"
        ? detail.economy?.warnings
        : feature === "duels"
          ? detail.duels?.warnings
          : [];
  return (source ?? []).map((warning) =>
    /provider|api|cache|payload|source|database/i.test(warning)
      ? "Some stored evidence required for this view is unavailable."
      : warning,
  );
}
