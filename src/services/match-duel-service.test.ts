import { describe, expect, test } from "bun:test";
import type { MatchDetail, MatchKillEvent, MatchPlayerDetail } from "../domain/types";
import { MatchDuelService } from "./match-duel-service";

describe("MatchDuelService", () => {
  test("builds every bidirectional cross-team matchup and ranks rivalry and mismatch", () => {
    const match = baseMatch();
    match.killEvents = [
      ...kills("red-one", "blue-one", 3),
      ...kills("blue-one", "red-one", 2),
      ...kills("red-two", "blue-two", 3),
    ];
    const analysis = new MatchDuelService().analyze(match);

    expect(analysis?.matchups).toHaveLength(4);
    expect(analysis?.crossTeamKills).toBe(8);
    expect(analysis?.topRivalry).toMatchObject({ leftKills: 3, rightKills: 2, totalKills: 5, margin: 1 });
    expect(analysis?.biggestMismatch).toMatchObject({ leftKills: 3, rightKills: 0, totalKills: 3, margin: 3 });
    expect(analysis?.warnings).toEqual([]);
  });

  test("reports kill events that cannot be placed without fabricating matrix cells", () => {
    const match = baseMatch();
    match.killEvents = [...kills("red-one", "blue-one", 1), ...kills("red-one", "unknown", 1)];
    const analysis = new MatchDuelService().analyze(match);
    expect(analysis?.crossTeamKills).toBe(1);
    expect(analysis?.warnings).toEqual(["1 kill events could not be placed in the two-team duel matrix."]);
  });
});

function baseMatch(): MatchDetail {
  const red = [player("red-one", "Red One", "Red"), player("red-two", "Red Two", "Red")];
  const blue = [player("blue-one", "Blue One", "Blue"), player("blue-two", "Blue Two", "Blue")];
  return {
    matchId: "duels-1",
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
      { teamId: "Red", label: "Team A", roundsWon: 13, roundsLost: 10, won: true, averageTierName: null, players: red },
      {
        teamId: "Blue",
        label: "Team B",
        roundsWon: 10,
        roundsLost: 13,
        won: false,
        averageTierName: null,
        players: blue,
      },
    ],
    rounds: [],
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

function kills(killerPuuid: string, victimPuuid: string, count: number): MatchKillEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    round: index,
    timeInRoundMs: 1_000,
    timeInMatchMs: 1_000,
    killerPuuid,
    killerName: name(killerPuuid),
    killerTag: "EU",
    killerTeam: killerPuuid.startsWith("red") ? "Red" : "Blue",
    victimPuuid,
    victimName: name(victimPuuid),
    victimTag: "EU",
    victimTeam: victimPuuid.startsWith("red") ? "Red" : "Blue",
    weaponName: "Vandal",
    assistants: [],
    assistantPuuids: [],
    victimLocation: null,
    playerLocations: [],
    distanceMeters: null,
  }));
}

function name(puuid: string): string {
  return puuid
    .split("-")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}
