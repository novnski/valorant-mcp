import { describe, expect, test } from "bun:test";

import type { MatchDetail, MatchKillEvent, MatchPlayerDetail, MatchRoundDetail } from "../domain/types";
import { MatchRoundEvidenceService } from "../services/match-round-evidence-service";
import { RoundAnalysisService } from "../services/round-analysis-service";
import { sanitizedMatchDetail } from "./test-fixture";
import {
  buildDuelReplay,
  buildMatchTimeline,
  buildPositionReview,
  buildRoundKillList,
  buildRoundIntelligence,
  buildTacticalSnapshot,
  resolveMatchPlayer,
  resolveRoundNumber,
  reviewPlayerDeaths,
} from "./round-intelligence";

describe("round intelligence", () => {
  test("resolves a round from the focus-perspective score before the round", () => {
    const detail = evidenceMatch();
    expect(resolveRoundNumber(detail, { score: "1-0", scoreTiming: "before", focusPuuid: "focus" })).toMatchObject({
      roundNumber: 2,
      matchedBy: "score-before",
      score: { focusBeforeLabel: "1-0", focusAfterLabel: "1-1" },
    });
  });

  test("builds opening, trade, man-advantage, and closing context without assigning blame", () => {
    const intelligence = buildRoundIntelligence(evidenceMatch(), 2, "focus");

    expect(intelligence).toMatchObject({
      winner: { teamId: "Red", result: "Elimination" },
      focus: { outcome: "loss", deaths: 1 },
      score: { focusBeforeLabel: "1-0", focusAfterLabel: "1-1" },
    });
    expect(intelligence.timeline[0]).toMatchObject({
      id: "r2-kill-0",
      tags: expect.arrayContaining(["opening-kill", "focus-death", "traded"]),
      trade: { eventId: "r2-kill-1", delayMs: 3_000 },
    });
    expect(intelligence.timeline.at(-1)).toMatchObject({
      id: "r2-kill-2",
      tags: expect.arrayContaining(["closing-kill"]),
    });
    expect(intelligence.observedFacts.join(" ")).toContain("started 1-0 and ended 1-1");
    expect(intelligence.limitations.join(" ")).toContain("not continuous movement");
  });

  test("finds a player's death by agent name, score, and round range", () => {
    const review = reviewPlayerDeaths(evidenceMatch(), {
      player: "Phoenix",
      roundFrom: 2,
      roundTo: 6,
      score: "1-0",
      scoreTiming: "before",
    });

    expect(review).toMatchObject({
      player: { puuid: "focus", agentName: "Phoenix" },
      totalDeaths: 1,
      selectedIndex: 1,
      selected: { eventId: "r2-kill-0", roundNumber: 2, weaponName: "Vandal", focusTeamOutcome: "loss" },
      navigation: { buttonChoices: ["Explain this round", "Show this duel"] },
    });
    expect(review.selected?.impact).toContain("opening death conceded the first man disadvantage");
    expect(review.selected?.impact.join(" ")).toContain("traded by Ally#EU after 3.0s");
  });

  test("defaults the replay to the focus player's death and only resolves the duel pair", () => {
    const replay = buildDuelReplay(evidenceMatch(), { roundNumber: 2, focusPuuid: "focus" });
    expect(replay).toMatchObject({
      eventId: "r2-kill-0",
      eventIndex: 1,
      eventCount: 3,
      nextEventId: "r2-kill-1",
      nextEventLabel: "Kill 2: Sage killed Omen at 0:13",
      killer: { gameName: "Enemy", agentName: "Omen" },
      victim: { gameName: "Focus", agentName: "Phoenix" },
      weaponName: "Vandal",
      trade: { eventId: "r2-kill-1" },
    });
    expect(replay.killerPosition).not.toBeNull();
    expect(replay.victimPosition).not.toBeNull();
  });

  test("builds a numbered human kill list backed by internal event IDs", () => {
    const list = buildRoundKillList(evidenceMatch(), 2, "focus");
    expect(list.kills.map((kill) => [kill.number, kill.label, kill.eventId])).toEqual([
      [1, "Kill 1: Omen killed Phoenix at 0:10", "r2-kill-0"],
      [2, "Kill 2: Sage killed Omen at 0:13", "r2-kill-1"],
      [3, "Kill 3: Jett killed Sage at 0:20", "r2-kill-2"],
    ]);
  });

  test("builds a dynamic snapshot for arbitrary additional players", () => {
    const snapshot = buildTacticalSnapshot(evidenceMatch(), {
      roundNumber: 2,
      eventId: "r2-kill-0",
      focusPuuid: "focus",
      players: ["Sage", "Jett"],
    });
    expect(snapshot.markers).toHaveLength(4);
    expect(snapshot.markers.map((marker) => [marker.player.agentName, marker.role, marker.relation])).toEqual([
      ["Omen", "killer", "enemy"],
      ["Phoenix", "victim", "focus"],
      ["Sage", "selected", "ally"],
      ["Jett", "selected", "enemy"],
    ]);
    expect(
      snapshot.markers.filter((marker) => marker.role !== "victim").every((marker) => marker.mapFacingRadians !== null),
    ).toBe(true);
    expect(snapshot.markers.find((marker) => marker.role === "victim")?.mapFacingRadians).toBeNull();
  });

  test("builds one bounded objective row per round for whole-match analysis", () => {
    const timeline = buildMatchTimeline(evidenceMatch(), "focus");
    expect(timeline.summary).toMatchObject({
      rounds: 2,
      wins: 1,
      losses: 1,
      focusKills: null,
      focusDeaths: null,
      openingDeaths: null,
      untradedDeaths: null,
    });
    expect(timeline.rounds[1]).toMatchObject({
      roundNumber: 2,
      scoreBefore: "1-0",
      scoreAfter: "1-1",
      outcome: "loss",
      opening: "r2-kill-0",
    });
    expect(timeline.rounds[1]!.observedFacts.length).toBeGreaterThan(0);
    expect(timeline.limitations.join(" ")).toContain("continuous POV");
  });

  test("reviews a death relative to recorded living teammates and builds a team-context snapshot", () => {
    const review = buildPositionReview(evidenceMatch(), { player: "Phoenix", deathIndex: 1 });
    expect(review).toMatchObject({
      death: { eventId: "r2-kill-0", trade: { delayMs: 3_000 } },
      replay: { victim: { agentName: "Phoenix" }, killer: { agentName: "Omen" } },
      teammates: [{ player: { agentName: "Sage" } }],
    });
    expect(review.teammates[0]!.distanceToVictimMeters).toBeCloseTo(Math.sqrt(18), 3);
    expect(review.snapshot.markers.map((marker) => marker.player.agentName)).toEqual(["Omen", "Phoenix", "Sage"]);
    expect(review.observedFacts.join(" ")).toContain("death was traded");
    expect(review.limitations.join(" ")).toContain("Walls");
  });

  test("labels post-plant defender kills as retake evidence", () => {
    const detail = retakeMatch();
    const intelligence = buildRoundIntelligence(detail, 1, "focus");
    const kill = intelligence.timeline.find((event) => event.kind === "kill");
    expect(kill).toMatchObject({ phase: "retake", tags: expect.arrayContaining(["retake"]) });
    expect(intelligence.supportedInferences.join(" ")).toContain("completed the retake and defuse");
  });

  test("rejects ambiguous or absent player selectors with available identities", () => {
    const detail = evidenceMatch();
    expect(resolveMatchPlayer(detail, "Phoenix").puuid).toBe("focus");
    expect(() => resolveMatchPlayer(detail, "MissingAgent")).toThrow("Available players");
  });
});

