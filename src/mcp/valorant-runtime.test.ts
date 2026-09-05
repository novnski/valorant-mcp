import { describe, expect, test } from "bun:test";

import { ValorantRuntime } from "./valorant-runtime";

describe("ValorantRuntime", () => {
  test("resolves arbitrary Riot IDs and returns live rank without a profile store", async () => {
    const fake = fakeHenrik();
    const runtime = new ValorantRuntime(fake);

    const profile = await runtime.getPlayer("Focus#EU", "eu", "pc");

    expect(profile).toMatchObject({
      identity: { puuid: "focus-puuid", riotId: "Focus#EU", region: "eu", platform: "pc" },
      rank: { tierName: "Diamond I", rr: 62, peakTierName: "Ascendant I" },
    });
    expect(fake.calls.accountByRiotId).toBe(1);
    expect(fake.calls.mmr).toBe(1);
  });

  test("returns numbered newest-first matches with exact IDs", async () => {
    const fake = fakeHenrik();
    const runtime = new ValorantRuntime(fake);

    const result = await runtime.listMatches({
      player: "Focus#EU",
      region: "eu",
      platform: "pc",
      limit: 5,
      mode: "competitive",
    });

    expect(result.player.puuid).toBe("focus-puuid");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      index: 1,
      matchId: "henrik-live-match",
      result: "loss",
      mapName: "Haven",
      kills: 0,
      deaths: 1,
    });
    expect(fake.calls.matches).toBe(1);
  });

  test("uses Tracker profile URL hints and the account's authoritative region", async () => {
    const fake = fakeHenrik();
    const runtime = new ValorantRuntime(fake);
    const profileUrl = "https://tracker.gg/valorant/profile/riot/Focus%23EU/overview?platform=pc&playlist=swiftplay";

    const result = await runtime.listMatches({ player: profileUrl, region: "na", platform: "console", limit: 5 });

    expect(result.player).toMatchObject({ riotId: "Focus#EU", region: "eu", platform: "pc" });
    expect(result.input).toEqual({
      source: "tracker-profile",
      appliedPlatform: "pc",
      appliedPlaylist: "swiftplay",
      ignoredSeason: null,
    });
    expect(fake.calls.lastMatchesArgs).toEqual(["eu", "pc", "focus-puuid", 5, "swiftplay"]);
  });

  test("passes a Tracker match URL's UUID to Henrik", async () => {
    const fake = fakeHenrik();
    const runtime = new ValorantRuntime(fake);

    await runtime.getMatch({
      matchId: "https://tracker.gg/valorant/match/8aa18f0a-58bc-4f13-ba0b-9afc4be74f95",
      region: "eu",
      platform: "pc",
    });

    expect(fake.calls.lastMatchId).toBe("8aa18f0a-58bc-4f13-ba0b-9afc4be74f95");
  });

  test("accepts Tracker profile links in death and tactical player selectors", async () => {
    const fake = fakeHenrik();
    const runtime = new ValorantRuntime(fake);
    const focusUrl = "https://tracker.gg/valorant/profile/riot/Focus%23EU/overview?platform=pc";
    const enemyUrl = "https://tracker.gg/valorant/profile/riot/Enemy%23EU/overview?platform=pc";

    const review = await runtime.reviewDeaths({
      matchId: "henrik-live-match",
      region: "eu",
      platform: "pc",
      player: focusUrl,
    });
    const snapshot = await runtime.getTacticalSnapshot({
      matchId: "henrik-live-match",
      roundNumber: 1,
      region: "eu",
      platform: "pc",
      players: [enemyUrl],
    });

    expect(review.player).toMatchObject({ riotId: "Focus#EU" });
    expect(snapshot.markers.some((marker) => marker.player.riotId === "Enemy#EU")).toBe(true);
  });

  test("builds match, analysis, round events, and spatial evidence directly from Henrik", async () => {
    const fake = fakeHenrik();
    const runtime = new ValorantRuntime(fake);

    const analysis = await runtime.analyzeMatch({
      matchId: "henrik-live-match",
      region: "eu",
      platform: "pc",
      focusPlayer: "focus-puuid",
    });
    const round = await runtime.getRound({
      matchId: "henrik-live-match",
      roundNumber: 1,
      region: "eu",
      platform: "pc",
      focusPlayer: "focus-puuid",
    });

    expect(analysis.match).toMatchObject({
      match: { matchId: "henrik-live-match", map: "Haven", mode: "Competitive" },
      focus: { puuid: "focus-puuid" },
    });
    expect(analysis.analysis?.recommendation).toBeNull();
    expect(analysis.features.duels.available).toBe(false);
    expect(analysis.limitations.join(" ")).toContain("kills evidence is partial");
    expect(analysis.spatialCoverage).toMatchObject({
      totalKillEvents: 1,
      eventsWithPositions: 1,
      validSamples: 3,
      invalidSamples: 0,
    });
    expect(round).toMatchObject({ focusOutcome: "loss", round: { roundNumber: 1, winningTeam: "Red" } });
    expect(round.round.events[0]).toMatchObject({
      id: "r1-kill-0",
      kind: "kill",
      actor: { gameName: "Enemy" },
      target: { gameName: "Focus" },
    });
    expect(round.explanationFacts.join(" ")).toContain("Focus team lost the round");
    expect(fake.calls.match).toBe(1);
  });
});

