import { describe, expect, test } from "bun:test";

import { normalizeMatchDetail } from "./match-detail-normalizer";

describe("normalizeMatchDetail", () => {
  test("normalizes a Henrik v4 match scoreboard into teams and players", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "match-1",
          map: { name: "Pearl" },
          game_version: "release-13.02-shipping-15-5253245",
          queue: { name: "Competitive" },
          started_at: "2026-05-31T12:28:23.510Z",
          duration: { millis: 800_000 },
          average_tier: { name: "Platinum III" },
        },
        players: [
          {
            puuid: "red-1",
            name: "JasoPaso12",
            tag: "JAS",
            team_id: "Red",
            party_id: "red-party-1",
            level: 152,
            agent: { name: "Deadlock" },
            tier: { id: 17, name: "Platinum III" },
            stats: {
              score: 2408,
              kills: 9,
              deaths: 8,
              assists: 2,
              damage: { dealt: 1385, received: 1425, average: 173.1 },
              headshots: 5,
              bodyshots: 16,
              legshots: 1,
              kast: 0.88,
              first_kills: 0,
              first_deaths: 0,
              multi_kills: 0,
            },
          },
          {
            puuid: "blue-1",
            name: "ikOne",
            tag: "0101",
            team_id: "Blue",
            party_id: "blue-party-1",
            level: 487,
            agent: { name: "Yoru" },
            tier: { id: 15, name: "Platinum I" },
            stats: {
              score: 2557,
              kills: 10,
              deaths: 2,
              assists: 0,
              damage: { dealt: 1909, received: 472, average: 238.6 },
              headshots: 10,
              bodyshots: 11,
              legshots: 1,
              kast: 0.75,
              first_kills: 0,
              first_deaths: 1,
              multi_kills: 2,
            },
            economy: {
              spent: { overall: 42_000, average: 5_250 },
              loadout_value: { overall: 36_000, average: 4_500 },
            },
            ability_casts: {
              grenade: 2,
              ability1: 3,
              ability2: 4,
              ultimate: 1,
            },
          },
        ],
        teams: [
          { team_id: "Red", rounds: { won: 0, lost: 8 }, won: false, average_tier: { name: "Diamond I" } },
          { team_id: "Blue", rounds: { won: 8, lost: 0 }, won: true, average_tier: { name: "Platinum II" } },
        ],
        rounds: [
          {
            round: 1,
            winning_team: "Blue",
            result: "Defuse",
            ceremony: "CeremonyDefault",
            plant: { player: { name: "ikOne", tag: "0101", team: "Blue" }, site: "A", time_in_round_in_ms: 31_000 },
            defuse: { player: { name: "Support", tag: "EU", team: "Blue" }, site: "A", round_time_in_ms: 41_000 },
            stats: [
              {
                player: { puuid: "blue-1", name: "ikOne", tag: "0101", team: "Blue" },
                stats: { score: 350, kills: 1, headshots: 1, bodyshots: 0, legshots: 0 },
                damage_events: [
                  {
                    player: { puuid: "red-1", name: "JasoPaso12", tag: "JAS", team: "Red" },
                    damage: 175,
                    headshots: 1,
                    bodyshots: 1,
                    legshots: 0,
                  },
                ],
                economy: {
                  loadout_value: 2900,
                  remaining: 800,
                  weapon: { name: "Vandal" },
                  armor: { name: "Heavy Shields" },
                },
                ability_casts: { grenade: 0, ability_1: 1, ability_2: 0, ultimate: null },
                was_afk: false,
                received_penalty: false,
                stayed_in_spawn: false,
              },
            ],
          },
          { round: 2, winning_team: "Blue", result: "Elimination" },
        ],
        kills: [
          {
            round: 1,
            time_in_round_in_ms: 23_000,
            time_in_match_in_ms: 90_000,
            killer: { puuid: "blue-1", name: "ikOne", tag: "0101", team: "Blue" },
            victim: { puuid: "red-1", name: "JasoPaso12", tag: "JAS", team: "Red" },
            weapon: { name: "Vandal" },
            assistants: [{ puuid: "support-puuid", name: "Support" }],
            location: { x: 1_000, y: 2_000 },
            player_locations: [
              {
                player: { puuid: "blue-1", name: "ikOne", tag: "0101", team: "Blue" },
                view_radians: 1.25,
                location: { x: 700, y: 1_600 },
              },
            ],
          },
        ],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    expect(detail).toMatchObject({
      matchId: "match-1",
      mode: "Competitive",
      mapName: "Pearl",
      gameVersion: "release-13.02-shipping-15-5253245",
      patch: "13.02",
      averageTierName: "Platinum III",
      durationMs: 800_000,
      endState: { kind: "completed", label: "Completed", evidence: "team-result" },
      source: "live",
      evidence: { roster: { state: "partial" }, kills: { state: "partial" } },
    });
    expect(detail?.teams).toHaveLength(2);
    /* One vocabulary for the two sides: the provider names them Red and Blue and
       so does the product, on both the live and the archive path. */
    expect(detail?.teams[1]).toMatchObject({
      label: "Blue Team",
      roundsWon: 8,
      won: true,
      averageTierName: "Platinum II",
    });
    expect(detail?.teams[1]?.players[0]).toMatchObject({
      gameName: "ikOne",
      tagLine: "0101",
      agentName: "Yoru",
      kills: 10,
      deaths: 2,
      assists: 0,
      partyId: "blue-party-1",
      tierId: 15,
      tierName: "Platinum I",
      adr: 238.6,
      damageDelta: 179.625,
      firstDeaths: 1,
      threePlusKillRounds: 0,
      multiKills: 2,
      spentOverall: 42_000,
      spentAverage: 5_250,
      loadoutOverall: 36_000,
      loadoutAverage: 4_500,
      abilityCasts: {
        grenade: 2,
        ability1: 3,
        ability2: 4,
        ultimate: 1,
        total: 10,
      },
    });
    expect(detail?.teams[1]?.players[0]?.acs).toBeCloseTo(319.625, 3);
    expect(detail?.teams[1]?.players[0]?.headshotRate).toBeCloseTo(0.4545, 3);
    expect(detail?.rounds[0]).toMatchObject({
      number: 1,
      winningTeam: "Blue",
      result: "Defuse",
      ceremony: "CeremonyDefault",
      spikePlant: { playerName: "ikOne", playerTag: "0101", teamId: "Blue", site: "A", timeInRoundMs: 31_000 },
      spikeDefuse: { playerName: "Support", playerTag: "EU", teamId: "Blue", site: "A", timeInRoundMs: 41_000 },
      teamScores: [{ teamId: "Blue", roundsWon: 1 }],
      playerStats: [
        {
          puuid: "blue-1",
          gameName: "ikOne",
          tagLine: "0101",
          teamId: "Blue",
          score: 350,
          kills: 1,
          headshots: 1,
          loadoutValue: 2900,
          remainingCredits: 800,
          weaponName: "Vandal",
          armorName: "Heavy Shields",
          damageEvents: [
            {
              targetPuuid: "red-1",
              targetName: "JasoPaso12",
              targetTag: "JAS",
              targetTeam: "Red",
              damage: 175,
              headshots: 1,
              bodyshots: 1,
              legshots: 0,
            },
          ],
          abilityCasts: {
            grenade: 0,
            ability1: 1,
            ability2: 0,
            ultimate: null,
            total: 1,
          },
        },
      ],
    });
    expect(detail?.rounds[1]).toMatchObject({
      number: 2,
      winningTeam: "Blue",
      result: "Elimination",
      teamScores: [{ teamId: "Blue", roundsWon: 2 }],
    });
    expect(detail?.killEvents).toEqual([
      {
        round: 1,
        timeInRoundMs: 23_000,
        timeInMatchMs: 90_000,
        killerPuuid: "blue-1",
        killerName: "ikOne",
        killerTag: "0101",
        killerTeam: "Blue",
        victimPuuid: "red-1",
        victimName: "JasoPaso12",
        victimTag: "JAS",
        victimTeam: "Red",
        weaponName: "Vandal",
        assistants: ["Support"],
        assistantPuuids: ["support-puuid"],
        victimLocation: { x: 1_000, y: 2_000 },
        playerLocations: [
          {
            puuid: "blue-1",
            gameName: "ikOne",
            tagLine: "0101",
            teamId: "Blue",
            viewRadians: 1.25,
            location: { x: 700, y: 1_600 },
          },
        ],
        distanceMeters: 5,
      },
    ]);
  });

  test("marks stored single-player rows as cache-limited", () => {
    const detail = normalizeMatchDetail(
      {
        meta: {
          id: "stored-match-1",
          map: { name: "Pearl" },
          mode: "Competitive",
        },
        stats: {
          puuid: "target-puuid",
          name: "ikOne",
          tag: "0101",
          team: "Blue",
          character: { name: "Yoru" },
          kills: 10,
          deaths: 2,
          assists: 0,
        },
        teams: {
          red: 0,
          blue: 8,
        },
      },
      { region: "eu", platform: "pc", source: "cache" },
    );

    expect(detail?.source).toBe("cache");
    expect(detail?.warnings.join(" ")).toContain("roster evidence is partial");
    expect(detail?.teams.find((team) => team.teamId === "blue")?.players).toHaveLength(1);
  });

  test("ignores trailing surrender placeholder rounds beyond the scored round count", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "surrender-placeholder-match",
          map: { name: "Pearl" },
          queue: { name: "Competitive" },
        },
        players: [
          {
            puuid: "target-puuid",
            name: "ikOne",
            tag: "0101",
            team_id: "Blue",
            stats: { score: 2557, kills: 10, deaths: 2, assists: 0 },
          },
          {
            puuid: "enemy-puuid",
            name: "Enemy",
            tag: "EU",
            team_id: "Red",
            stats: { score: 1200, kills: 2, deaths: 10, assists: 0 },
          },
        ],
        teams: [
          { team_id: "Red", rounds: { won: 0, lost: 8 }, won: false },
          { team_id: "Blue", rounds: { won: 8, lost: 0 }, won: true },
        ],
        rounds: [
          { winning_team: "Blue", result: "Defuse" },
          { winning_team: "Blue", result: "Elimination" },
          { winning_team: "Blue", result: "Elimination" },
          { winning_team: "Blue", result: "Elimination" },
          { winning_team: "Blue", result: "Defuse" },
          { winning_team: "Blue", result: "Elimination" },
          { winning_team: "Blue", result: "Elimination" },
          { winning_team: "Blue", result: "Elimination" },
          { winning_team: "Blue", result: "Surrendered" },
          { winning_team: "Blue", result: "Surrendered" },
          { winning_team: "Blue", result: "Surrendered" },
          { winning_team: "Blue", result: "Surrendered" },
          { winning_team: "Blue", result: "Surrendered" },
        ],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    expect(detail?.rounds).toHaveLength(8);
    expect(detail?.rounds.map((round) => round.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(detail?.rounds.some((round) => round.result === "Surrendered")).toBe(false);
    expect(detail?.endState).toEqual({ kind: "surrendered", label: "Surrendered", evidence: "round-result" });
  });

  test("keeps a completed overtime tie neutral and labels an explicit remake only from provider evidence", () => {
    const draw = normalizeMatchDetail(
      {
        metadata: { match_id: "draw-match", is_completed: true },
        players: [
          { puuid: "blue", team_id: "Blue" },
          { puuid: "red", team_id: "Red" },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 15, lost: 15 }, won: false },
          { team_id: "Red", rounds: { won: 15, lost: 15 }, won: false },
        ],
      },
      { region: "eu", platform: "pc", source: "live" },
    );
    const remake = normalizeMatchDetail(
      {
        metadata: { match_id: "remake-match", is_completed: true },
        players: [
          { puuid: "blue", team_id: "Blue" },
          { puuid: "red", team_id: "Red" },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 1, lost: 1 }, won: false },
          { team_id: "Red", rounds: { won: 1, lost: 1 }, won: false },
        ],
        rounds: [{ result: "Remake" }],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    expect(draw?.teams.map((team) => team.won)).toEqual([null, null]);
    expect(draw?.endState).toEqual({ kind: "draw", label: "Draw", evidence: "team-score" });
    expect(remake?.endState).toEqual({ kind: "remake", label: "Remake", evidence: "round-result" });
  });

  test("derives ADR from total damage when Henrik omits damage average", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "damage-average-match",
          map: { name: "Pearl" },
          queue: { name: "Competitive" },
        },
        players: [
          {
            puuid: "target-puuid",
            name: "ikOne",
            tag: "0101",
            team_id: "Blue",
            agent: { name: "Yoru" },
            stats: {
              score: 2557,
              kills: 10,
              deaths: 2,
              assists: 0,
              damage: { dealt: 1909, received: 472 },
            },
          },
        ],
        teams: [{ team_id: "Blue", rounds: { won: 8, lost: 0 }, won: true }],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    const player = detail?.teams[0]?.players[0];
    expect(player?.acs).toBeCloseTo(319.625, 3);
    expect(player?.adr).toBeCloseTo(238.625, 3);
    expect(player?.damageDelta).toBeCloseTo(179.625, 3);
    expect(JSON.stringify(player)).not.toContain("damageDealtTotal");
  });

  test("excludes teammate damage from ADR and damage delta when complete round evidence is available", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: { match_id: "friendly-fire-match", queue: { name: "Swiftplay" } },
        players: [
          {
            puuid: "focus",
            name: "Focus",
            tag: "EU",
            team_id: "Blue",
            stats: { score: 1200, damage: { dealt: 1474, received: 953 } },
          },
          {
            puuid: "teammate",
            name: "Teammate",
            tag: "EU",
            team_id: "Blue",
            stats: { score: 900, damage: { dealt: 500, received: 600 } },
          },
          {
            puuid: "enemy",
            name: "Enemy",
            tag: "EU",
            team_id: "Red",
            stats: { score: 1000, damage: { dealt: 953, received: 1440 } },
          },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 5, lost: 1 }, won: true },
          { team_id: "Red", rounds: { won: 1, lost: 5 }, won: false },
        ],
        rounds: Array.from({ length: 6 }, (_, index) => ({
          round: index + 1,
          winning_team: index === 1 ? "Red" : "Blue",
          stats: [
            {
              player: { puuid: "focus", name: "Focus", tag: "EU", team: "Blue" },
              damage_events: [
                { player: { puuid: "enemy", name: "Enemy", tag: "EU", team: "Red" }, damage: 240 },
                ...(index === 4
                  ? [{ player: { puuid: "teammate", name: "Teammate", tag: "EU", team: "Blue" }, damage: 34 }]
                  : []),
              ],
            },
            {
              player: { puuid: "teammate", name: "Teammate", tag: "EU", team: "Blue" },
              damage_events: [],
            },
            {
              player: { puuid: "enemy", name: "Enemy", tag: "EU", team: "Red" },
              damage_events: [
                { player: { puuid: "focus", name: "Focus", tag: "EU", team: "Blue" }, damage: index === 5 ? 158 : 159 },
              ],
            },
          ],
        })),
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    const player = detail?.teams.find((team) => team.teamId === "Blue")?.players.find((row) => row.puuid === "focus");
    expect(player?.adr).toBe(240);
    expect(player?.damageDelta).toBeCloseTo((1440 - 953) / 6, 6);
  });

  test("derives player KAST from rounds when match detail omits it", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "kast-match-1",
          map: { name: "Bind" },
          queue: { name: "Competitive" },
        },
        players: [
          {
            puuid: "target-puuid",
            name: "Target",
            tag: "EU",
            team_id: "Blue",
            agent: { name: "Sova" },
            stats: { score: 1200, kills: 1, deaths: 2, assists: 0 },
          },
          {
            puuid: "trade-puuid",
            name: "Trade",
            tag: "EU",
            team_id: "Blue",
            stats: { score: 900, kills: 1, deaths: 0, assists: 0 },
          },
          {
            puuid: "enemy-puuid",
            name: "Enemy",
            tag: "EU",
            team_id: "Red",
            stats: { score: 1100, kills: 2, deaths: 2, assists: 0 },
          },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 1, lost: 2 }, won: false },
          { team_id: "Red", rounds: { won: 2, lost: 1 }, won: true },
        ],
        rounds: [
          { round: 1, stats: [{ player: { puuid: "target-puuid" }, stats: { kills: 1, assists: 0 } }] },
          { round: 2, stats: [{ player: { puuid: "target-puuid" }, stats: { kills: 0, assists: 0 } }] },
          { round: 3, stats: [{ player: { puuid: "target-puuid" }, stats: { kills: 0, assists: 0 } }] },
        ],
        kills: [
          {
            round: 1,
            time_in_round_in_ms: 10_000,
            killer: { puuid: "target-puuid", team: "Blue" },
            victim: { puuid: "enemy-puuid", team: "Red" },
          },
          {
            round: 2,
            time_in_round_in_ms: 20_000,
            killer: { puuid: "enemy-puuid", team: "Red" },
            victim: { puuid: "target-puuid", team: "Blue" },
          },
          {
            round: 2,
            time_in_round_in_ms: 23_000,
            killer: { puuid: "trade-puuid", team: "Blue" },
            victim: { puuid: "enemy-puuid", team: "Red" },
          },
          {
            round: 3,
            time_in_round_in_ms: 20_000,
            killer: { puuid: "enemy-puuid", team: "Red" },
            victim: { puuid: "target-puuid", team: "Blue" },
          },
        ],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    const target = detail?.teams.flatMap((team) => team.players).find((player) => player.puuid === "target-puuid");
    expect(target?.kast).toBeCloseTo(2 / 3, 3);
  });

  test("derives match and team average ranks from player tiers when Henrik omits average tier metadata", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "rank-match-1",
          map: { name: "Pearl" },
          queue: { name: "Competitive" },
        },
        players: [
          {
            puuid: "blue-1",
            name: "BlueOne",
            tag: "EU",
            team_id: "Blue",
            tier: { id: 15, name: "Platinum 1" },
            stats: { score: 1600, kills: 8, deaths: 5, assists: 1 },
          },
          {
            puuid: "blue-2",
            name: "BlueTwo",
            tag: "EU",
            team_id: "Blue",
            tier: { id: 17, name: "Platinum 3" },
            stats: { score: 1500, kills: 7, deaths: 5, assists: 2 },
          },
          {
            puuid: "red-1",
            name: "RedOne",
            tag: "EU",
            team_id: "Red",
            tier: { id: 18, name: "Diamond 1" },
            stats: { score: 1400, kills: 6, deaths: 6, assists: 3 },
          },
          {
            puuid: "red-2",
            name: "RedTwo",
            tag: "EU",
            team_id: "Red",
            tier: { id: 20, name: "Diamond 3" },
            stats: { score: 1300, kills: 5, deaths: 7, assists: 4 },
          },
        ],
        teams: {
          blue: 13,
          red: 10,
        },
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    expect(detail?.averageTierName).toBe("Diamond 1");
    expect(detail?.teams.find((team) => team.teamId === "blue")?.averageTierName).toBe("Platinum 2");
    expect(detail?.teams.find((team) => team.teamId === "red")?.averageTierName).toBe("Diamond 2");
  });

  test("derives multikill highlights from kill events", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "multi-match-1",
          map: { name: "Haven" },
          queue: { name: "Competitive" },
        },
        players: [
          {
            puuid: "target-puuid",
            name: "Target",
            tag: "EU",
            team_id: "Blue",
            agent: { name: "Jett" },
            stats: { score: 2400, kills: 3, deaths: 1, assists: 0 },
          },
          {
            puuid: "enemy-1",
            name: "EnemyOne",
            tag: "EU",
            team_id: "Red",
            stats: { score: 800, kills: 0, deaths: 1, assists: 0 },
          },
          {
            puuid: "enemy-2",
            name: "EnemyTwo",
            tag: "EU",
            team_id: "Red",
            stats: { score: 800, kills: 0, deaths: 1, assists: 0 },
          },
          {
            puuid: "enemy-3",
            name: "EnemyThree",
            tag: "EU",
            team_id: "Red",
            stats: { score: 800, kills: 0, deaths: 1, assists: 0 },
          },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 1, lost: 0 }, won: true },
          { team_id: "Red", rounds: { won: 0, lost: 1 }, won: false },
        ],
        kills: [
          {
            round: 1,
            killer: { puuid: "target-puuid", name: "Target", tag: "EU", team: "Blue" },
            victim: { puuid: "enemy-1", name: "EnemyOne", tag: "EU", team: "Red" },
          },
          {
            round: 1,
            killer: { puuid: "target-puuid", name: "Target", tag: "EU", team: "Blue" },
            victim: { puuid: "enemy-2", name: "EnemyTwo", tag: "EU", team: "Red" },
          },
          {
            round: 1,
            killer: { puuid: "target-puuid", name: "Target", tag: "EU", team: "Blue" },
            victim: { puuid: "enemy-3", name: "EnemyThree", tag: "EU", team: "Red" },
          },
        ],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    const target = detail?.teams.flatMap((team) => team.players).find((player) => player.puuid === "target-puuid");
    expect(target?.highlights).toEqual(["3k"]);
    expect(target?.multiKills).toBe(3);
    expect(target?.threePlusKillRounds).toBe(1);
  });

  test("derives clutch highlights without confusing the multikill metric", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "clutch-match-1",
          map: { name: "Lotus" },
          queue: { name: "Competitive" },
        },
        players: [
          {
            puuid: "target-puuid",
            name: "Target",
            tag: "EU",
            team_id: "Blue",
            agent: { name: "Yoru" },
            stats: { score: 3000, kills: 3, deaths: 0, assists: 0 },
          },
          {
            puuid: "teammate-puuid",
            name: "Teammate",
            tag: "EU",
            team_id: "Blue",
            stats: { score: 400, kills: 0, deaths: 1, assists: 0 },
          },
          {
            puuid: "enemy-1",
            name: "EnemyOne",
            tag: "EU",
            team_id: "Red",
            stats: { score: 800, kills: 1, deaths: 1, assists: 0 },
          },
          {
            puuid: "enemy-2",
            name: "EnemyTwo",
            tag: "EU",
            team_id: "Red",
            stats: { score: 700, kills: 0, deaths: 1, assists: 0 },
          },
          {
            puuid: "enemy-3",
            name: "EnemyThree",
            tag: "EU",
            team_id: "Red",
            stats: { score: 600, kills: 0, deaths: 1, assists: 0 },
          },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 1, lost: 0 }, won: true },
          { team_id: "Red", rounds: { won: 0, lost: 1 }, won: false },
        ],
        rounds: [{ round: 1, winning_team: "Blue", result: "Elimination" }],
        kills: [
          {
            round: 1,
            time_in_round_in_ms: 10_000,
            killer: { puuid: "enemy-1", name: "EnemyOne", tag: "EU", team: "Red" },
            victim: { puuid: "teammate-puuid", name: "Teammate", tag: "EU", team: "Blue" },
          },
          {
            round: 1,
            time_in_round_in_ms: 20_000,
            killer: { puuid: "target-puuid", name: "Target", tag: "EU", team: "Blue" },
            victim: { puuid: "enemy-1", name: "EnemyOne", tag: "EU", team: "Red" },
          },
          {
            round: 1,
            time_in_round_in_ms: 25_000,
            killer: { puuid: "target-puuid", name: "Target", tag: "EU", team: "Blue" },
            victim: { puuid: "enemy-2", name: "EnemyTwo", tag: "EU", team: "Red" },
          },
          {
            round: 1,
            time_in_round_in_ms: 30_000,
            killer: { puuid: "target-puuid", name: "Target", tag: "EU", team: "Blue" },
            victim: { puuid: "enemy-3", name: "EnemyThree", tag: "EU", team: "Red" },
          },
        ],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    const target = detail?.teams.flatMap((team) => team.players).find((player) => player.puuid === "target-puuid");
    expect(target?.highlights).toEqual(["1v3 Clutch", "3k"]);
    expect(target?.multiKills).toBe(3);
  });

  test("derives first kills and first deaths from first kill event per round", () => {
    const detail = normalizeMatchDetail(
      {
        metadata: {
          match_id: "entry-match-1",
          map: { name: "Ascent" },
          queue: { name: "Competitive" },
        },
        players: [
          {
            puuid: "entry-puuid",
            name: "Entry",
            tag: "EU",
            team_id: "Blue",
            stats: { score: 1600, kills: 2, deaths: 1, assists: 0 },
          },
          {
            puuid: "trade-puuid",
            name: "Trade",
            tag: "EU",
            team_id: "Blue",
            stats: { score: 1200, kills: 1, deaths: 1, assists: 0 },
          },
          {
            puuid: "enemy-puuid",
            name: "Enemy",
            tag: "EU",
            team_id: "Red",
            stats: { score: 1400, kills: 1, deaths: 2, assists: 0 },
          },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 1, lost: 1 }, won: false },
          { team_id: "Red", rounds: { won: 1, lost: 1 }, won: false },
        ],
        kills: [
          {
            round: 1,
            time_in_round_in_ms: 18_000,
            killer: { puuid: "trade-puuid", name: "Trade", team: "Blue" },
            victim: { puuid: "enemy-puuid", name: "Enemy", team: "Red" },
          },
          {
            round: 1,
            time_in_round_in_ms: 8_000,
            killer: { puuid: "enemy-puuid", name: "Enemy", team: "Red" },
            victim: { puuid: "entry-puuid", name: "Entry", team: "Blue" },
          },
          {
            round: 2,
            time_in_round_in_ms: 11_000,
            killer: { puuid: "entry-puuid", name: "Entry", team: "Blue" },
            victim: { puuid: "enemy-puuid", name: "Enemy", team: "Red" },
          },
        ],
      },
      { region: "eu", platform: "pc", source: "live" },
    );

    const players = detail?.teams.flatMap((team) => team.players) ?? [];
    expect(players.find((player) => player.puuid === "entry-puuid")).toMatchObject({ firstKills: 1, firstDeaths: 1 });
    expect(players.find((player) => player.puuid === "enemy-puuid")).toMatchObject({ firstKills: 1, firstDeaths: 1 });
    expect(players.find((player) => player.puuid === "trade-puuid")).toMatchObject({ firstKills: 0, firstDeaths: 0 });
  });
});