function evidenceMatch(): MatchDetail {
  const focus = player("focus", "Focus", "Blue", "Phoenix");
  const ally = player("ally", "Ally", "Blue", "Sage");
  const enemy = player("enemy", "Enemy", "Red", "Omen");
  const enemyTwo = player("enemy-2", "EnemyTwo", "Red", "Jett");
  const rounds: MatchRoundDetail[] = [
    round(1, "Blue", "Elimination", [{ teamId: "Blue", roundsWon: 1 }]),
    round(2, "Red", "Elimination", [
      { teamId: "Blue", roundsWon: 1 },
      { teamId: "Red", roundsWon: 1 },
    ]),
  ];
  const opening = kill(2, 10_000, enemy, focus, { x: 1_900, y: -7_900 }, { x: 2_300, y: -7_500 });
  opening.playerLocations.push(
    {
      puuid: ally.puuid,
      gameName: ally.gameName,
      tagLine: ally.tagLine,
      teamId: ally.teamId,
      viewRadians: 0.4,
      location: { x: 2_000, y: -7_800 },
    },
    {
      puuid: enemyTwo.puuid,
      gameName: enemyTwo.gameName,
      tagLine: enemyTwo.tagLine,
      teamId: enemyTwo.teamId,
      viewRadians: 2.4,
      location: { x: 2_600, y: -7_100 },
    },
  );
  const killEvents: MatchKillEvent[] = [
    opening,
    kill(2, 13_000, ally, enemy, { x: 2_000, y: -7_800 }, { x: 1_900, y: -7_900 }),
    kill(2, 20_000, enemyTwo, ally, { x: 2_600, y: -7_100 }, { x: 2_000, y: -7_800 }),
  ];
  return enrich({
    ...sanitizedMatchDetail(),
    matchId: "evidence-match",
    mapName: "Haven",
    teams: [
      {
        teamId: "Blue",
        label: "Blue Team",
        roundsWon: 1,
        roundsLost: 1,
        won: false,
        averageTierName: null,
        players: [focus, ally],
      },
      {
        teamId: "Red",
        label: "Red Team",
        roundsWon: 1,
        roundsLost: 1,
        won: false,
        averageTierName: null,
        players: [enemy, enemyTwo],
      },
    ],
    rounds,
    killEvents,
    endState: { kind: "draw", label: "Draw", evidence: "team-score" },
  });
}

