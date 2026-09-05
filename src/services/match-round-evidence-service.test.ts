import { describe, expect, test } from "bun:test";
import type { MatchDetail, MatchKillEvent, MatchPlayerDetail, MatchRoundPlayerStat } from "../domain/types";
import { MatchRoundEvidenceService } from "./match-round-evidence-service";

describe("MatchRoundEvidenceService", () => {
  test("builds complete player rows, ordered events, distances, and spatial coverage", () => {
    const match = baseMatch();
    const analysis = new MatchRoundEvidenceService().analyze(match);
    expect(analysis?.rounds[0]?.players[0]).toMatchObject({
      gameName: "Focus",
      agentName: "Fade",
      score: 300,
      kills: 1,
      deaths: 0,
      assists: 1,
      loadoutValue: 3_900,
      remainingCredits: 500,
    });
    expect(analysis?.rounds[0]?.events.map((event) => event.kind)).toEqual(["kill", "kill", "plant"]);
    expect(analysis?.rounds[0]?.events[0]).toMatchObject({ distanceMeters: 5, targetLocation: { x: 300, y: 400 } });
    expect(analysis?.evidence).toEqual({ rounds: 1, killEvents: 2, killsWithDistance: 2, killsWithPlayerLocations: 2 });
    expect(analysis?.warnings).toEqual([]);
  });

  test("labels missing spatial evidence instead of inventing coordinates", () => {
    const match = baseMatch();
    match.killEvents[0]!.distanceMeters = null;
    match.killEvents[0]!.playerLocations = [];
    const analysis = new MatchRoundEvidenceService().analyze(match);
    expect(analysis?.evidence.killsWithDistance).toBe(1);
    expect(analysis?.warnings).toHaveLength(2);
  });
});

function baseMatch(): MatchDetail {
  const focus = player("focus", "Focus", "Red", "Fade");
  const ally = player("ally", "Ally", "Red", "Sage");
  const enemy = player("enemy", "Enemy", "Blue", "Omen");
  return {
    matchId: "round-evidence-1",
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
      {
        teamId: "Red",
        label: "Team A",
        roundsWon: 1,
        roundsLost: 0,
        won: true,
        averageTierName: null,
        players: [focus, ally],
      },
      {
        teamId: "Blue",
        label: "Team B",
        roundsWon: 0,
        roundsLost: 1,
        won: false,
        averageTierName: null,
        players: [enemy],
      },
    ],
    rounds: [
      {
        number: 1,
        winningTeam: "Red",
        result: "Detonate",
        ceremony: null,
        spikePlant: { playerName: "Focus", playerTag: "EU", teamId: "Red", site: "A", timeInRoundMs: 20_000 },
        spikeDefuse: null,
        teamScores: [],
        playerStats: [
          roundPlayer("focus", "Focus", "Red", 300, 1, 3_900, 500),
          roundPlayer("ally", "Ally", "Red", 100, 0, 2_000, 1_000),
          roundPlayer("enemy", "Enemy", "Blue", 50, 0, 2_500, 700),
        ],
      },
    ],
    killEvents: [
      kill("focus", "enemy", ["ally"], ["Ally"], 10_000),
      kill("ally", "enemy", ["focus"], ["Focus"], 15_000),
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

function roundPlayer(
  puuid: string,
  gameName: string,
  teamId: string,
  score: number,
  kills: number,
  loadoutValue: number,
  remainingCredits: number,
): MatchRoundPlayerStat {
  return {
    puuid,
    gameName,
    tagLine: "EU",
    teamId,
    score,
    kills,
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    loadoutValue,
    remainingCredits,
    weaponName: "Vandal",
    armorName: "Heavy Shields",
    damageEvents: [],
    abilityCasts: { grenade: null, ability1: null, ability2: null, ultimate: null, total: null },
    wasAfk: false,
    receivedPenalty: false,
    stayedInSpawn: false,
  };
}

function kill(
  killerPuuid: string,
  victimPuuid: string,
  assistantPuuids: string[],
  assistants: string[],
  timeInRoundMs: number,
): MatchKillEvent {
  const killerName = killerPuuid === "focus" ? "Focus" : killerPuuid === "ally" ? "Ally" : "Enemy";
  const victimName = victimPuuid === "focus" ? "Focus" : victimPuuid === "ally" ? "Ally" : "Enemy";
  return {
    round: 0,
    timeInRoundMs,
    timeInMatchMs: timeInRoundMs,
    killerPuuid,
    killerName,
    killerTag: "EU",
    killerTeam: killerPuuid === "enemy" ? "Blue" : "Red",
    victimPuuid,
    victimName,
    victimTag: "EU",
    victimTeam: victimPuuid === "enemy" ? "Blue" : "Red",
    weaponName: "Vandal",
    assistants,
    assistantPuuids,
    victimLocation: { x: 300, y: 400 },
    playerLocations: [
      {
        puuid: killerPuuid,
        gameName: killerName,
        tagLine: "EU",
        teamId: killerPuuid === "enemy" ? "Blue" : "Red",
        viewRadians: 1,
        location: { x: 0, y: 0 },
      },
    ],
    distanceMeters: 5,
  };
}
