import type { CoachingEvidenceCoverage, CoachingProjection, MatchDetail, MatchRoundEvidenceAnalysis } from "./types";

export const USER_MATCH_PROJECTION_VERSION = "user-match-v1" as const;
export const USER_ROUND_PROJECTION_VERSION = "user-round-evidence-v1" as const;
export const USER_COACHING_PROJECTION_VERSION = "user-coaching-v1" as const;

export type UserMatchProjectionV1 = {
  version: typeof USER_MATCH_PROJECTION_VERSION;
  match: {
    matchId: string;
    platform: string;
    mode: string;
    map: string | null;
    patch: string | null;
    startedAt: string | null;
    durationMs: number | null;
    averageTier: string | null;
    endState: MatchDetail["endState"];
  };
  teams: Array<{
    teamId: string;
    label: string;
    score: number | null;
    won: boolean | null;
    averageTier: string | null;
    players: Array<{
      puuid: string | null;
      riotId: string;
      agent: string | null;
      tier: string | null;
      combat: {
        kills: number | null;
        deaths: number | null;
        assists: number | null;
        acs: number | null;
        adr: number | null;
        damageDelta: number | null;
        headshotRate: number | null;
        kast: number | null;
        firstKills: number | null;
        firstDeaths: number | null;
      };
    }>;
  }>;
  coverage: {
    rounds: "available" | "unavailable";
    events: "available" | "unavailable";
    economy: "available" | "partial" | "unavailable";
    coaching: "available" | "unavailable";
  };
  focus: {
    puuid: string;
    rrDelta: number | null;
  } | null;
  warnings: string[];
};

export type UserRoundEvidenceProjectionV1 = {
  version: typeof USER_ROUND_PROJECTION_VERSION;
  matchId: string;
  rounds: MatchRoundEvidenceAnalysis["rounds"];
  coverage: MatchRoundEvidenceAnalysis["evidence"];
  limitations: string[];
};

export type UserCoachingProjectionV1 = {
  version: typeof USER_COACHING_PROJECTION_VERSION;
  matchId: string;
  generatedAt: string;
  coverage: Omit<CoachingEvidenceCoverage, "sources"> & {
    evidenceAgreement: "aligned" | "conflict" | "unknown";
  };
  claims: CoachingProjection["claims"];
  strengths: string[];
  practicePriorities: string[];
  limitations: string[];
};

export function buildUserMatchProjectionV1(
  detail: MatchDetail,
  focusPuuid: string | null = null,
): UserMatchProjectionV1 {
  return {
    version: USER_MATCH_PROJECTION_VERSION,
    match: {
      matchId: detail.matchId,
      platform: detail.platform,
      mode: detail.mode,
      map: detail.mapName,
      patch: detail.patch,
      startedAt: detail.startedAt,
      durationMs: detail.durationMs,
      averageTier: detail.averageTierName,
      endState: detail.endState,
    },
    teams: detail.teams.map((team) => ({
      teamId: team.teamId,
      label: team.label,
      score: team.roundsWon,
      won: team.won,
      averageTier: team.averageTierName,
      players: team.players.map((player) => ({
        puuid: player.puuid,
        riotId: player.tagLine ? `${player.gameName}#${player.tagLine}` : player.gameName,
        agent: player.agentName,
        tier: player.tierName,
        combat: {
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          acs: player.acs,
          adr: player.adr,
          damageDelta: player.damageDelta,
          headshotRate: player.headshotRate,
          kast: player.kast,
          firstKills: player.firstKills,
          firstDeaths: player.firstDeaths,
        },
      })),
    })),
    coverage: {
      rounds: detail.rounds.length ? "available" : "unavailable",
      events: detail.killEvents.length ? "available" : "unavailable",
      economy: detail.economy?.teams.some((team) => team.completeRounds === team.expectedRounds)
        ? "available"
        : detail.economy?.teams.some((team) => team.roundsWithData > 0)
          ? "partial"
          : "unavailable",
      coaching: detail.coaching ? "available" : "unavailable",
    },
    focus: focusPuuid ? { puuid: focusPuuid, rrDelta: detail.focusRankChange?.rrDelta ?? null } : null,
    warnings: detail.warnings.map(playerFacingLimitation),
  };
}

export function buildUserRoundEvidenceProjectionV1(detail: MatchDetail): UserRoundEvidenceProjectionV1 | null {
  const evidence = detail.roundEvidence;
  if (!evidence) return null;
  return {
    version: USER_ROUND_PROJECTION_VERSION,
    matchId: detail.matchId,
    rounds: evidence.rounds,
    coverage: evidence.evidence,
    limitations: evidence.warnings.map(playerFacingLimitation),
  };
}

