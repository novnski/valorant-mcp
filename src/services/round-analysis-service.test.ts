import { describe, expect, test } from "bun:test";

import type { MatchDetail, MatchKillEvent, MatchRoundDetail } from "../domain/types";
import { RoundAnalysisService } from "./round-analysis-service";

const players = [
  player("focus", "Focus", "Blue"),
  player("blue-2", "BlueTwo", "Blue"),
  player("red-1", "RedOne", "Red"),
  player("red-2", "RedTwo", "Red"),
  player("red-3", "RedThree", "Red"),
];

describe("RoundAnalysisService", () => {
  test("derives deterministic clutch, economy, score, and opening evidence", () => {
    const match = baseMatch({
      rounds: [
        round(1, "Blue", [
          { teamId: "Blue", roundsWon: 1 },
          { teamId: "Red", roundsWon: 0 },
        ]),
        {
          ...round(2, "Blue", [
            { teamId: "Blue", roundsWon: 2 },
            { teamId: "Red", roundsWon: 0 },
          ]),
          playerStats: [
            roundPlayer("focus", "Focus", "Blue", 1_000),
            roundPlayer("blue-2", "BlueTwo", "Blue", 1_200),
            roundPlayer("red-1", "RedOne", "Red", 4_500),
            roundPlayer("red-2", "RedTwo", "Red", 4_300),
          ],
        },
      ],
      killEvents: [
        kill(1, 10_000, "red-1", "RedOne", "Red", "blue-2", "BlueTwo", "Blue"),
        kill(1, 20_000, "focus", "Focus", "Blue", "red-1", "RedOne", "Red"),
        kill(1, 25_000, "focus", "Focus", "Blue", "red-2", "RedTwo", "Red"),
        kill(1, 30_000, "focus", "Focus", "Blue", "red-3", "RedThree", "Red"),
        kill(2, 9_000, "focus", "Focus", "Blue", "red-1", "RedOne", "Red"),
      ],
    });

    const first = new RoundAnalysisService().analyze(match, "focus");
    const second = new RoundAnalysisService().analyze(match, "focus");

    expect(second).toEqual(first);
    expect(first.turningPoints.map((point) => [point.roundNumber, point.kind, point.title])).toEqual([
      [1, "clutch", "1v3 clutch"],
      [2, "eco", "Economy upset"],
    ]);
    expect(first.turningPoints[0]).toMatchObject({ score: "Team A 1 · Team B 0", player: { puuid: "focus" } });
    expect(first.evidence).toEqual({ rounds: 2, killEvents: 5, economyRounds: 1 });
    expect(first.warnings).toEqual([
      "Complete round economy evidence is unavailable; economy-upset claims may be omitted.",
    ]);
  });

  test("omits unsupported claims and reports partial evidence", () => {
    const analysis = new RoundAnalysisService().analyze(baseMatch({ rounds: [], killEvents: [] }), "focus");

    expect(analysis.turningPoints).toEqual([]);
    expect(analysis.recommendation).toMatchObject({
      kind: "data-quality",
      title: "Hydrate match detail",
      observedFacts: ["Unavailable fields: ACS, ADR, damage delta, KAST, opening duels"],
    });
    expect(analysis.warnings).toContain(
      "Round-by-round evidence is unavailable; no turning-point claims were inferred.",
    );
    expect(analysis.warnings).toContain(
      "Kill-event evidence is unavailable; opening, multikill, and clutch claims were omitted.",
    );
  });

  test("handles zero-based event rounds and overtime without shifting an exact round", () => {
    const match = baseMatch({
      rounds: [round(1, "Blue", []), round(25, "Red", [])],
      killEvents: [
        kill(0, 5_000, "focus", "Focus", "Blue", "red-1", "RedOne", "Red"),
        kill(25, 6_000, "red-1", "RedOne", "Red", "focus", "Focus", "Blue"),
      ],
    });
    const analysis = new RoundAnalysisService().analyze(match, null);

    expect(analysis.turningPoints.map((point) => point.roundNumber).sort((left, right) => left - right)).toEqual([
      1, 25,
    ]);
  });

  test("focus involvement raises the same observed event without changing its evidence", () => {
    const match = baseMatch({
      rounds: [round(1, "Blue", [])],
      killEvents: [kill(1, 5_000, "focus", "Focus", "Blue", "red-1", "RedOne", "Red")],
    });
    const neutral = new RoundAnalysisService().analyze(match, null).turningPoints[0]!;
    const focused = new RoundAnalysisService().analyze(match, "focus").turningPoints[0]!;

    expect(focused.title).toBe(neutral.title);
    expect(focused.evidence).toEqual(neutral.evidence);
    expect(focused.priority - neutral.priority).toBe(100);
  });

  test("does not misrepresent Deathmatch kill streams as round turning points", () => {
    const analysis = new RoundAnalysisService().analyze(
      baseMatch({
        mode: "Deathmatch",
        rounds: [round(1, "focus", [])],
        killEvents: [kill(1, 5_000, "focus", "Focus", "focus", "red-1", "RedOne", "red-1")],
      }),
      "focus",
    );

    expect(analysis.turningPoints).toEqual([]);
    expect(analysis.recommendation).toBeNull();
    expect(analysis.warnings).toEqual(["Turning-point analysis is unavailable for non-round-based modes."]);
  });

  test("separates observed opening facts from the coaching inference and links evidence rounds", () => {
    const match = baseMatch({
      rounds: [round(1, "Red", []), round(2, "Blue", [])],
      killEvents: [
        kill(1, 5_000, "red-1", "RedOne", "Red", "focus", "Focus", "Blue"),
        kill(2, 5_000, "focus", "Focus", "Blue", "red-1", "RedOne", "Red"),
      ],
    });
    const focus = match.teams.flatMap((team) => team.players).find((player) => player.puuid === "focus")!;
    Object.assign(focus, { acs: 190, adr: 125, damageDelta: -8, kast: 0.7, firstKills: 1, firstDeaths: 3 });

    const recommendation = new RoundAnalysisService().analyze(match, "focus").recommendation;

    expect(recommendation).toEqual({
      kind: "coaching-inference",
      title: "Review opening duels",
      observedFacts: ["Opening duels: 1 first kills / 3 first deaths"],
      inference: "Check whether the first deaths were traded or isolated before changing entry timing or positioning.",
      confidence: "high",
      evidenceRoundNumbers: [1],
    });
  });
});

