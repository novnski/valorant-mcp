import { killRoundOffset } from "./match-kill-round";
import type {
  MatchDetail,
  MatchKillEvent,
  MatchPlayerDetail,
  MatchRoundEvidenceAnalysis,
  MatchRoundPlayerStat,
} from "../domain/types";

export class MatchRoundEvidenceService {
  analyze(match: MatchDetail): MatchRoundEvidenceAnalysis | null {
    if (!match.rounds.length) return null;
    const eventOffset = killRoundOffset(match);
    const rosterIndex = buildRosterIndex(match);
    const rounds = match.rounds.map((round) => {
      const kills = match.killEvents
        .filter((event) => event.round !== null && event.round + eventOffset === round.number)
        .sort(
          (left, right) =>
            (left.timeInRoundMs ?? Number.MAX_SAFE_INTEGER) - (right.timeInRoundMs ?? Number.MAX_SAFE_INTEGER),
        );
      const events: MatchRoundEvidenceAnalysis["rounds"][number]["events"] = kills.map((event, index) =>
        killEvent(round.number, index, event),
      );
      if (round.spikePlant) {
        events.push({
          id: `r${round.number}-plant`,
          kind: "plant",
          timeInRoundMs: round.spikePlant.timeInRoundMs,
          actor: {
            puuid: null,
            gameName: round.spikePlant.playerName ?? "Unknown",
            tagLine: round.spikePlant.playerTag,
            teamId: round.spikePlant.teamId,
          },
          target: null,
          weaponName: null,
          assistants: [],
          distanceMeters: null,
          targetLocation: null,
          playerLocations: [],
          site: round.spikePlant.site,
        });
      }
      if (round.spikeDefuse) {
        events.push({
          id: `r${round.number}-defuse`,
          kind: "defuse",
          timeInRoundMs: round.spikeDefuse.timeInRoundMs,
          actor: {
            puuid: null,
            gameName: round.spikeDefuse.playerName ?? "Unknown",
            tagLine: round.spikeDefuse.playerTag,
            teamId: round.spikeDefuse.teamId,
          },
          target: null,
          weaponName: null,
          assistants: [],
          distanceMeters: null,
          targetLocation: null,
          playerLocations: [],
          site: round.spikeDefuse.site,
        });
      }
      events.sort(
        (left, right) =>
          (left.timeInRoundMs ?? Number.MAX_SAFE_INTEGER) - (right.timeInRoundMs ?? Number.MAX_SAFE_INTEGER),
      );

      return {
        roundNumber: round.number,
        winningTeam: round.winningTeam,
        result: round.result,
        players: round.playerStats.map((player) => roundPlayer(rosterIndex, player, kills)),
        events,
      };
    });
    const killsWithDistance = match.killEvents.filter((event) => event.distanceMeters !== null).length;
    const killsWithPlayerLocations = match.killEvents.filter((event) => event.playerLocations.length > 0).length;
    const warnings: string[] = [];
    if (killsWithDistance < match.killEvents.length)
      warnings.push("Some kill distances are unavailable because killer or victim coordinates are missing.");
    if (killsWithPlayerLocations < match.killEvents.length)
      warnings.push("Some kill snapshots are unavailable because player locations are missing.");
    return {
      modelVersion: "match-round-evidence-v1",
      rounds,
      evidence: {
        rounds: rounds.length,
        killEvents: match.killEvents.length,
        killsWithDistance,
        killsWithPlayerLocations,
      },
      warnings,
    };
  }
}