export function buildUserCoachingProjectionV1(
  coaching: CoachingProjection | null | undefined,
): UserCoachingProjectionV1 | null {
  if (!coaching) return null;
  const { sources, ...coverage } = coaching.coverage;
  return {
    version: USER_COACHING_PROJECTION_VERSION,
    matchId: coaching.matchId,
    generatedAt: coaching.generatedAt,
    coverage: { ...coverage, evidenceAgreement: sources?.conflictState ?? "unknown" },
    claims: coaching.claims.map((claim) => ({
      ...claim,
      text: playerFacingCoachingText(claim.text),
      evidenceIds: claim.evidenceIds.map((id, index) =>
        id.startsWith("source:") ? `stored-evidence:${index + 1}` : id,
      ),
    })),
    strengths: coaching.strengths.map(playerFacingCoachingText),
    practicePriorities: coaching.practicePriorities.map(playerFacingCoachingText),
    limitations: coaching.limitations.map(playerFacingCoachingText),
  };
}

export function parseUserMatchProjectionV1(input: unknown): UserMatchProjectionV1 {
  const root = strictRecord(input, ["version", "match", "teams", "coverage", "focus", "warnings"], "match projection");
  if (root.version !== USER_MATCH_PROJECTION_VERSION) throw new Error("Unsupported user match projection version");
  const match = strictRecord(
    root.match,
    ["matchId", "platform", "mode", "map", "patch", "startedAt", "durationMs", "averageTier", "endState"],
    "match",
  );
  string(match.matchId, "match.matchId");
  string(match.platform, "match.platform");
  string(match.mode, "match.mode");
  nullableString(match.map, "match.map");
  nullableString(match.patch, "match.patch");
  nullableString(match.startedAt, "match.startedAt");
  nullableNumber(match.durationMs, "match.durationMs");
  nullableString(match.averageTier, "match.averageTier");
  const endState = strictRecord(match.endState, ["kind", "label", "evidence"], "match.endState");
  oneOf(endState.kind, ["completed", "surrendered", "remake", "draw", "unknown"], "match.endState.kind");
  string(endState.label, "match.endState.label");
  nullableString(endState.evidence, "match.endState.evidence");
  array(root.teams, "teams").forEach(parseTeam);
  const coverage = strictRecord(root.coverage, ["rounds", "events", "economy", "coaching"], "coverage");
  oneOf(coverage.rounds, ["available", "unavailable"], "coverage.rounds");
  oneOf(coverage.events, ["available", "unavailable"], "coverage.events");
  oneOf(coverage.economy, ["available", "partial", "unavailable"], "coverage.economy");
  oneOf(coverage.coaching, ["available", "unavailable"], "coverage.coaching");
  if (root.focus !== null) {
    const focus = strictRecord(root.focus, ["puuid", "rrDelta"], "focus");
    string(focus.puuid, "focus.puuid");
    nullableNumber(focus.rrDelta, "focus.rrDelta");
  }
  array(root.warnings, "warnings").forEach((value, index) => string(value, `warnings[${index}]`));
  return input as UserMatchProjectionV1;
}

export function parseUserRoundEvidenceProjectionV1(input: unknown): UserRoundEvidenceProjectionV1 {
  const root = strictRecord(input, ["version", "matchId", "rounds", "coverage", "limitations"], "round projection");
  if (root.version !== USER_ROUND_PROJECTION_VERSION) throw new Error("Unsupported user round projection version");
  string(root.matchId, "matchId");
  array(root.rounds, "rounds").forEach((entry, index) => {
    const round = strictRecord(
      entry,
      ["roundNumber", "winningTeam", "result", "players", "events"],
      `rounds[${index}]`,
    );
    number(round.roundNumber, `rounds[${index}].roundNumber`);
    nullableString(round.winningTeam, `rounds[${index}].winningTeam`);
    nullableString(round.result, `rounds[${index}].result`);
    array(round.players, `rounds[${index}].players`).forEach((player, playerIndex) =>
      parseRoundPlayer(player, `${index}`, playerIndex),
    );
    array(round.events, `rounds[${index}].events`).forEach((event, eventIndex) =>
      parseRoundEvent(event, `${index}`, eventIndex),
    );
  });
  const coverage = strictRecord(
    root.coverage,
    ["rounds", "killEvents", "killsWithDistance", "killsWithPlayerLocations"],
    "coverage",
  );
  for (const key of ["rounds", "killEvents", "killsWithDistance", "killsWithPlayerLocations"] as const)
    number(coverage[key], `coverage.${key}`);
  array(root.limitations, "limitations").forEach((value, index) => string(value, `limitations[${index}]`));
  return input as UserRoundEvidenceProjectionV1;
}

