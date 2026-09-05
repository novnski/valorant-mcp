import type { MatchDetail, MatchEconomyAnalysis, MatchRoundPlayerStat } from "../domain/types";

const partialEconomyWarning =
  "Team economy averages exclude rounds without complete bank and loadout evidence for every player.";

export class MatchEconomyService {
  analyze(match: MatchDetail): MatchEconomyAnalysis | null {
    if (!match.teams.length || !match.rounds.length) {
      return null;
    }

    const teams = match.teams.map((team) => {
      const expectedPlayers = team.players.length;
      const rounds = match.rounds.map((round) => {
        const players = round.playerStats.filter((player) => sameTeam(player.teamId, team.teamId));
        const bankValues = known(players.map((player) => player.remainingCredits));
        const loadoutValues = known(players.map((player) => player.loadoutValue));
        const playerSamples = players.filter(hasEconomyEvidence).length;
        const complete =
          expectedPlayers > 0 &&
          players.length === expectedPlayers &&
          bankValues.length === expectedPlayers &&
          loadoutValues.length === expectedPlayers;
        const bank = bankValues.length ? sum(bankValues) : null;
        const loadout = loadoutValues.length ? sum(loadoutValues) : null;

        return {
          roundNumber: round.number,
          bank,
          loadout,
          total: bank !== null && loadout !== null ? bank + loadout : null,
          playerSamples,
          expectedPlayers,
          complete,
        };
      });
      const completeRounds = rounds.filter((round) => round.complete);

      return {
        teamId: team.teamId,
        label: team.label,
        averageBank: average(completeRounds.map((round) => round.bank)),
        averageLoadout: average(completeRounds.map((round) => round.loadout)),
        averageTotal: average(completeRounds.map((round) => round.total)),
        roundsWithData: rounds.filter((round) => round.playerSamples > 0).length,
        completeRounds: completeRounds.length,
        expectedRounds: match.rounds.length,
        rounds,
      };
    });

    const warnings = teams.some((team) => team.completeRounds < team.expectedRounds) ? [partialEconomyWarning] : [];
    return { modelVersion: "match-economy-v1", teams, warnings };
  }
}

function hasEconomyEvidence(player: MatchRoundPlayerStat): boolean {
  return player.remainingCredits !== null || player.loadoutValue !== null;
}

function sameTeam(left: string | null, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function known(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: Array<number | null>): number | null {
  const complete = known(values);
  return complete.length ? sum(complete) / complete.length : null;
}
