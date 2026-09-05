// Synthetic Henrik-shaped data. No real player identities or credentials.
export function providerMatch(matchId: string): unknown {
  return {
    metadata: {
      match_id: matchId,
      map: { name: "Haven" },
      queue: { id: "competitive", name: "Competitive" },
      started_at: "2026-08-30T01:00:00.000Z",
      game_version: "release-13.02-shipping-test",
    },
    players: [
      {
        puuid: "focus-puuid",
        name: "Focus",
        tag: "EU",
        team_id: "Blue",
        agent: { name: "Sova" },
        stats: {
          score: 100,
          kills: 0,
          deaths: 1,
          assists: 0,
          damage: { dealt: 40, received: 150 },
          headshots: 0,
          bodyshots: 1,
          legshots: 0,
        },
      },
      {
        puuid: "enemy-puuid",
        name: "Enemy",
        tag: "EU",
        team_id: "Red",
        agent: { name: "Omen" },
        stats: {
          score: 300,
          kills: 1,
          deaths: 0,
          assists: 0,
          damage: { dealt: 150, received: 40 },
          headshots: 1,
          bodyshots: 0,
          legshots: 0,
        },
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
            stats: { score: 100, kills: 0 },
            economy: {
              loadout_value: 3_900,
              remaining: 100,
              weapon: { name: "Vandal" },
              armor: { name: "Heavy Shields" },
            },
            ability_casts: {},
          },
          {
            player: { puuid: "enemy-puuid", name: "Enemy", tag: "EU", team: "Red" },
            stats: { score: 300, kills: 1 },
            economy: {
              loadout_value: 4_200,
              remaining: 300,
              weapon: { name: "Vandal" },
              armor: { name: "Heavy Shields" },
            },
            ability_casts: {},
          },
        ],
      },
    ],
    kills: [
      {
        round: 0,
        time_in_round_in_ms: 18_000,
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
