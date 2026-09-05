import { killRoundOffset } from "./match-kill-round";
import type {
  MatchDetail,
  MatchKillEvent,
  MatchPerformanceAnalysis,
  MatchPlayerDetail,
  MatchRoundPlayerStat,
} from "../domain/types";
import { inferInitialAttackerTeam, sideForRound } from "./match-side";

export class MatchPerformanceService {
  analyze(match: MatchDetail, focusPuuid: string | null): MatchPerformanceAnalysis | null {
    if (!focusPuuid) {
      return null;
    }

    const players = match.teams.flatMap((team) => team.players);
    const focus = players.find((player) => player.puuid === focusPuuid);
    if (!focus) {
      return null;
    }

    const eventRoundOffset = killRoundOffset(match);
    const initialAttackerTeam = inferInitialAttackerTeam(match);
    const eventsByRound = groupKillEventsByRound(match, eventRoundOffset);
    const rounds = match.rounds.map((round) => {
      const events = eventsByRound.get(round.number) ?? [];
      return {
        roundNumber: round.number,
        side: sideForRound(match, focus.teamId, round.number, initialAttackerTeam),
        kills: countEvents(events, (event) => event.killerPuuid === focusPuuid),
        deaths: countEvents(events, (event) => event.victimPuuid === focusPuuid),
        assists: countEvents(events, (event) => event.assistantPuuids.includes(focusPuuid)),
      };
    });

    const sideSplits = (["attack", "defense"] as const).flatMap((side) => {
      const rows = rounds.filter((round) => round.side === side);
      if (!rows.length) {
        return [];
      }
      const kills = sum(rows.map((round) => round.kills));
      const deaths = sum(rows.map((round) => round.deaths));
      return [
        {
          side,
          rounds: rows.length,
          kills,
          deaths,
          assists: sum(rows.map((round) => round.assists)),
          kd: deaths > 0 ? kills / deaths : kills > 0 ? kills : null,
        },
      ];
    });

    const opponents = buildOpponentRows(match, focus, players);
    const weaponKills = new Map<string, { kills: number; distances: number[] }>();
    for (const event of match.killEvents) {
      if (event.killerPuuid !== focusPuuid || !event.weaponName) {
        continue;
      }
      const weapon = weaponKills.get(event.weaponName) ?? { kills: 0, distances: [] };
      weapon.kills += 1;
      if (event.distanceMeters !== null) weapon.distances.push(event.distanceMeters);
      weaponKills.set(event.weaponName, weapon);
    }
    const weapons = Array.from(weaponKills.entries())
      .map(([weaponName, value]) => ({
        weaponName,
        kills: value.kills,
        averageKillDistanceMeters: value.distances.length ? sum(value.distances) / value.distances.length : null,
        killsWithDistance: value.distances.length,
      }))
      .sort((left, right) => right.kills - left.kills || left.weaponName.localeCompare(right.weaponName));
    const impact = buildImpact(match, focus, eventsByRound);

    const warnings: string[] = [];
    if (!initialAttackerTeam) {
      warnings.push(
        "Attack and defense splits are unavailable because the round timeline has no reliable side anchor.",
      );
    }
    if (!match.rounds.some((round) => round.playerStats.some((stat) => stat.damageEvents.length > 0))) {
      warnings.push("Opponent damage totals are unavailable in this cached match payload.");
    }
    if (!match.killEvents.length) {
      warnings.push("Round combat and weapon breakdowns are unavailable without kill events.");
    }

    return {
      modelVersion: "match-performance-v1",
      focusPuuid,
      rounds,
      sideSplits,
      opponents,
      weapons,
      impact,
      topRivalPuuid: opponents[0]?.puuid ?? null,
      warnings,
    };
  }
}