function killEvent(
  roundNumber: number,
  index: number,
  event: MatchKillEvent,
): MatchRoundEvidenceAnalysis["rounds"][number]["events"][number] {
  return {
    id: `r${roundNumber}-kill-${index}`,
    kind: "kill",
    timeInRoundMs: event.timeInRoundMs,
    actor: { puuid: event.killerPuuid, gameName: event.killerName, tagLine: event.killerTag, teamId: event.killerTeam },
    target: {
      puuid: event.victimPuuid,
      gameName: event.victimName,
      tagLine: event.victimTag,
      teamId: event.victimTeam,
    },
    weaponName: event.weaponName,
    assistants: event.assistants,
    distanceMeters: event.distanceMeters,
    targetLocation: event.victimLocation,
    playerLocations: event.playerLocations,
    site: null,
  };
}

function roundPlayer(
  rosterIndex: RosterIndex,
  player: MatchRoundPlayerStat,
  kills: MatchKillEvent[],
): MatchRoundEvidenceAnalysis["rounds"][number]["players"][number] {
  const matchPlayer = resolveRosterPlayer(rosterIndex, player.puuid, player.gameName, player.tagLine);
  return {
    puuid: player.puuid,
    gameName: player.gameName,
    tagLine: player.tagLine,
    teamId: player.teamId,
    agentName: matchPlayer?.agentName ?? null,
    score: player.score,
    kills:
      player.kills ??
      kills.filter((event) =>
        samePlayer(event.killerPuuid, event.killerName, event.killerTag, player.puuid, player.gameName, player.tagLine),
      ).length,
    deaths: kills.filter((event) =>
      samePlayer(event.victimPuuid, event.victimName, event.victimTag, player.puuid, player.gameName, player.tagLine),
    ).length,
    assists: kills.filter(
      (event) =>
        event.assistantPuuids.includes(player.puuid ?? "") ||
        (!player.puuid && event.assistants.includes(player.gameName)),
    ).length,
    loadoutValue: player.loadoutValue,
    remainingCredits: player.remainingCredits,
    weaponName: player.weaponName,
    armorName: player.armorName,
  };
}

type RosterIndex = {
  byPuuid: Map<string, MatchPlayerDetail>;
  byNameAll: Map<string, MatchPlayerDetail[]>;
  byNameNoPuuid: Map<string, MatchPlayerDetail[]>;
};

function buildRosterIndex(match: MatchDetail): RosterIndex {
  const byPuuid = new Map<string, MatchPlayerDetail>();
  const byNameAll = new Map<string, MatchPlayerDetail[]>();
  const byNameNoPuuid = new Map<string, MatchPlayerDetail[]>();
  for (const team of match.teams) {
    for (const player of team.players) {
      if (player.puuid && !byPuuid.has(player.puuid)) byPuuid.set(player.puuid, player);
      const nameKey = playerNameKey(player.gameName, player.tagLine);
      pushByName(byNameAll, nameKey, player);
      if (!player.puuid) pushByName(byNameNoPuuid, nameKey, player);
    }
  }
  return { byPuuid, byNameAll, byNameNoPuuid };
}

function resolveRosterPlayer(
  index: RosterIndex,
  puuid: string | null,
  gameName: string,
  tagLine: string | null,
): MatchPlayerDetail | null {
  const nameKey = playerNameKey(gameName, tagLine);
  if (puuid) {
    return index.byPuuid.get(puuid) ?? index.byNameNoPuuid.get(nameKey)?.[0] ?? null;
  }
  return index.byNameAll.get(nameKey)?.[0] ?? null;
}

function pushByName(index: Map<string, MatchPlayerDetail[]>, key: string, player: MatchPlayerDetail): void {
  const players = index.get(key);
  if (players) players.push(player);
  else index.set(key, [player]);
}

function playerNameKey(gameName: string, tagLine: string | null): string {
  return `${gameName}#${tagLine ?? ""}`;
}

function samePlayer(
  leftPuuid: string | null,
  leftName: string,
  leftTag: string | null,
  rightPuuid: string | null,
  rightName: string,
  rightTag: string | null,
): boolean {
  if (leftPuuid && rightPuuid) return leftPuuid === rightPuuid;
  return leftName === rightName && leftTag === rightTag;
}