export function parseUserCoachingProjectionV1(input: unknown): UserCoachingProjectionV1 {
  const root = strictRecord(
    input,
    ["version", "matchId", "generatedAt", "coverage", "claims", "strengths", "practicePriorities", "limitations"],
    "coaching projection",
  );
  if (root.version !== USER_COACHING_PROJECTION_VERSION)
    throw new Error("Unsupported user coaching projection version");
  string(root.matchId, "matchId");
  string(root.generatedAt, "generatedAt");
  const coverage = strictRecord(
    root.coverage,
    [
      "rounds",
      "killEvents",
      "economyRounds",
      "objectives",
      "continuousPov",
      "comms",
      "intent",
      "crosshairPlacement",
      "continuousMovement",
      "evidenceAgreement",
    ],
    "coverage",
  );
  parseAvailableExpected(coverage.rounds, "coverage.rounds");
  const killEvents = strictRecord(coverage.killEvents, ["available", "positioned"], "coverage.killEvents");
  number(killEvents.available, "coverage.killEvents.available");
  number(killEvents.positioned, "coverage.killEvents.positioned");
  const economyRounds = strictRecord(coverage.economyRounds, ["available", "complete"], "coverage.economyRounds");
  number(economyRounds.available, "coverage.economyRounds.available");
  number(economyRounds.complete, "coverage.economyRounds.complete");
  const objectives = strictRecord(coverage.objectives, ["available"], "coverage.objectives");
  number(objectives.available, "coverage.objectives.available");
  oneOf(coverage.evidenceAgreement, ["aligned", "conflict", "unknown"], "coverage.evidenceAgreement");
  for (const key of ["continuousPov", "comms", "intent", "crosshairPlacement", "continuousMovement"] as const) {
    if (coverage[key] !== false) throw new Error(`coverage.${key} must be false`);
  }
  array(root.claims, "claims").forEach((entry, index) => {
    const claim = strictRecord(entry, ["id", "label", "confidence", "text", "evidenceIds"], `claims[${index}]`);
    string(claim.id, `claims[${index}].id`);
    oneOf(claim.label, ["observed", "derived", "inference"], `claims[${index}].label`);
    oneOf(claim.confidence, ["low", "medium", "high"], `claims[${index}].confidence`);
    string(claim.text, `claims[${index}].text`);
    array(claim.evidenceIds, `claims[${index}].evidenceIds`).forEach((value, evidenceIndex) =>
      string(value, `claims[${index}].evidenceIds[${evidenceIndex}]`),
    );
  });
  for (const key of ["strengths", "practicePriorities", "limitations"] as const)
    array(root[key], key).forEach((value, index) => string(value, `${key}[${index}]`));
  return input as UserCoachingProjectionV1;
}

function parseTeam(input: unknown, index: number): void {
  const team = strictRecord(input, ["teamId", "label", "score", "won", "averageTier", "players"], `teams[${index}]`);
  string(team.teamId, `teams[${index}].teamId`);
  string(team.label, `teams[${index}].label`);
  nullableNumber(team.score, `teams[${index}].score`);
  if (team.won !== null) boolean(team.won, `teams[${index}].won`);
  nullableString(team.averageTier, `teams[${index}].averageTier`);
  array(team.players, `teams[${index}].players`).forEach((entry, playerIndex) => {
    const path = `teams[${index}].players[${playerIndex}]`;
    const player = strictRecord(entry, ["puuid", "riotId", "agent", "tier", "combat"], path);
    nullableString(player.puuid, `${path}.puuid`);
    string(player.riotId, `${path}.riotId`);
    nullableString(player.agent, `${path}.agent`);
    nullableString(player.tier, `${path}.tier`);
    const combat = strictRecord(
      player.combat,
      ["kills", "deaths", "assists", "acs", "adr", "damageDelta", "headshotRate", "kast", "firstKills", "firstDeaths"],
      `${path}.combat`,
    );
    for (const key of Object.keys(combat)) nullableNumber(combat[key], `${path}.combat.${key}`);
  });
}

