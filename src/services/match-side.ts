import type { MatchDetail } from "../domain/types";

export type MatchSideRoundSummary = {
  attackRounds: number;
  attackRoundsWon: number;
  defenseRounds: number;
  defenseRoundsWon: number;
};

export function summarizeMatchSideRounds(match: MatchDetail, focusPuuid: string): MatchSideRoundSummary | null {
  const focus = match.teams.flatMap((team) => team.players).find((player) => player.puuid === focusPuuid);
  if (!focus) {
    return null;
  }

  const initialAttackerTeam = inferInitialAttackerTeam(match);
  if (!initialAttackerTeam) {
    return null;
  }

  const summary: MatchSideRoundSummary = {
    attackRounds: 0,
    attackRoundsWon: 0,
    defenseRounds: 0,
    defenseRoundsWon: 0,
  };

  for (const round of match.rounds) {
    if (!round.winningTeam) {
      continue;
    }
    const side = sideForRound(match, focus.teamId, round.number, initialAttackerTeam);
    if (!side) {
      continue;
    }
    const won = sameTeam(round.winningTeam, focus.teamId);
    if (side === "attack") {
      summary.attackRounds += 1;
      summary.attackRoundsWon += won ? 1 : 0;
    } else {
      summary.defenseRounds += 1;
      summary.defenseRoundsWon += won ? 1 : 0;
    }
  }

  return summary.attackRounds + summary.defenseRounds > 0 ? summary : null;
}

export function inferInitialAttackerTeam(match: MatchDetail): string | null {
  const firstHalf = match.rounds.filter((round) => round.number <= 12);
  const plantedBy = firstHalf.find((round) => round.spikePlant?.teamId)?.spikePlant?.teamId;
  if (plantedBy) {
    return plantedBy;
  }

  for (const round of firstHalf) {
    const result = round.result?.toLowerCase() ?? "";
    if (result.includes("detonate") && round.winningTeam) {
      return round.winningTeam;
    }
    if (result.includes("defuse") && round.winningTeam) {
      return match.teams.find((team) => !sameTeam(team.teamId, round.winningTeam!))?.teamId ?? null;
    }
  }
  return null;
}

export function sideForRound(
  match: MatchDetail,
  teamId: string,
  roundNumber: number,
  initialAttackerTeam: string | null,
): "attack" | "defense" | null {
  if (!initialAttackerTeam) {
    return null;
  }
  const otherTeam = match.teams.find((team) => !sameTeam(team.teamId, initialAttackerTeam))?.teamId;
  if (!otherTeam) {
    return null;
  }

  const attacker =
    roundNumber <= 12
      ? initialAttackerTeam
      : roundNumber <= 24
        ? otherTeam
        : (roundNumber - 25) % 2 === 0
          ? initialAttackerTeam
          : otherTeam;
  return sameTeam(attacker, teamId) ? "attack" : "defense";
}

function sameTeam(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
