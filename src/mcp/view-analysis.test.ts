import { describe, expect, test } from "bun:test";

import type { MatchKillEvent, MatchPlayerDetail } from "../domain/types";
import { sanitizedMatchDetail } from "./test-fixture";
import { buildAttentionSnapshot, mapFacingRadians } from "./view-analysis";

describe("geometric attention", () => {
  test("calculates direct, in-cone, and looking-away relations from view radians", () => {
    const killer = player("killer", "Killer", "Red", "Omen");
    const victim = player("victim", "Victim", "Blue", "Phoenix");
    const support = player("support", "Support", "Blue", "Sage");
    const detail = sanitizedMatchDetail({
      mapName: "Split",
      teams: [
        {
          teamId: "Red",
          label: "Red Team",
          roundsWon: 1,
          roundsLost: 0,
          won: true,
          averageTierName: null,
          players: [killer],
        },
        {
          teamId: "Blue",
          label: "Blue Team",
          roundsWon: 0,
          roundsLost: 1,
          won: false,
          averageTierName: null,
          players: [victim, support],
        },
      ],
    });
    const kill: MatchKillEvent = {
      round: 0,
      timeInRoundMs: 10_000,
      timeInMatchMs: 10_000,
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
      victimLocation: { x: 1_000, y: 0 },
      distanceMeters: 10,
      playerLocations: [
        {
          puuid: killer.puuid,
          gameName: killer.gameName,
          tagLine: killer.tagLine,
          teamId: killer.teamId,
          viewRadians: 0,
          location: { x: 0, y: 0 },
        },
        {
          puuid: victim.puuid,
          gameName: victim.gameName,
          tagLine: victim.tagLine,
          teamId: victim.teamId,
          viewRadians: 0,
          location: { x: 1_000, y: 0 },
        },
        {
          puuid: support.puuid,
          gameName: support.gameName,
          tagLine: support.tagLine,
          teamId: support.teamId,
          viewRadians: (-Math.PI * 3) / 4,
          location: { x: 1_000, y: 1_000 },
        },
      ],
    };

    const snapshot = buildAttentionSnapshot(detail, kill, ref(killer), ref(victim));
    expect(snapshot.killerToVictim).toMatchObject({
      alignment: "direct",
      withinAssumedFov: true,
      angleDeltaDegrees: 0,
    });
    expect(snapshot.victimToKiller).toMatchObject({
      alignment: "looking-away",
      withinAssumedFov: false,
      angleDeltaDegrees: 180,
    });
    expect(snapshot.victimTeamSupport[0]).toMatchObject({
      observer: { agentName: "Sage" },
      alignment: "direct",
      withinAssumedFov: true,
    });
    expect(snapshot.teammatesWithKillerInsideCone).toBe(1);
    expect(snapshot.potentialCrossfire).toBe(false);
  });

  test("reports no geometric coverage without pretending walls or smoke are known", () => {
    const killer = player("killer", "Killer", "Red", "Omen");
    const victim = player("victim", "Victim", "Blue", "Phoenix");
    const support = player("support", "Support", "Blue", "Sage");
    const detail = sanitizedMatchDetail({
      teams: [
        {
          teamId: "Red",
          label: "Red Team",
          roundsWon: 1,
          roundsLost: 0,
          won: true,
          averageTierName: null,
          players: [killer],
        },
        {
          teamId: "Blue",
          label: "Blue Team",
          roundsWon: 0,
          roundsLost: 1,
          won: false,
          averageTierName: null,
          players: [victim, support],
        },
      ],
    });
    const kill = {
      ...detail.killEvents[0]!,
      killerPuuid: killer.puuid,
      killerName: killer.gameName,
      killerTag: killer.tagLine,
      killerTeam: killer.teamId,
      victimPuuid: victim.puuid,
      victimName: victim.gameName,
      victimTag: victim.tagLine,
      victimTeam: victim.teamId,
      victimLocation: { x: 1_000, y: 0 },
      playerLocations: [
        {
          puuid: killer.puuid,
          gameName: killer.gameName,
          tagLine: killer.tagLine,
          teamId: killer.teamId,
          viewRadians: 0,
          location: { x: 0, y: 0 },
        },
        {
          puuid: support.puuid,
          gameName: support.gameName,
          tagLine: support.tagLine,
          teamId: support.teamId,
          viewRadians: 0,
          location: { x: 1_000, y: 1_000 },
        },
      ],
    };
    const snapshot = buildAttentionSnapshot(detail, kill, ref(killer), ref(victim));
    expect(snapshot.teammatesWithKillerInsideCone).toBe(0);
    expect(snapshot.geometricSummary).toContain("No recorded victim-team teammate had the killer inside");
    expect(snapshot.limitations.join(" ")).toContain("walls");
    expect(snapshot.limitations.join(" ")).toContain("smokes");
  });

  test("transforms raw facing into map-space orientation", () => {
    const angle = mapFacingRadians("Split", { x: 1_000, y: -4_000 }, 0);
    expect(angle).not.toBeNull();
    expect(Number.isFinite(angle)).toBe(true);
  });
});

function player(puuid: string, gameName: string, teamId: string, agentName: string): MatchPlayerDetail {
  return { ...sanitizedMatchDetail().teams[0]!.players[0]!, puuid, gameName, tagLine: "EU", teamId, agentName };
}
function ref(player: MatchPlayerDetail) {
  return {
    puuid: player.puuid,
    riotId: `${player.gameName}#${player.tagLine}`,
    gameName: player.gameName,
    tagLine: player.tagLine,
    teamId: player.teamId,
    agentName: player.agentName,
  };
}
