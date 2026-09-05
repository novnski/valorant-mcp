import { describe, expect, test } from "bun:test";
import type { MatchDetail, MatchPlayerDetail, MatchRoundPlayerStat } from "../domain/types";
import { MatchEconomyService } from "./match-economy-service";

describe("MatchEconomyService", () => {
  test("computes team bank, loadout, total, and complete-round averages", () => {
    const match = baseMatch();
    const analysis = new MatchEconomyService().analyze(match);

    expect(analysis?.teams[0]).toMatchObject({
      teamId: "Red",
      averageBank: 1_500,
      averageLoadout: 4_000,
      averageTotal: 5_500,
      roundsWithData: 2,
      completeRounds: 2,
      expectedRounds: 2,
    });
    expect(analysis?.teams[0]?.rounds).toEqual([
      {
        roundNumber: 1,
        bank: 1_000,
        loadout: 3_000,
        total: 4_000,
        playerSamples: 2,
        expectedPlayers: 2,
        complete: true,
      },
      {
        roundNumber: 2,
        bank: 2_000,
        loadout: 5_000,
        total: 7_000,
        playerSamples: 2,
        expectedPlayers: 2,
        complete: true,
      },
    ]);
    expect(analysis?.warnings).toEqual([]);
  });

  test("retains partial evidence but excludes it from averages instead of filling missing values with zero", () => {
    const match = baseMatch();
    match.rounds[1]!.playerStats[1]!.remainingCredits = null;
    match.rounds[1]!.playerStats[1]!.loadoutValue = null;

    const team = new MatchEconomyService().analyze(match)?.teams[0];
    expect(team).toMatchObject({
      averageBank: 1_000,
      averageLoadout: 3_000,
      averageTotal: 4_000,
      roundsWithData: 2,
      completeRounds: 1,
    });
    expect(team?.rounds[1]).toEqual({
      roundNumber: 2,
      bank: 1_200,
      loadout: 2_800,
      total: 4_000,
      playerSamples: 1,
      expectedPlayers: 2,
      complete: false,
    });
    expect(new MatchEconomyService().analyze(match)?.warnings).toEqual([
      "Team economy averages exclude rounds without complete bank and loadout evidence for every player.",
    ]);
  });
});

function baseMatch(): MatchDetail {
  const red = [player("r1", "Red One", "Red"), player("r2", "Red Two", "Red")];
  const blue = [player("b1", "Blue One", "Blue"), player("b2", "Blue Two", "Blue")];
  return {
    matchId: "economy-1",
    region: "eu",
    platform: "pc",
    mode: "Competitive",
    mapName: "Lotus",
    gameVersion: null,
    patch: null,
    startedAt: null,
    durationMs: null,
    averageTierName: null,
    endState: { kind: "completed", label: "Completed", evidence: "team-result" },
    teams: [
      { teamId: "Red", label: "Team A", roundsWon: 1, roundsLost: 1, won: false, averageTierName: null, players: red },
      { teamId: "Blue", label: "Team B", roundsWon: 1, roundsLost: 1, won: true, averageTierName: null, players: blue },
    ],
    rounds: [
      {
        number: 1,
        winningTeam: "Red",
        result: null,
        ceremony: null,
        spikePlant: null,
        spikeDefuse: null,
        teamScores: [],
        playerStats: [
          economy("r1", "Red One", "Red", 400, 1_000),
          economy("r2", "Red Two", "Red", 600, 2_000),
          economy("b1", "Blue One", "Blue", 700, 1_500),
          economy("b2", "Blue Two", "Blue", 800, 2_500),
        ],
      },
      {
        number: 2,
        winningTeam: "Blue",
        result: null,
        ceremony: null,
        spikePlant: null,
        spikeDefuse: null,
        teamScores: [],
        playerStats: [
          economy("r1", "Red One", "Red", 1_200, 2_800),
          economy("r2", "Red Two", "Red", 800, 2_200),
          economy("b1", "Blue One", "Blue", 900, 2_000),
          economy("b2", "Blue Two", "Blue", 1_100, 3_000),
        ],
      },
    ],
    killEvents: [],
    source: "cache",
    warnings: [],
  };
}

function player(puuid: string, gameName: string, teamId: string): MatchPlayerDetail {
  return {
    puuid,
    gameName,
    tagLine: "EU",
    teamId,
    agentName: null,
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

function economy(
  puuid: string,
  gameName: string,
  teamId: string,
  remainingCredits: number,
  loadoutValue: number,
): MatchRoundPlayerStat {
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
    remainingCredits,
    weaponName: null,
    armorName: null,
    damageEvents: [],
    abilityCasts: { grenade: null, ability1: null, ability2: null, ultimate: null, total: null },
    wasAfk: false,
    receivedPenalty: false,
    stayedInSpawn: false,
  };
}
