import { providerMatch } from "./provider";

/** Synthetic ten-player fixture with a complete ledger; kept separate from the tiny answer fixture. */
export function completeProviderMatch(matchId: string, roundCount = 1): Record<string, any> {
  const base = providerMatch(matchId) as Record<string, any>;
  const players = [...base.players];
  for (let i = 2; i < 10; i++)
    players.push({
      ...structuredClone(base.players[i % 2]),
      puuid: `player-${i}`,
      name: `Player${i}`,
      stats: { ...base.players[0].stats, kills: 0, deaths: 0, assists: 0 },
    });
  players[0].stats.deaths = roundCount;
  players[1].stats.kills = roundCount;
  const rounds = Array.from({ length: roundCount }, (_, i) => ({
    ...structuredClone(base.rounds[0]),
    round: i + 1,
    winning_team: i < Math.ceil(roundCount / 2) ? "Red" : "Blue",
    stats: players.map((p, j) => ({
      ...structuredClone(base.rounds[0].stats[j % 2]),
      player: { puuid: p.puuid, name: p.name, tag: p.tag, team: p.team_id },
      stats: { score: j === 1 ? 300 : 0, kills: j === 1 ? 1 : 0 },
    })),
  }));
  const kills = Array.from({ length: roundCount }, (_, i) => ({ ...structuredClone(base.kills[0]), round: i }));
  const red = Math.ceil(roundCount / 2);
  return {
    ...base,
    players,
    rounds,
    kills,
    teams: [
      { team_id: "Blue", rounds: { won: roundCount - red, lost: red }, won: false },
      { team_id: "Red", rounds: { won: red, lost: roundCount - red }, won: true },
    ],
  };
}