function buildImpact(
  match: MatchDetail,
  focus: MatchPlayerDetail,
  eventsByRound: Map<number, MatchKillEvent[]>,
): MatchPerformanceAnalysis["impact"] {
  const hasCombatEvidence = match.killEvents.length > 0 && match.rounds.length > 0;
  let firstKills = 0;
  let firstDeaths = 0;
  let roundsWonAfterFirstKill = 0;
  let roundsLostAfterFirstDeath = 0;
  let lastDeaths = 0;
  let tradeKills = 0;

  for (const round of match.rounds) {
    const events = sortRoundEvents(eventsByRound.get(round.number) ?? []);
    const combatEvents = events.filter((event) => event.killerPuuid || event.victimPuuid);
    const first = combatEvents[0];
    let last: MatchKillEvent | undefined;
    for (let index = combatEvents.length - 1; index >= 0; index -= 1) {
      const event = combatEvents[index]!;
      if (event.victimPuuid) {
        last = event;
        break;
      }
    }
    const focusWonRound =
      round.winningTeam !== null && normalizedTeamKey(round.winningTeam) === normalizedTeamKey(focus.teamId);

    if (first?.killerPuuid === focus.puuid) {
      firstKills += 1;
      if (focusWonRound) roundsWonAfterFirstKill += 1;
    }
    if (first?.victimPuuid === focus.puuid) {
      firstDeaths += 1;
      if (round.winningTeam !== null && !focusWonRound) roundsLostAfterFirstDeath += 1;
    }
    if (last?.victimPuuid === focus.puuid) lastDeaths += 1;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]!;
      if (event.killerPuuid !== focus.puuid || !event.victimPuuid || event.timeInRoundMs === null) continue;
      for (let earlierIndex = index - 1; earlierIndex >= 0; earlierIndex -= 1) {
        const earlier = events[earlierIndex]!;
        if (earlier.timeInRoundMs !== null && event.timeInRoundMs - earlier.timeInRoundMs > 5_000) break;
        if (
          earlier.killerPuuid === event.victimPuuid &&
          normalizedTeamKey(earlier.victimTeam ?? "") === normalizedTeamKey(focus.teamId) &&
          earlier.timeInRoundMs !== null &&
          event.timeInRoundMs - earlier.timeInRoundMs >= 0 &&
          event.timeInRoundMs - earlier.timeInRoundMs <= 5_000
        ) {
          tradeKills += 1;
          break;
        }
      }
    }
  }

  const plants = match.rounds.length
    ? match.rounds.filter((round) => spikeActorIsFocus(round.spikePlant, focus)).length
    : null;
  const defuses = match.rounds.length
    ? match.rounds.filter((round) => spikeActorIsFocus(round.spikeDefuse, focus)).length
    : null;
  const focusKills =
    focus.kills ??
    (hasCombatEvidence ? match.killEvents.filter((event) => event.killerPuuid === focus.puuid).length : null);
  const durationMinutes = match.durationMs !== null && match.durationMs > 0 ? match.durationMs / 60_000 : null;

  return {
    firstKills: hasCombatEvidence ? firstKills : null,
    firstDeaths: hasCombatEvidence ? firstDeaths : null,
    roundsWonAfterFirstKill: hasCombatEvidence ? roundsWonAfterFirstKill : null,
    roundsLostAfterFirstDeath: hasCombatEvidence ? roundsLostAfterFirstDeath : null,
    firstKillConversionRate: hasCombatEvidence && firstKills > 0 ? roundsWonAfterFirstKill / firstKills : null,
    firstDeathPunishRate: hasCombatEvidence && firstDeaths > 0 ? roundsLostAfterFirstDeath / firstDeaths : null,
    lastDeaths: hasCombatEvidence ? lastDeaths : null,
    tradeKills: hasCombatEvidence ? tradeKills : null,
    tradesPerRound: hasCombatEvidence && match.rounds.length ? tradeKills / match.rounds.length : null,
    plants,
    defuses,
    killsPerMinute: durationMinutes && focusKills !== null ? focusKills / durationMinutes : null,
  };
}

function spikeActorIsFocus(event: MatchDetail["rounds"][number]["spikePlant"], focus: MatchPlayerDetail): boolean {
  if (!event?.playerName) return false;
  return (
    event.playerName === focus.gameName && (!event.playerTag || !focus.tagLine || event.playerTag === focus.tagLine)
  );
}

