import type {
  MatchDetail,
  MatchDuelAnalysis,
  MatchDuelMatchup,
  MatchDuelPlayer,
  MatchPlayerDetail,
} from "../domain/types";

export class MatchDuelService {
  analyze(match: MatchDetail): MatchDuelAnalysis | null {
    if (match.teams.length !== 2) {
      return null;
    }
    const [leftSource, rightSource] = match.teams;
    const leftTeam = {
      teamId: leftSource.teamId,
      label: leftSource.label,
      players: orderedPlayers(leftSource.players).map(duelPlayer),
    };
    const rightTeam = {
      teamId: rightSource.teamId,
      label: rightSource.label,
      players: orderedPlayers(rightSource.players).map(duelPlayer),
    };
    const players = [...leftTeam.players, ...rightTeam.players];
    const killCounts = buildKillCounts(match, players);
    const matchups: MatchDuelMatchup[] = [];

    for (const left of leftTeam.players) {
      for (const right of rightTeam.players) {
        const leftKills = directedKills(killCounts, left, right);
        const rightKills = directedKills(killCounts, right, left);
        matchups.push({
          left,
          right,
          leftKills,
          rightKills,
          totalKills: leftKills + rightKills,
          margin: leftKills - rightKills,
        });
      }
    }

    const contested = matchups.filter((matchup) => matchup.totalKills > 0);
    const topRivalry =
      [...contested].sort(
        (a, b) =>
          b.totalKills - a.totalKills ||
          Math.abs(a.margin) - Math.abs(b.margin) ||
          matchupLabel(a).localeCompare(matchupLabel(b)),
      )[0] ?? null;
    const biggestMismatch =
      [...contested].sort(
        (a, b) =>
          Math.abs(b.margin) - Math.abs(a.margin) ||
          b.totalKills - a.totalKills ||
          matchupLabel(a).localeCompare(matchupLabel(b)),
      )[0] ?? null;
    const crossTeamKills = contested.reduce((total, matchup) => total + matchup.totalKills, 0);
    const warnings =
      crossTeamKills < match.killEvents.length
        ? [`${match.killEvents.length - crossTeamKills} kill events could not be placed in the two-team duel matrix.`]
        : [];

    return {
      modelVersion: "match-duels-v1",
      leftTeam,
      rightTeam,
      matchups,
      topRivalry,
      biggestMismatch,
      crossTeamKills,
      warnings,
    };
  }
}

function duelPlayer(player: MatchPlayerDetail): MatchDuelPlayer {
  return {
    puuid: player.puuid,
    gameName: player.gameName,
    tagLine: player.tagLine,
    agentName: player.agentName,
    teamId: player.teamId,
  };
}

function orderedPlayers(players: MatchPlayerDetail[]): MatchPlayerDetail[] {
  return [...players].sort(
    (left, right) =>
      (right.acs ?? -1) - (left.acs ?? -1) ||
      (right.score ?? -1) - (left.score ?? -1) ||
      (right.kills ?? -1) - (left.kills ?? -1) ||
      left.gameName.localeCompare(right.gameName),
  );
}

function directedKills(
  killCounts: Map<string, Map<string, number>>,
  killer: MatchDuelPlayer,
  victim: MatchDuelPlayer,
): number {
  return killCounts.get(playerKey(killer))?.get(playerKey(victim)) ?? 0;
}

function buildKillCounts(match: MatchDetail, players: MatchDuelPlayer[]): Map<string, Map<string, number>> {
  const byPuuid = new Map<string, MatchDuelPlayer>();
  const byNameAll = new Map<string, MatchDuelPlayer[]>();
  const byNameNoPuuid = new Map<string, MatchDuelPlayer[]>();
  for (const player of players) {
    if (player.puuid && !byPuuid.has(player.puuid)) byPuuid.set(player.puuid, player);
    const nameKey = playerNameKey(player.gameName, player.tagLine);
    pushByName(byNameAll, nameKey, player);
    if (!player.puuid) pushByName(byNameNoPuuid, nameKey, player);
  }
  const killCounts = new Map<string, Map<string, number>>();
  for (const event of match.killEvents) {
    const killers = matchingPlayerKeys(
      event.killerPuuid,
      event.killerName,
      event.killerTag,
      byPuuid,
      byNameAll,
      byNameNoPuuid,
    );
    const victims = matchingPlayerKeys(
      event.victimPuuid,
      event.victimName,
      event.victimTag,
      byPuuid,
      byNameAll,
      byNameNoPuuid,
    );
    for (const killer of killers) {
      let victimCounts = killCounts.get(killer);
      if (!victimCounts) {
        victimCounts = new Map<string, number>();
        killCounts.set(killer, victimCounts);
      }
      for (const victim of victims) {
        victimCounts.set(victim, (victimCounts.get(victim) ?? 0) + 1);
      }
    }
  }
  return killCounts;
}

function matchingPlayerKeys(
  puuid: string | null,
  name: string,
  tag: string | null,
  byPuuid: Map<string, MatchDuelPlayer>,
  byNameAll: Map<string, MatchDuelPlayer[]>,
  byNameNoPuuid: Map<string, MatchDuelPlayer[]>,
): string[] {
  const keys: string[] = [];
  if (puuid) {
    const byId = byPuuid.get(puuid);
    if (byId) keys.push(playerKey(byId));
    const noPuuid = byNameNoPuuid.get(playerNameKey(name, tag));
    if (noPuuid) for (const player of noPuuid) keys.push(playerKey(player));
    return keys;
  }
  const all = byNameAll.get(playerNameKey(name, tag));
  if (all) for (const player of all) keys.push(playerKey(player));
  return keys;
}

function pushByName(index: Map<string, MatchDuelPlayer[]>, key: string, player: MatchDuelPlayer): void {
  const players = index.get(key);
  if (players) players.push(player);
  else index.set(key, [player]);
}

function playerKey(player: MatchDuelPlayer): string {
  return player.puuid ? `puuid:${player.puuid}` : `name:${playerNameKey(player.gameName, player.tagLine)}`;
}

function playerNameKey(gameName: string, tagLine: string | null): string {
  return `${gameName}#${tagLine ?? ""}`;
}

function matchupLabel(matchup: MatchDuelMatchup): string {
  return `${matchup.left.gameName}#${matchup.left.tagLine ?? ""}|${matchup.right.gameName}#${matchup.right.tagLine ?? ""}`;
}
