import type { MatchDetail, MatchPlayerDetail } from "../domain/types";
import type { MatchCacheProvenance } from "../cache/match-cache";
import { findAgentKnowledge } from "./game-knowledge";

type Selection = { detail: MatchDetail; participant: MatchPlayerDetail; cache: MatchCacheProvenance };

/** Descriptive selected samples only: no history discovery, inference, or skill grading. */
export function compareSelectedMatches(selected: Selection[]) {
  const matches = selected
    .map(({ detail, participant: player, cache }) => {
      const team = detail.teams.find((row) => row.teamId === player.teamId);
      const rounds = team?.roundsWon != null && team.roundsLost != null ? team.roundsWon + team.roundsLost : null;
      const scoreboard = detail.evidence?.scoreboard.state === "complete";
      const role = player.agentName ? (findAgentKnowledge(player.agentName)?.role ?? null) : null;
      return {
        matchId: detail.matchId,
        startedAt: detail.startedAt,
        map: detail.mapName,
        mode: detail.mode,
        patch: detail.patch,
        agent: player.agentName,
        role,
        roleKnowledge: "current-bundled-role",
        rounds,
        result: team?.won === true ? "win" : team?.won === false ? "loss" : "unknown",
        metrics: {
          kills: scoreboard ? player.kills : null,
          deaths: scoreboard ? player.deaths : null,
          assists: scoreboard ? player.assists : null,
          acs: scoreboard ? player.acs : null,
          adr: scoreboard ? player.adr : null,
          killsPerRound: scoreboard && rounds && player.kills !== null ? round(player.kills / rounds) : null,
          deathsPerRound: scoreboard && rounds && player.deaths !== null ? round(player.deaths / rounds) : null,
        },
        evidence: detail.evidence ?? null,
        cache,
      };
    })
    .sort((a, b) => (Date.parse(a.startedAt ?? "") || 0) - (Date.parse(b.startedAt ?? "") || 0));
  const groups = new Map<string, typeof matches>();
  for (const match of matches) {
    const key = JSON.stringify([match.map, match.mode, match.patch, match.role]);
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }
  const comparableGroups = [...groups.values()].map((rows) => ({
    context: { map: rows[0]!.map, mode: rows[0]!.mode, patch: rows[0]!.patch, role: rows[0]!.role },
    matchIds: rows.map((row) => row.matchId),
    sampleSize: rows.length,
    metrics: Object.fromEntries(
      (["acs", "adr", "killsPerRound", "deathsPerRound"] as const).map((metric) => {
        const values = rows.map((row) => row.metrics[metric]).filter((n): n is number => n !== null);
        return [
          metric,
          {
            mean: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
            observedMatches: values.length,
            expectedMatches: rows.length,
          },
        ];
      }),
    ),
  }));
  return {
    version: "selected-comparison-v1",
    player: {
      puuid: selected[0]!.participant.puuid,
      riotId: `${selected[0]!.participant.gameName}#${selected[0]!.participant.tagLine ?? ""}`,
    },
    sample: {
      selectedMatches: matches.length,
      completeScoreboards: matches.filter((row) => row.evidence?.scoreboard.state === "complete").length,
      population: "explicitly-selected-matches",
      selectionBias: "unknown",
    },
    matches,
    comparableGroups,
    limitations: [
      "This small, selected sample does not establish improvement, decline, causation, or overall skill.",
      "Means weight each observed match equally; missing fields are excluded and their coverage is counted.",
      "Context groups separate map, mode, patch, and current bundled agent role. Unknown context remains unknown; it does not establish comparability.",
      "Kills per round in respawn modes have different meaning from standard rounds. Do not compare across modes.",
      "Only scoreboard metrics are compared; missing combat ledgers do not support tactical conclusions. No additional matches were discovered.",
    ],
  };
}
function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
