import type { MatchDetail } from "../domain/types";

export type EvidenceCapability = {
  state: "complete" | "partial" | "unavailable" | "unknown";
  available: number;
  expected: number | null;
};
export type MatchCompleteness = {
  roster: EvidenceCapability;
  scoreboard: EvidenceCapability;
  rounds: EvidenceCapability;
  kills: EvidenceCapability;
  economy: EvidenceCapability;
  objectives: EvidenceCapability;
  positions: EvidenceCapability;
  facing: EvidenceCapability;
};

const standardModes = new Set(["competitive", "unrated", "swiftplay", "spikerush", "premier"]);
export function matchCompleteness(detail: MatchDetail, raw?: unknown): MatchCompleteness {
  const players = detail.teams.flatMap((team) => team.players);
  const mode = detail.mode.toLowerCase().replace(/[^a-z]/g, "");
  const roundBased = !["deathmatch", "teamdeathmatch", "escalation"].includes(mode);
  const expectedRoster = standardModes.has(mode) ? 10 : null;
  const scores = detail.teams.map((team) => team.roundsWon);
  const expectedRounds =
    roundBased && scores.length === 2 && scores.every((score) => score !== null)
      ? scores.reduce<number>((sum, score) => sum + score!, 0)
      : null;
  const scoredPlayers = players.filter((p) => p.kills !== null && p.deaths !== null && p.assists !== null);
  const roster = capability(new Set(players.map((p) => p.puuid).filter(Boolean)).size, expectedRoster);
  const scoreboard = capability(scoredPlayers.length, expectedRoster ?? (players.length || null));
  const sortedRounds = [...detail.rounds].sort((a, b) => a.number - b.number);
  const validRounds = sortedRounds.filter(
    (round, index) => round.number === index + 1 && round.winningTeam !== null,
  ).length;
  const rounds = capability(
    validRounds,
    expectedRounds,
    validRounds > 0 ||
      (detail.endState.kind === "remake" && Array.isArray((raw as Record<string, unknown> | undefined)?.rounds)),
  );
  if (
    rounds.state === "complete" &&
    detail.teams.some(
      (team) =>
        detail.rounds.filter((round) => round.winningTeam?.toLowerCase() === team.teamId.toLowerCase()).length !==
        team.roundsWon,
    )
  )
    rounds.state = "partial";
  const expectedKills =
    players.length && players.every((p) => p.kills !== null) ? players.reduce((sum, p) => sum + p.kills!, 0) : null;
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const explicitKills = Array.isArray(source?.kills) || detail.killEvents.length > 0;
  const kills = capability(detail.killEvents.length, expectedKills, explicitKills);
  const rosterIds = new Set(players.map((p) => p.puuid));
  const uniqueKills = new Set(
    detail.killEvents.map((k) =>
      JSON.stringify([k.round, k.timeInRoundMs, k.killerPuuid, k.victimPuuid, k.weaponName]),
    ),
  );
  if (
    kills.state === "complete" &&
    (uniqueKills.size !== detail.killEvents.length ||
      detail.killEvents.some(
        (k) => !k.killerPuuid || !k.victimPuuid || !rosterIds.has(k.killerPuuid) || !rosterIds.has(k.victimPuuid),
      ))
  )
    kills.state = "partial";
  // Matching totals alone do not establish coverage when roster or round evidence is missing.
  if (kills.state === "complete" && (roster.state !== "complete" || (roundBased && rounds.state !== "complete")))
    kills.state = "partial";
  const roundSamples = detail.rounds.flatMap((round) => round.playerStats);
  const economy = capability(
    roundSamples.filter((p) => p.loadoutValue !== null && p.remainingCredits !== null).length,
    expectedRounds !== null && expectedRoster !== null ? expectedRounds * expectedRoster : null,
  );
  const objectives = capability(detail.rounds.filter((r) => r.spikePlant || r.spikeDefuse).length, null);
  // A missing objective record cannot establish that no plant occurred.
  const positions = capability(
    detail.killEvents.filter((k) => k.victimLocation || k.playerLocations.length).length,
    null,
  );
  const facing = capability(
    detail.killEvents.filter((k) => k.playerLocations.some((p) => p.viewRadians !== null)).length,
    null,
  );
  return { roster, scoreboard, rounds, kills, economy, objectives, positions, facing };
}

function capability(available: number, expected: number | null, present = available > 0): EvidenceCapability {
  return {
    available,
    expected,
    state:
      expected !== null && available === expected && (present || expected > 0)
        ? "complete"
        : available > 0
          ? "partial"
          : present
            ? "unknown"
            : "unavailable",
  };
}

export function completenessWarnings(evidence: MatchCompleteness): string[] {
  return (["roster", "scoreboard", "rounds", "kills"] as const)
    .filter((key) => evidence[key].state !== "complete")
    .map(
      (key) =>
        `${key} evidence is ${evidence[key].state}: ${evidence[key].available} available, ${evidence[key].expected ?? "unknown"} expected. Missing evidence does not establish zero events; explicitly refresh this match to check for richer provider data.`,
    );
}

export function canReuseListedMatch(detail: MatchDetail, required: "scoreboard" | "tactical" = "tactical"): boolean {
  const evidence = detail.evidence ?? matchCompleteness(detail);
  return (
    evidence.roster.state === "complete" &&
    evidence.scoreboard.state === "complete" &&
    (required === "scoreboard" ||
      (evidence.kills.state === "complete" &&
        (["deathmatch", "teamdeathmatch", "escalation"].includes(detail.mode.toLowerCase().replace(/[^a-z]/g, "")) ||
          evidence.rounds.state === "complete")))
  );
}

// Refuse evidence tradeoffs. A bigger payload must not erase a smaller but valid dimension.
export function losesEvidence(previous: MatchDetail, next: MatchDetail): boolean {
  const before = previous.evidence ?? matchCompleteness(previous);
  const after = next.evidence ?? matchCompleteness(next);
  return (Object.keys(before) as Array<keyof MatchCompleteness>).some(
    (key) =>
      after[key].available < before[key].available ||
      (before[key].state === "complete" && after[key].state !== "complete"),
  );
}
