import { describe, expect, test } from "bun:test";
import type { MatchDetail, MatchKillEvent, MatchPlayerDetail, MatchRoundDetail } from "../domain/types";
import { MatchPerformanceService } from "./match-performance-service";

describe("MatchPerformanceService", () => {
  test("derives side splits, opponent damage, rivalry, and weapon kills from normalized evidence", () => {
    const match = baseMatch();
    const analysis = new MatchPerformanceService().analyze(match, "focus");

    expect(analysis?.sideSplits).toEqual([
      { side: "attack", rounds: 1, kills: 1, deaths: 0, assists: 1, kd: 1 },
      { side: "defense", rounds: 1, kills: 0, deaths: 1, assists: 0, kd: 0 },
    ]);
    expect(analysis?.opponents).toEqual([
      {
        puuid: "enemy",
        gameName: "Enemy",
        tagLine: "EU",
        agentName: "Omen",
        kills: 1,
        deaths: 1,
        damageDealt: 180,
        damageReceived: 140,
      },
    ]);
    expect(analysis?.weapons).toEqual([
      { weaponName: "Vandal", kills: 1, averageKillDistanceMeters: 29, killsWithDistance: 1 },
    ]);
    expect(analysis?.impact).toEqual({
      firstKills: 1,
      firstDeaths: 1,
      roundsWonAfterFirstKill: 1,
      roundsLostAfterFirstDeath: 1,
      firstKillConversionRate: 1,
      firstDeathPunishRate: 1,
      lastDeaths: 1,
      tradeKills: 0,
      tradesPerRound: 0,
      plants: 1,
      defuses: 0,
      killsPerMinute: 0.5,
    });
    expect(analysis?.topRivalPuuid).toBe("enemy");
    expect(analysis?.warnings).toEqual([]);
  });

  test("keeps unsupported side and damage evidence explicitly unavailable", () => {
    const match = baseMatch();
    match.rounds = [{ ...match.rounds[0]!, spikePlant: null, result: "Elimination", playerStats: [] }];
    match.killEvents = [];

    const analysis = new MatchPerformanceService().analyze(match, "focus");
    expect(analysis?.sideSplits).toEqual([]);
    expect(analysis?.impact).toMatchObject({
      firstKills: null,
      firstDeaths: null,
      tradeKills: null,
      lastDeaths: null,
      plants: 0,
      defuses: 0,
      killsPerMinute: null,
    });
    expect(analysis?.warnings).toHaveLength(3);
  });
});

function baseMatch(): MatchDetail {
  const focus = player("focus", "Focus", "Red", "Fade");
  const enemy = player("enemy", "Enemy", "Blue", "Omen");
  return {
    matchId: "performance-1",
    region: "eu",
    platform: "pc",
    mode: "Competitive",
    mapName: "Lotus",
    gameVersion: null,
    patch: null,
    startedAt: null,
    durationMs: 120_000,
    averageTierName: null,
    endState: { kind: "completed", label: "Completed", evidence: "team-result" },
    teams: [
      {
        teamId: "Red",
        label: "Team A",
        roundsWon: 1,
        roundsLost: 1,
        won: false,
        averageTierName: null,
        players: [focus],
      },
      {
        teamId: "Blue",
        label: "Team B",
        roundsWon: 1,
        roundsLost: 1,
        won: true,
        averageTierName: null,
        players: [enemy],
      },
    ],
    rounds: [
      round(1, "Red", "Red", [
        roundPlayer("focus", "Focus", "Red", [
          {
            targetPuuid: "enemy",
            targetName: "Enemy",
            targetTag: "EU",
            targetTeam: "Blue",
            damage: 180,
            headshots: 1,
            bodyshots: 1,
            legshots: 0,
          },
        ]),
        roundPlayer("enemy", "Enemy", "Blue", []),
      ]),
      round(13, "Blue", null, [
        roundPlayer("focus", "Focus", "Red", []),
        roundPlayer("enemy", "Enemy", "Blue", [
          {
            targetPuuid: "focus",
            targetName: "Focus",
            targetTag: "EU",
            targetTeam: "Red",
            damage: 140,
            headshots: 0,
            bodyshots: 4,
            legshots: 0,
          },
        ]),
      ]),
    ],
    killEvents: [
      { ...kill(0, "focus", "enemy", "Vandal", ["focus-assist"]), distanceMeters: 29 },
      kill(12, "enemy", "focus", "Phantom", []),
      { ...kill(0, "ally", "enemy-two", "Ghost", ["focus"]), killerName: "Ally", victimName: "EnemyTwo" },
    ],
    source: "cache",
    warnings: [],
  };
}

function player(puuid: string, gameName: string, teamId: string, agentName: string): MatchPlayerDetail {
  return {
    puuid,
    gameName,
    tagLine: "EU",
    teamId,
    agentName,
    partyId: null,
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

function round(
  number: number,
  winningTeam: string,
  plantTeam: string | null,
  playerStats: MatchRoundDetail["playerStats"],
): MatchRoundDetail {
  return {
    number,
    winningTeam,
    result: plantTeam ? "Detonate" : "Elimination",
    ceremony: null,
    spikePlant: plantTeam
      ? { playerName: "Focus", playerTag: "EU", teamId: plantTeam, site: "A", timeInRoundMs: 30_000 }
      : null,
    spikeDefuse: null,
    teamScores: [],
    playerStats,
  };
}

function roundPlayer(
  puuid: string,
  gameName: string,
  teamId: string,
  damageEvents: MatchRoundDetail["playerStats"][number]["damageEvents"],
): MatchRoundDetail["playerStats"][number] {
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
    loadoutValue: null,
    remainingCredits: null,
    weaponName: null,
    armorName: null,
    damageEvents,
    abilityCasts: { grenade: null, ability1: null, ability2: null, ultimate: null, total: null },
    wasAfk: false,
    receivedPenalty: false,
    stayedInSpawn: false,
  };
}

function kill(
  round: number,
  killerPuuid: string,
  victimPuuid: string,
  weaponName: string,
  assistantPuuids: string[],
): MatchKillEvent {
  return {
    round,
    timeInRoundMs: 10_000,
    timeInMatchMs: 10_000,
    killerPuuid,
    killerName: killerPuuid === "focus" ? "Focus" : "Enemy",
    killerTag: "EU",
    killerTeam: killerPuuid === "focus" ? "Red" : "Blue",
    victimPuuid,
    victimName: victimPuuid === "focus" ? "Focus" : "Enemy",
    victimTag: "EU",
    victimTeam: victimPuuid === "focus" ? "Red" : "Blue",
    weaponName,
    assistants: [],
    assistantPuuids,
    victimLocation: null,
    playerLocations: [],
    distanceMeters: null,
  };
}