function retakeMatch(): MatchDetail {
  const base = evidenceMatch();
  const focus = base.teams[0]!.players[0]!;
  const enemy = base.teams[1]!.players[0]!;
  const roundOne = round(1, "Blue", "Defuse", [{ teamId: "Blue", roundsWon: 1 }]);
  roundOne.spikePlant = {
    playerName: enemy.gameName,
    playerTag: enemy.tagLine,
    teamId: "Red",
    site: "A",
    timeInRoundMs: 30_000,
  };
  roundOne.spikeDefuse = {
    playerName: focus.gameName,
    playerTag: focus.tagLine,
    teamId: "Blue",
    site: "A",
    timeInRoundMs: 50_000,
  };
  return enrich({
    ...base,
    matchId: "retake-match",
    teams: base.teams.map((team) => ({
      ...team,
      roundsWon: same(team.teamId, "Blue") ? 1 : 0,
      roundsLost: same(team.teamId, "Blue") ? 0 : 1,
      won: same(team.teamId, "Blue"),
    })),
    rounds: [roundOne],
    killEvents: [kill(0, 40_000, focus, enemy, { x: 1_900, y: -7_900 }, { x: 2_300, y: -7_500 })],
    endState: { kind: "completed", label: "Completed", evidence: "team-result" },
  });
}

function enrich(detail: MatchDetail): MatchDetail {
  const roundEvidence = new MatchRoundEvidenceService().analyze(detail);
  const withEvidence = { ...detail, roundEvidence };
  return { ...withEvidence, analysis: new RoundAnalysisService().analyze(withEvidence, "focus") };
}

function player(puuid: string, gameName: string, teamId: string, agentName: string): MatchPlayerDetail {
  return {
    puuid,
    gameName,
    tagLine: "EU",
    teamId,
    partyId: null,
    agentName,
    level: 100,
    tierId: null,
    tierName: null,
    score: null,
    trackerScore: null,
    kills: null,
    deaths: null,
    assists: null,
    acs: null,
    adr: null,
    damageDelta: null,
    headshotRate: null,
    kast: null,
    firstKills: null,
    firstDeaths: null,
    threePlusKillRounds: null,
    multiKills: null,
    highlights: [],
    spentOverall: null,
    spentAverage: null,
    loadoutOverall: null,
    loadoutAverage: null,
    abilityCasts: { grenade: null, ability1: null, ability2: null, ultimate: null, total: null },
  };
}

function round(
  number: number,
  winningTeam: string,
  result: string,
  teamScores: MatchRoundDetail["teamScores"],
): MatchRoundDetail {
  return {
    number,
    winningTeam,
    result,
    ceremony: null,
    spikePlant: null,
    spikeDefuse: null,
    teamScores,
    playerStats: [],
  };
}

function kill(
  roundNumber: number,
  timeInRoundMs: number,
  killer: MatchPlayerDetail,
  victim: MatchPlayerDetail,
  killerLocation: { x: number; y: number },
  victimLocation: { x: number; y: number },
): MatchKillEvent {
  return {
    round: roundNumber,
    timeInRoundMs,
    timeInMatchMs: timeInRoundMs,
    killerPuuid: killer.puuid,
    killerName: killer.gameName,
    killerTag: killer.tagLine,
    killerTeam: killer.teamId,
    victimPuuid: victim.puuid,
    victimName: victim.gameName,
    victimTag: victim.tagLine,
    victimTeam: victim.teamId,
    weaponName: "Vandal",
    assistants: [],
    assistantPuuids: [],
    victimLocation,
    playerLocations: [
      {
        puuid: killer.puuid,
        gameName: killer.gameName,
        tagLine: killer.tagLine,
        teamId: killer.teamId,
        viewRadians: 1.2,
        location: killerLocation,
      },
    ],
    distanceMeters: Math.hypot(victimLocation.x - killerLocation.x, victimLocation.y - killerLocation.y) / 100,
  };
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