function fakeHenrik() {
  const calls: {
    accountByRiotId: number;
    accountByPuuid: number;
    mmr: number;
    matches: number;
    match: number;
    lastMatchesArgs: [string, string, string, number, string | undefined] | null;
    lastMatchId: string | null;
  } = { accountByRiotId: 0, accountByPuuid: 0, mmr: 0, matches: 0, match: 0, lastMatchesArgs: null, lastMatchId: null };
  return {
    calls,
    async getAccountByRiotId(name: string, tag: string) {
      calls.accountByRiotId += 1;
      return { puuid: "focus-puuid", region: "eu", account_level: 222, name, tag, platforms: ["pc"] };
    },
    async getAccountByPuuid(puuid: string) {
      calls.accountByPuuid += 1;
      return {
        puuid,
        region: "eu",
        account_level: 222,
        name: puuid === "focus-puuid" ? "Focus" : "Other",
        tag: "EU",
        platforms: ["pc"],
      };
    },
    async getMmrByPuuid() {
      calls.mmr += 1;
      return {
        current: { tier: { id: 18, name: "Diamond I" }, rr: 62, elo: 1_862 },
        peak: { tier: { id: 21, name: "Ascendant I" }, season: { id: "season", short: "E11A3" } },
      };
    },
    async getMatchesByPuuid(region: string, platform: string, puuid: string, limit: number, mode?: string) {
      calls.matches += 1;
      calls.lastMatchesArgs = [region, platform, puuid, limit, mode];
      return [providerMatch()];
    },
    async getMatch(_region: string, _platform: string, matchId: string) {
      calls.match += 1;
      calls.lastMatchId = matchId;
      return providerMatch(matchId);
    },
  };
}

function providerMatch(matchId = "henrik-live-match"): unknown {
  return {
    metadata: {
      match_id: matchId,
      map: { name: "Haven" },
      queue: { id: "competitive", name: "Competitive" },
      started_at: "2026-08-24T20:00:00.000Z",
      duration: { millis: 120_000 },
      game_version: "release-13.02-shipping-test",
      average_tier: { name: "Diamond I" },
    },
    players: [
      {
        puuid: "focus-puuid",
        name: "Focus",
        tag: "EU",
        team_id: "Blue",
        agent: { name: "Sova" },
        tier: { id: 18, name: "Diamond I" },
        stats: {
          score: 100,
          kills: 0,
          deaths: 1,
          assists: 0,
          damage: { dealt: 40, received: 150, average: 40 },
          headshots: 0,
          bodyshots: 1,
          legshots: 0,
        },
        economy: { spent: { overall: 3_900, average: 3_900 }, loadout_value: { overall: 3_900, average: 3_900 } },
        ability_casts: { grenade: 0, ability1: 1, ability2: 0, ultimate: 0 },
      },
      {
        puuid: "enemy-puuid",
        name: "Enemy",
        tag: "EU",
        team_id: "Red",
        agent: { name: "Omen" },
        tier: { id: 18, name: "Diamond I" },
        stats: {
          score: 300,
          kills: 1,
          deaths: 0,
          assists: 0,
          damage: { dealt: 150, received: 40, average: 150 },
          headshots: 1,
          bodyshots: 0,
          legshots: 0,
        },
        economy: { spent: { overall: 4_200, average: 4_200 }, loadout_value: { overall: 4_200, average: 4_200 } },
        ability_casts: { grenade: 0, ability1: 0, ability2: 1, ultimate: 0 },
      },
    ],
    teams: [
      { team_id: "Blue", rounds: { won: 0, lost: 1 }, won: false },
      { team_id: "Red", rounds: { won: 1, lost: 0 }, won: true },
    ],
    rounds: [
      {
        round: 1,
        winning_team: "Red",
        result: "Elimination",
        stats: [
          {
            player: { puuid: "focus-puuid", name: "Focus", tag: "EU", team: "Blue" },
            stats: { score: 100, kills: 0, headshots: 0, bodyshots: 1, legshots: 0 },
            economy: {
              loadout_value: 3_900,
              remaining: 100,
              weapon: { name: "Vandal" },
              armor: { name: "Heavy Shields" },
            },
            ability_casts: { grenade: 0, ability_1: 1, ability_2: 0, ultimate: 0 },
            was_afk: false,
            received_penalty: false,
            stayed_in_spawn: false,
          },
          {
            player: { puuid: "enemy-puuid", name: "Enemy", tag: "EU", team: "Red" },
            stats: { score: 300, kills: 1, headshots: 1, bodyshots: 0, legshots: 0 },
            economy: {
              loadout_value: 4_200,
              remaining: 300,
              weapon: { name: "Vandal" },
              armor: { name: "Heavy Shields" },
            },
            ability_casts: { grenade: 0, ability_1: 0, ability_2: 1, ultimate: 0 },
            was_afk: false,
            received_penalty: false,
            stayed_in_spawn: false,
          },
        ],
      },
    ],
    kills: [
      {
        round: 0,
        time_in_round_in_ms: 18_000,
        time_in_match_in_ms: 18_000,
        killer: { puuid: "enemy-puuid", name: "Enemy", tag: "EU", team: "Red" },
        victim: { puuid: "focus-puuid", name: "Focus", tag: "EU", team: "Blue" },
        weapon: { name: "Vandal" },
        assistants: [],
        location: { x: 2_300, y: -7_500 },
        player_locations: [
          {
            player: { puuid: "enemy-puuid", name: "Enemy", tag: "EU", team: "Red" },
            view_radians: 2.2,
            location: { x: 1_900, y: -7_900 },
          },
          {
            player: { puuid: "focus-puuid", name: "Focus", tag: "EU", team: "Blue" },
            view_radians: 0.4,
            location: { x: 2_300, y: -7_500 },
          },
        ],
      },
    ],
  };
}
