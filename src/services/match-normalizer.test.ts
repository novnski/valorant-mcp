import { describe, expect, test } from "bun:test";

import { normalizeMatches } from "./match-normalizer";

describe("normalizeMatches", () => {
  test("retains two compact five-agent team compositions from match history payloads", () => {
    const players = [
      ...["Jett", "Sova", "Sage", "Omen", "Raze"].map((name, index) => ({
        puuid: `blue-${index}`,
        team_id: "Blue",
        agent: { name },
      })),
      ...["Cypher", "Deadlock", "Fade", "Neon", "Viper"].map((name, index) => ({
        puuid: `red-${index}`,
        team_id: "Red",
        agent: { name },
      })),
    ];
    const { summaries } = normalizeMatches(
      [
        {
          metadata: { match_id: "composition-match", queue: { id: "competitive" } },
          players,
          teams: [
            { team_id: "Blue", won: true },
            { team_id: "Red", won: false },
          ],
        },
      ],
      "blue-0",
    );

    expect(summaries[0]?.teamCompositions).toEqual([
      { teamId: "Blue", agents: ["Jett", "Omen", "Raze", "Sage", "Sova"], won: true },
      { teamId: "Red", agents: ["Cypher", "Deadlock", "Fade", "Neon", "Viper"], won: false },
    ]);
  });

  test("normalizes Henrik v4 queue object, team result, rounds, and total score", () => {
    const { summaries } = normalizeMatches(
      [
        {
          metadata: {
            match_id: "match-1",
            map: { name: "Haven" },
            game_version: "release-13.02-shipping-15-5253245",
            game_length_in_ms: 1_690_000,
            started_at: "2026-06-04T00:00:00Z",
            season: { id: "season-v4", short: "e11a3" },
            queue: { id: "custom", name: "Custom Game", mode_type: "Skirmish" },
          },
          players: [
            {
              puuid: "other-puuid",
              name: "Queue Buddy",
              tag: "EU",
              team_id: "Red",
              party_id: "party-1",
              agent: { name: "Jett" },
              tier: { id: 17, name: "Platinum III" },
              stats: {
                score: 2000,
                kills: 8,
                deaths: 9,
                assists: 1,
              },
            },
            {
              puuid: "target-puuid",
              team_id: "Red",
              party_id: "party-1",
              agent: { name: "Yoru" },
              tier: { id: 15, name: "Platinum I" },
              stats: {
                score: 2644,
                kills: 12,
                deaths: 5,
                assists: 2,
                headshots: 5,
                bodyshots: 20,
                legshots: 1,
                damage: {
                  dealt: 1690,
                  received: 1400,
                },
              },
            },
            {
              puuid: "enemy-puuid",
              name: "Enemy One",
              tag: "EU",
              team_id: "Blue",
              agent: { name: "Omen" },
              stats: {
                score: 1200,
                kills: 5,
                deaths: 12,
                assists: 3,
              },
            },
          ],
          teams: [
            { team_id: "Red", rounds: { won: 10, lost: 3 }, won: true },
            { team_id: "Blue", rounds: { won: 3, lost: 10 }, won: false },
          ],
          kills: [
            { round: 1, killer: { puuid: "target-puuid" }, weapon: { name: "Vandal" } },
            { round: 1, killer: { puuid: "target-puuid" }, weapon: { name: "Vandal" } },
            { round: 1, killer: { puuid: "target-puuid" }, weapon: { name: "Sheriff" } },
          ],
        },
      ],
      "target-puuid",
    );

    expect(summaries[0]).toMatchObject({
      matchId: "match-1",
      mode: "custom",
      mapName: "Haven",
      gameVersion: "release-13.02-shipping-15-5253245",
      patch: "13.02",
      agentName: "Yoru",
      seasonId: "season-v4",
      seasonShort: "e11a3",
      durationMs: 1_690_000,
      result: "win",
      roundsWon: 10,
      roundsLost: 3,
      kills: 12,
      deaths: 5,
      assists: 2,
      score: 2644,
      tierId: 15,
      tierName: "Platinum I",
      placement: 1,
      headshots: 5,
      bodyshots: 20,
      legshots: 1,
      weapons: ["Vandal", "Sheriff"],
      teammates: ["Queue Buddy#EU"],
      opponents: ["Enemy One#EU"],
      opponentAgents: ["Omen"],
      highlights: ["3k"],
      partySize: 2,
    });
    expect(summaries[0]?.acs).toBeCloseTo(203.38, 2);
    expect(summaries[0]?.adr).toBe(130);
    expect(summaries[0]?.damageDelta).toBeCloseTo(22.31, 2);
  });

  test("normalizes Henrik stored match history rows", () => {
    const { summaries } = normalizeMatches(
      [
        {
          meta: {
            id: "stored-match-1",
            map: { name: "Pearl" },
            mode: "Competitive",
            started_at: "2026-05-31T12:28:23.510Z",
            season: { id: "season-stored", short: "e11a3" },
          },
          stats: {
            puuid: "target-puuid",
            team: "Blue",
            character: { name: "Yoru" },
            tier: 15,
            score: 2557,
            kills: 10,
            deaths: 2,
            assists: 0,
            shots: { head: 10, body: 11, leg: 1 },
            damage: { made: 1909, received: 472 },
          },
          teams: {
            red: 0,
            blue: 8,
          },
        },
      ],
      "target-puuid",
    );

    expect(summaries[0]).toMatchObject({
      matchId: "stored-match-1",
      mode: "competitive",
      mapName: "Pearl",
      agentName: "Yoru",
      seasonId: "season-stored",
      seasonShort: "e11a3",
      durationMs: null,
      result: "win",
      roundsWon: 8,
      roundsLost: 0,
      kills: 10,
      deaths: 2,
      assists: 0,
      score: 2557,
      tierId: 15,
      tierName: null,
      placement: null,
      headshots: 10,
      bodyshots: 11,
      legshots: 1,
      weapons: [],
      teammates: [],
      opponents: [],
      opponentAgents: [],
      highlights: [],
      partySize: null,
    });
    expect(summaries[0]?.acs).toBeCloseTo(319.63, 2);
    expect(summaries[0]?.adr).toBeCloseTo(238.63, 2);
    expect(summaries[0]?.damageDelta).toBeCloseTo(179.63, 2);
  });

  test("treats equal positive team scores as a draw even when both teams say won false", () => {
    const { summaries } = normalizeMatches(
      [
        {
          metadata: { match_id: "overtime-draw", queue: { id: "competitive" } },
          players: [{ puuid: "target-puuid", team_id: "Blue", stats: { kills: 20, deaths: 20 } }],
          teams: [
            { team_id: "Red", rounds: { won: 15, lost: 15 }, won: false },
            { team_id: "Blue", rounds: { won: 15, lost: 15 }, won: false },
          ],
        },
      ],
      "target-puuid",
    );

    expect(summaries[0]).toMatchObject({ result: "draw", roundsWon: 15, roundsLost: 15 });
  });

  test("derives weapon tags from round loadouts when kill events are absent", () => {
    const { summaries } = normalizeMatches(
      [
        {
          metadata: {
            match_id: "round-weapon-match",
            map: { name: "Ascent" },
            started_at: "2026-06-04T00:00:00Z",
            queue: { id: "competitive", name: "Competitive" },
          },
          players: [
            {
              puuid: "target-puuid",
              team_id: "Blue",
              agent: { name: "Sova" },
              stats: { score: 3_000, kills: 3, deaths: 1 },
            },
            {
              puuid: "enemy-puuid",
              team_id: "Red",
              agent: { name: "Omen" },
              stats: { score: 2_000, kills: 1, deaths: 3 },
            },
          ],
          teams: [
            { team_id: "Blue", rounds: { won: 2, lost: 1 }, won: true },
            { team_id: "Red", rounds: { won: 1, lost: 2 }, won: false },
          ],
          rounds: [
            {
              stats: [
                { player: { puuid: "target-puuid" }, stats: { kills: 2 }, economy: { weapon: { name: "Vandal" } } },
              ],
            },
            {
              stats: [
                { player: { puuid: "target-puuid" }, stats: { kills: 1 }, economy: { weapon: { name: "Vandal" } } },
              ],
            },
            {
              stats: [
                { player: { puuid: "target-puuid" }, stats: { kills: 0 }, economy: { weapon: { name: "Ghost" } } },
              ],
            },
          ],
        },
      ],
      "target-puuid",
    );

    expect(summaries[0]?.weapons).toEqual(["Vandal", "Ghost"]);
  });

  test("derives clutch highlights for match summaries", () => {
    const { summaries } = normalizeMatches(
      [
        {
          metadata: {
            match_id: "clutch-summary-1",
            map: { name: "Lotus" },
            started_at: "2026-06-04T00:00:00Z",
            queue: { id: "competitive", name: "Competitive" },
          },
          players: [
            {
              puuid: "target-puuid",
              team_id: "Blue",
              agent: { name: "Yoru" },
              stats: { score: 3_000, kills: 3, deaths: 0 },
            },
            { puuid: "teammate-puuid", team_id: "Blue", stats: { score: 400, kills: 0, deaths: 1 } },
            { puuid: "enemy-1", team_id: "Red", stats: { score: 800, kills: 1, deaths: 1 } },
            { puuid: "enemy-2", team_id: "Red", stats: { score: 700, kills: 0, deaths: 1 } },
            { puuid: "enemy-3", team_id: "Red", stats: { score: 600, kills: 0, deaths: 1 } },
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
              killer: { puuid: "enemy-1", team: "Red" },
              victim: { puuid: "teammate-puuid", team: "Blue" },
            },
            {
              round: 1,
              time_in_round_in_ms: 20_000,
              killer: { puuid: "target-puuid", team: "Blue" },
              victim: { puuid: "enemy-1", team: "Red" },
              weapon: { name: "Vandal" },
            },
            {
              round: 1,
              time_in_round_in_ms: 25_000,
              killer: { puuid: "target-puuid", team: "Blue" },
              victim: { puuid: "enemy-2", team: "Red" },
              weapon: { name: "Vandal" },
            },
            {
              round: 1,
              time_in_round_in_ms: 30_000,
              killer: { puuid: "target-puuid", team: "Blue" },
              victim: { puuid: "enemy-3", team: "Red" },
              weapon: { name: "Vandal" },
            },
          ],
        },
      ],
      "target-puuid",
    );

    expect(summaries[0]?.highlights).toEqual(["1v3 Clutch", "3k"]);
  });

  test("keeps missing party ids unknown but preserves explicit solo party data", () => {
    const { summaries } = normalizeMatches(
      [
        {
          metadata: { match_id: "unknown-party", queue: { name: "Competitive" } },
          players: [
            { puuid: "target-puuid", team_id: "Blue", stats: { score: 1000 } },
            { puuid: "teammate-puuid", team_id: "Blue", stats: { score: 900 } },
          ],
        },
        {
          metadata: { match_id: "explicit-solo", queue: { name: "Competitive" } },
          players: [
            { puuid: "target-puuid", team_id: "Blue", party_id: "solo-party", stats: { score: 1000 } },
            { puuid: "teammate-puuid", team_id: "Blue", party_id: "other-party", stats: { score: 900 } },
          ],
        },
      ],
      "target-puuid",
    );

    expect(summaries.map((summary) => ({ matchId: summary.matchId, partySize: summary.partySize }))).toEqual([
      { matchId: "unknown-party", partySize: null },
      { matchId: "explicit-solo", partySize: 1 },
    ]);
  });

  test("derives KAST from full round and kill events when Henrik omits it", () => {
    const { summaries } = normalizeMatches(
      [
        {
          metadata: {
            match_id: "kast-match-1",
            map: { name: "Bind" },
            queue: { name: "Competitive" },
          },
          players: [
            {
              puuid: "target-puuid",
              team_id: "Blue",
              agent: { name: "Sova" },
              stats: { score: 1200, kills: 1, deaths: 2, assists: 0 },
            },
            {
              puuid: "trade-puuid",
              team_id: "Blue",
              name: "Trade",
              tag: "EU",
              stats: { score: 900, kills: 1, deaths: 0, assists: 0 },
            },
            {
              puuid: "enemy-puuid",
              team_id: "Red",
              name: "Enemy",
              tag: "EU",
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
      ],
      "target-puuid",
    );

    expect(summaries[0]?.kast).toBeCloseTo(2 / 3, 3);
  });
});