function parseRoundPlayer(input: unknown, roundIndex: string, playerIndex: number): void {
  const path = `rounds[${roundIndex}].players[${playerIndex}]`;
  const player = strictRecord(
    input,
    [
      "puuid",
      "gameName",
      "tagLine",
      "teamId",
      "agentName",
      "score",
      "kills",
      "deaths",
      "assists",
      "loadoutValue",
      "remainingCredits",
      "weaponName",
      "armorName",
    ],
    path,
  );
  nullableString(player.puuid, `${path}.puuid`);
  string(player.gameName, `${path}.gameName`);
  nullableString(player.tagLine, `${path}.tagLine`);
  nullableString(player.teamId, `${path}.teamId`);
  nullableString(player.agentName, `${path}.agentName`);
  nullableNumber(player.score, `${path}.score`);
  number(player.kills, `${path}.kills`);
  number(player.deaths, `${path}.deaths`);
  number(player.assists, `${path}.assists`);
  nullableNumber(player.loadoutValue, `${path}.loadoutValue`);
  nullableNumber(player.remainingCredits, `${path}.remainingCredits`);
  nullableString(player.weaponName, `${path}.weaponName`);
  nullableString(player.armorName, `${path}.armorName`);
}

function parseRoundEvent(input: unknown, roundIndex: string, eventIndex: number): void {
  const path = `rounds[${roundIndex}].events[${eventIndex}]`;
  const event = strictRecord(
    input,
    [
      "id",
      "kind",
      "timeInRoundMs",
      "actor",
      "target",
      "weaponName",
      "assistants",
      "distanceMeters",
      "targetLocation",
      "playerLocations",
      "site",
    ],
    path,
  );
  string(event.id, `${path}.id`);
  oneOf(event.kind, ["kill", "plant", "defuse"], `${path}.kind`);
  nullableNumber(event.timeInRoundMs, `${path}.timeInRoundMs`);
  parseRoundActor(event.actor, `${path}.actor`);
  if (event.target !== null) parseRoundActor(event.target, `${path}.target`);
  nullableString(event.weaponName, `${path}.weaponName`);
  array(event.assistants, `${path}.assistants`).forEach((value, index) =>
    string(value, `${path}.assistants[${index}]`),
  );
  nullableNumber(event.distanceMeters, `${path}.distanceMeters`);
  if (event.targetLocation !== null) parsePosition(event.targetLocation, `${path}.targetLocation`);
  array(event.playerLocations, `${path}.playerLocations`).forEach((value, index) => {
    const locationPath = `${path}.playerLocations[${index}]`;
    const location = strictRecord(
      value,
      ["puuid", "gameName", "tagLine", "teamId", "viewRadians", "location"],
      locationPath,
    );
    nullableString(location.puuid, `${locationPath}.puuid`);
    string(location.gameName, `${locationPath}.gameName`);
    nullableString(location.tagLine, `${locationPath}.tagLine`);
    nullableString(location.teamId, `${locationPath}.teamId`);
    nullableNumber(location.viewRadians, `${locationPath}.viewRadians`);
    parsePosition(location.location, `${locationPath}.location`);
  });
  nullableString(event.site, `${path}.site`);
}

function parseRoundActor(input: unknown, path: string): void {
  const actor = strictRecord(input, ["puuid", "gameName", "tagLine", "teamId"], path);
  nullableString(actor.puuid, `${path}.puuid`);
  string(actor.gameName, `${path}.gameName`);
  nullableString(actor.tagLine, `${path}.tagLine`);
  nullableString(actor.teamId, `${path}.teamId`);
}

function parsePosition(input: unknown, path: string): void {
  const position = strictRecord(input, ["x", "y"], path);
  number(position.x, `${path}.x`);
  number(position.y, `${path}.y`);
}

function parseAvailableExpected(input: unknown, path: string): void {
  const value = strictRecord(input, ["available", "expected"], path);
  number(value.available, `${path}.available`);
  nullableNumber(value.expected, `${path}.expected`);
}

function playerFacingLimitation(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("provider") || lower.includes("henrik") || lower.includes("cache") || lower.includes("database"))
    return "Some saved match evidence is unavailable or still being repaired.";
  return message;
}

function playerFacingCoachingText(message: string): string {
  return message
    .replace(/stored providers?/gi, "stored evidence revisions")
    .replace(/provider revisions?/gi, "evidence revisions")
    .replace(/provider/gi, "evidence source");
}

function strictRecord(input: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${path} must be an object`);
  const record = input as Record<string, unknown>;
  for (const key of keys) if (!(key in record)) throw new Error(`${path} missing field ${key}`);
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new Error(`${path} unknown field ${key}`);
  return record;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}
function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
}
function number(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}
function boolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}
function nullableString(value: unknown, path: string): void {
  if (value !== null) string(value, path);
}
function nullableNumber(value: unknown, path: string): void {
  if (value !== null) number(value, path);
}
function oneOf(value: unknown, choices: readonly string[], path: string): void {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`${path} has an unsupported value`);
}