function buildOpponentRows(
  match: MatchDetail,
  focus: MatchPlayerDetail,
  players: MatchPlayerDetail[],
): MatchPerformanceAnalysis["opponents"] {
  const opponents = players.filter((player) => player.teamId.toLowerCase() !== focus.teamId.toLowerCase());
  const byPuuid = new Map<string, MatchPlayerDetail>();
  const byNameAll = new Map<string, MatchPlayerDetail[]>();
  const byNameNoPuuid = new Map<string, MatchPlayerDetail[]>();
  for (const player of players) {
    if (player.puuid && !byPuuid.has(player.puuid)) byPuuid.set(player.puuid, player);
    const nameKey = playerNameKey(player.gameName, player.tagLine);
    pushByKey(byNameAll, nameKey, player);
    if (!player.puuid) pushByKey(byNameNoPuuid, nameKey, player);
  }
  const focusKeys = new Set(
    matchingPlayerKeys(focus.puuid, focus.gameName, focus.tagLine, byPuuid, byNameAll, byNameNoPuuid),
  );
  const damageDealt = new Map<string, number>();
  const damageReceived = new Map<string, number>();
  for (const round of match.rounds) {
    const statsByPuuid = new Map<string | null, MatchRoundPlayerStat>();
    for (const stat of round.playerStats) {
      if (!statsByPuuid.has(stat.puuid)) statsByPuuid.set(stat.puuid, stat);
    }
    const focusStats = statsByPuuid.get(focus.puuid);
    if (focusStats) {
      for (const damageEvent of focusStats.damageEvents) {
        const keys = matchingPlayerKeys(
          damageEvent.targetPuuid,
          damageEvent.targetName,
          damageEvent.targetTag,
          byPuuid,
          byNameAll,
          byNameNoPuuid,
        );
        for (const key of keys) {
          damageDealt.set(key, (damageDealt.get(key) ?? 0) + damageEvent.damage);
        }
      }
    }
    for (const stat of statsByPuuid.values()) {
      const sourceKeys = sourceKeysFor(stat, byNameNoPuuid);
      for (const damageEvent of stat.damageEvents) {
        const targetKeys = matchingPlayerKeys(
          damageEvent.targetPuuid,
          damageEvent.targetName,
          damageEvent.targetTag,
          byPuuid,
          byNameAll,
          byNameNoPuuid,
        );
        if (!targetKeys.some((key) => focusKeys.has(key))) continue;
        for (const sourceKey of sourceKeys) {
          damageReceived.set(sourceKey, (damageReceived.get(sourceKey) ?? 0) + damageEvent.damage);
        }
      }
    }
  }
  const killsByVictim = new Map<string | null, number>();
  const deathsByKiller = new Map<string | null, number>();
  for (const event of match.killEvents) {
    if (event.killerPuuid === focus.puuid) {
      killsByVictim.set(event.victimPuuid, (killsByVictim.get(event.victimPuuid) ?? 0) + 1);
    }
    if (event.victimPuuid === focus.puuid) {
      deathsByKiller.set(event.killerPuuid, (deathsByKiller.get(event.killerPuuid) ?? 0) + 1);
    }
  }

  return opponents
    .map((opponent) => ({
      puuid: opponent.puuid,
      gameName: opponent.gameName,
      tagLine: opponent.tagLine,
      agentName: opponent.agentName,
      kills: killsByVictim.get(opponent.puuid) ?? 0,
      deaths: deathsByKiller.get(opponent.puuid) ?? 0,
      damageDealt: damageDealt.get(playerKey(opponent)) ?? 0,
      damageReceived: damageReceived.get(playerKey(opponent)) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.kills - left.kills ||
        right.deaths - left.deaths ||
        right.damageDealt - left.damageDealt ||
        left.gameName.localeCompare(right.gameName),
    );
}

function matchingPlayerKeys(
  puuid: string | null,
  name: string,
  tag: string | null,
  byPuuid: Map<string, MatchPlayerDetail>,
  byNameAll: Map<string, MatchPlayerDetail[]>,
  byNameNoPuuid: Map<string, MatchPlayerDetail[]>,
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

function sourceKeysFor(stat: MatchRoundPlayerStat, byNameNoPuuid: Map<string, MatchPlayerDetail[]>): string[] {
  if (stat.puuid) return [`puuid:${stat.puuid}`];
  const keys: string[] = [];
  for (const players of byNameNoPuuid.values()) {
    for (const player of players) keys.push(playerKey(player));
  }
  return keys;
}

function pushByKey(index: Map<string, MatchPlayerDetail[]>, key: string, player: MatchPlayerDetail): void {
  const players = index.get(key);
  if (players) players.push(player);
  else index.set(key, [player]);
}

function playerKey(player: MatchPlayerDetail): string {
  return player.puuid ? `puuid:${player.puuid}` : `name:${playerNameKey(player.gameName, player.tagLine)}`;
}

function playerNameKey(gameName: string, tagLine: string | null): string {
  return `${gameName}#${tagLine ?? ""}`;
}

function groupKillEventsByRound(match: MatchDetail, eventRoundOffset: number): Map<number, MatchKillEvent[]> {
  const groups = new Map<number, MatchKillEvent[]>();
  for (const event of match.killEvents) {
    if (event.round === null) continue;
    const roundNumber = event.round + eventRoundOffset;
    const events = groups.get(roundNumber);
    if (events) events.push(event);
    else groups.set(roundNumber, [event]);
  }
  return groups;
}

function sortRoundEvents(events: MatchKillEvent[]): MatchKillEvent[] {
  return [...events].sort(
    (left, right) => (left.timeInRoundMs ?? Number.MAX_SAFE_INTEGER) - (right.timeInRoundMs ?? Number.MAX_SAFE_INTEGER),
  );
}

function countEvents(events: MatchKillEvent[], predicate: (event: MatchKillEvent) => boolean): number {
  let count = 0;
  for (const event of events) {
    if (predicate(event)) count += 1;
  }
  return count;
}

function normalizedTeamKey(value: string): string {
  return value.trim().toLowerCase();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