function baseMatch(overrides: Partial<MatchDetail>): MatchDetail {
  return {
    matchId: "match-analysis-1",
    region: "eu",
    platform: "pc",
    mode: "competitive",
    mapName: "Haven",
    gameVersion: null,
    patch: null,
    startedAt: "2026-08-11T00:00:00Z",
    durationMs: 2_400_000,
    averageTierName: "Diamond 1",
    endState: { kind: "completed", label: "Completed", evidence: "team-result" },
    teams: [
      {
        teamId: "Blue",
        label: "Team A",
        roundsWon: 13,
        roundsLost: 10,
        won: true,
        averageTierName: null,
        players: players.filter((entry) => entry.teamId === "Blue"),
      },
      {
        teamId: "Red",
        label: "Team B",
        roundsWon: 10,
        roundsLost: 13,
        won: false,
        averageTierName: null,
        players: players.filter((entry) => entry.teamId === "Red"),
      },
    ],
    rounds: [],
    killEvents: [],
    source: "cache",
    warnings: [],
    ...overrides,
  };
}

function player(puuid: string, gameName: string, teamId: string) {
  return {
    puuid,
    gameName,
    tagLine: "EU",
    teamId,
    partyId: null,
    agentName: null,
    level: null,
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

function round(number: number, winningTeam: string, teamScores: MatchRoundDetail["teamScores"]): MatchRoundDetail {
  return {
    number,
    winningTeam,
    result: "Elimination",
    ceremony: null,
    spikePlant: null,
    spikeDefuse: null,
    teamScores,
    playerStats: [],
  };
}

function roundPlayer(puuid: string, gameName: string, teamId: string, loadoutValue: number) {
  return {
    puuid,
    gameName,
    tagLine: "EU",
    teamId,
    score: null,
    kills: null,
    headshots: null,
    bodyshots: null,
    legshots: null,
    loadoutValue,
    remainingCredits: null,
    weaponName: null,
    armorName: null,
    damageEvents: [],
    abilityCasts: { grenade: null, ability1: null, ability2: null, ultimate: null, total: null },
    wasAfk: false,
    receivedPenalty: false,
    stayedInSpawn: false,
  };
}

function kill(
  roundNumber: number,
  timeInRoundMs: number,
  killerPuuid: string,
  killerName: string,
  killerTeam: string,
  victimPuuid: string,
  victimName: string,
  victimTeam: string,
): MatchKillEvent {
  return {
    round: roundNumber,
    timeInRoundMs,
    timeInMatchMs: timeInRoundMs,
    killerPuuid,
    killerName,
    killerTag: "EU",
    killerTeam,
    victimPuuid,
    victimName,
    victimTag: "EU",
    victimTeam,
    weaponName: "Vandal",
    assistants: [],
    assistantPuuids: [],
    victimLocation: null,
    playerLocations: [],
    distanceMeters: null,
  };
}
