import { killRoundNumber } from "./match-kill-round";
import type {
  MatchAnalysis,
  MatchDetail,
  MatchKillEvent,
  MatchPlayerDetail,
  MatchRecommendation,
  MatchRoundDetail,
  MatchTurningPoint,
} from "../domain/types";

const missingRoundEvidence = "Round-by-round evidence is unavailable; no turning-point claims were inferred.";
const missingKillEvidence = "Kill-event evidence is unavailable; opening, multikill, and clutch claims were omitted.";
const missingEconomyEvidence = "Complete round economy evidence is unavailable; economy-upset claims may be omitted.";
const unsupportedModeEvidence = "Turning-point analysis is unavailable for non-round-based modes.";

export class RoundAnalysisService {
  analyze(match: MatchDetail, focusPuuid: string | null): MatchAnalysis {
    if (!supportsRoundAnalysis(match.mode)) {
      return {
        modelVersion: "round-analysis-v1",
        focusPuuid,
        turningPoints: [],
        recommendation: null,
        evidence: { rounds: match.rounds.length, killEvents: match.killEvents.length, economyRounds: 0 },
        warnings: [unsupportedModeEvidence],
      };
    }
    const warnings: string[] = [];
    if (!match.rounds.length) warnings.push(missingRoundEvidence);
    if (!match.killEvents.length) warnings.push(missingKillEvidence);

    const economyRounds = match.rounds.filter(hasComparableEconomy).length;
    if (economyRounds < match.rounds.length) warnings.push(missingEconomyEvidence);

    const combatComplete = !match.evidence || match.evidence.kills.state === "complete";
    if (!combatComplete) warnings.push(...match.warnings);
    const context = buildMatchContext(match);
    const candidates = [
      ...(combatComplete ? clutchTurningPoints(match, focusPuuid, context) : []),
      ...(combatComplete ? multikillTurningPoints(match, focusPuuid, context) : []),
      ...spikeTurningPoints(match, focusPuuid, context),
      ...economyTurningPoints(match, focusPuuid, context),
      ...(combatComplete ? openingTurningPoints(match, focusPuuid, context) : []),
    ];

    const strongestByRound = new Map<number, MatchTurningPoint>();
    for (const point of candidates) {
      const current = strongestByRound.get(point.roundNumber);
      if (!current || compareTurningPoints(point, current) < 0) {
        strongestByRound.set(point.roundNumber, point);
      }
    }

    const turningPoints = Array.from(strongestByRound.values()).sort(compareTurningPoints);
    return {
      modelVersion: "round-analysis-v1",
      focusPuuid,
      turningPoints,
      recommendation: combatComplete ? matchRecommendation(match, focusPuuid, turningPoints, context) : null,
      evidence: {
        rounds: match.rounds.length,
        killEvents: match.killEvents.length,
        economyRounds,
      },
      warnings,
    };
  }
}

function matchRecommendation(
  match: MatchDetail,
  focusPuuid: string | null,
  turningPoints: MatchTurningPoint[],
  context: MatchContext,
): MatchRecommendation | null {
  if (!focusPuuid) return null;
  const player = context.playerByPuuid.get(focusPuuid);
  if (!player) return null;

  const missing = missingRecommendationInputs(player);
  if (missing.length >= 3) {
    return {
      kind: "data-quality",
      title: "Hydrate match detail",
      observedFacts: [`Unavailable fields: ${missing.join(", ")}`],
      inference: "Reload after detail hydration before drawing a coaching conclusion from this match.",
      confidence: "high",
      evidenceRoundNumbers: [],
    };
  }

  if ((player.firstDeaths ?? 0) > (player.firstKills ?? 0)) {
    const rounds = firstDeathRounds(context.eventsByRound, focusPuuid);
    return {
      kind: "coaching-inference",
      title: "Review opening duels",
      observedFacts: [`Opening duels: ${player.firstKills ?? 0} first kills / ${player.firstDeaths ?? 0} first deaths`],
      inference: "Check whether the first deaths were traded or isolated before changing entry timing or positioning.",
      confidence: rounds.length ? "high" : "medium",
      evidenceRoundNumbers: rounds,
    };
  }

  const kast = normalizeRatio(player.kast);
  if (kast !== null && kast < 0.65) {
    return {
      kind: "coaching-inference",
      title: "Raise round involvement",
      observedFacts: [`KAST: ${formatPercent(kast)}`],
      inference: "Review low-involvement rounds for earlier utility, safer trade spacing, or survival value.",
      confidence: match.rounds.length && match.killEvents.length ? "medium" : "low",
      evidenceRoundNumbers: turningPoints
        .filter((point) => point.player?.puuid === focusPuuid)
        .map((point) => point.roundNumber)
        .slice(0, 3),
    };
  }

  if (player.damageDelta !== null && player.damageDelta < 0) {
    return {
      kind: "coaching-inference",
      title: "Review damage conversion",
      observedFacts: [
        `Damage delta per round: ${signedNumber(player.damageDelta)}`,
        `ADR: ${player.adr === null ? "unavailable" : Math.round(player.adr)}`,
      ],
      inference: "Compare deaths, economy, and follow-up kills to find damage that did not convert into round value.",
      confidence: match.rounds.length ? "medium" : "low",
      evidenceRoundNumbers: turningPoints
        .filter((point) => point.player?.puuid === focusPuuid)
        .map((point) => point.roundNumber)
        .slice(0, 3),
    };
  }

  const focusTurningPoint = turningPoints.find(
    (point) =>
      point.player?.puuid === focusPuuid || teamKey(point.teamId) === (context.teamByPlayer.get(focusPuuid) ?? null),
  );
  return {
    kind: "coaching-inference",
    title: focusTurningPoint ? `Review round ${focusTurningPoint.roundNumber}` : "Compare representative rounds",
    observedFacts: focusTurningPoint
      ? [`Top observed turning point: ${focusTurningPoint.title} in round ${focusTurningPoint.roundNumber}`]
      : [`No coaching threshold crossed across ${match.rounds.length} observed rounds`],
    inference: focusTurningPoint
      ? "Use the supporting events to identify what made the successful pattern repeatable."
      : "Compare one won and one lost round before changing the habits behind this score.",
    confidence: focusTurningPoint ? "medium" : "low",
    evidenceRoundNumbers: focusTurningPoint ? [focusTurningPoint.roundNumber] : [],
  };
}

function missingRecommendationInputs(player: MatchPlayerDetail): string[] {
  const missing: string[] = [];
  if (player.acs === null) missing.push("ACS");
  if (player.adr === null) missing.push("ADR");
  if (player.damageDelta === null) missing.push("damage delta");
  if (player.kast === null) missing.push("KAST");
  if (player.firstKills === null && player.firstDeaths === null) missing.push("opening duels");
  return missing;
}

function firstDeathRounds(eventsByRound: Map<number, MatchKillEvent[]>, focusPuuid: string): number[] {
  return Array.from(eventsByRound.entries())
    .filter(([, events]) => events[0]?.victimPuuid === focusPuuid)
    .map(([roundNumber]) => roundNumber)
    .sort((left, right) => left - right);
}

function normalizeRatio(value: number | null): number | null {
  if (value === null) return null;
  return value > 1 ? value / 100 : value;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 10) / 10}`;
}

function supportsRoundAnalysis(mode: string): boolean {
  const normalized = mode.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !["deathmatch", "teamdeathmatch", "escalation"].includes(normalized);
}

function compareTurningPoints(left: MatchTurningPoint, right: MatchTurningPoint): number {
  return (
    right.priority - left.priority ||
    left.roundNumber - right.roundNumber ||
    left.kind.localeCompare(right.kind) ||
    left.title.localeCompare(right.title)
  );
}

function clutchTurningPoints(
  match: MatchDetail,
  focusPuuid: string | null,
  context: MatchContext,
): MatchTurningPoint[] {
  const initialAlive = new Map<string, Set<string>>();
  for (const player of match.teams.flatMap((team) => team.players)) {
    if (!player.puuid) continue;
    const team = teamKey(player.teamId);
    const alive = initialAlive.get(team) ?? new Set<string>();
    alive.add(player.puuid);
    initialAlive.set(team, alive);
  }
  if (initialAlive.size < 2) return [];

  const points: MatchTurningPoint[] = [];
  for (const round of match.rounds) {
    const winner = teamKey(round.winningTeam);
    const events = context.eventsByRound.get(round.number);
    if (!winner || !events?.length) continue;
    const alive = cloneAlive(initialAlive);
    const clutchByPlayer = new Map<string, { opponents: number; event: MatchKillEvent }>();

    for (const event of events) {
      if (!event.killerPuuid || !event.victimPuuid) continue;
      const killerTeam = teamKey(event.killerTeam ?? context.teamByPlayer.get(event.killerPuuid));
      const victimTeam = teamKey(event.victimTeam ?? context.teamByPlayer.get(event.victimPuuid));
      const killerAlive = alive.get(killerTeam);
      const victimAlive = alive.get(victimTeam);
      if (killerTeam === winner && killerAlive?.size === 1 && killerAlive.has(event.killerPuuid) && victimAlive?.size) {
        const current = clutchByPlayer.get(event.killerPuuid);
        if (!current || victimAlive.size > current.opponents)
          clutchByPlayer.set(event.killerPuuid, { opponents: victimAlive.size, event });
      }
      victimAlive?.delete(event.victimPuuid);
    }

    for (const [puuid, clutch] of clutchByPlayer) {
      const focus = puuid === focusPuuid;
      points.push({
        roundNumber: round.number,
        kind: "clutch",
        tone: focus ? "focus" : "multi",
        title: `1v${clutch.opponents} clutch`,
        detail: `${teamLabelOf(context, clutch.event.killerTeam)} converted the round`,
        score: roundScoreLabel(match, round),
        teamId: clutch.event.killerTeam,
        player: playerFromKiller(clutch.event),
        playerNote: focus ? "focused player" : "last survivor",
        weaponName: clutch.event.weaponName,
        evidence: [`winner=${round.winningTeam}`, `last-survivor=${puuid}`, `opponents-alive=${clutch.opponents}`],
        priority: (focus ? 100 : 0) + 80 + clutch.opponents,
      });
    }
  }
  return points;
}

function multikillTurningPoints(
  match: MatchDetail,
  focusPuuid: string | null,
  context: MatchContext,
): MatchTurningPoint[] {
  const groups = new Map<string, { roundNumber: number; events: MatchKillEvent[] }>();
  for (const event of match.killEvents) {
    const roundNumber = killRoundNumber(match, event);
    if (roundNumber === null || !event.killerPuuid) continue;
    const key = `${roundNumber}:${event.killerPuuid}`;
    const group = groups.get(key) ?? { roundNumber, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .filter(({ events }) => events.length >= 2)
    .map(({ roundNumber, events }) => {
      const ordered = sortEvents(events);
      const first = ordered[0]!;
      const focus = first.killerPuuid === focusPuuid;
      const round = context.roundsByNumber.get(roundNumber) ?? null;
      return {
        roundNumber,
        kind: "multikill" as const,
        tone: focus ? ("focus" as const) : ("multi" as const),
        title: `${events.length}k round`,
        detail: `${teamLabelOf(context, first.killerTeam)} frag sequence started ${formatRoundTime(first.timeInRoundMs)}`,
        score: roundScoreLabel(match, round),
        teamId: first.killerTeam,
        player: playerFromKiller(first),
        playerNote: focus ? "focused player" : "multikill",
        weaponName: first.weaponName,
        evidence: ordered.map(
          (event) => `kill:${event.victimPuuid ?? event.victimName}@${event.timeInRoundMs ?? "unknown"}`,
        ),
        priority: (focus ? 100 : 0) + 60 + events.length,
      };
    });
}

function spikeTurningPoints(match: MatchDetail, focusPuuid: string | null, context: MatchContext): MatchTurningPoint[] {
  const points: MatchTurningPoint[] = [];
  for (const round of match.rounds) {
    const event = round.spikeDefuse ?? round.spikePlant;
    if (!event) continue;
    const kind = round.spikeDefuse ? "Defuse" : "Plant";
    const player = playerForSpike(context, event.playerName, event.playerTag);
    const focus = player?.puuid === focusPuuid;
    points.push({
      roundNumber: round.number,
      kind: "spike",
      tone: focus ? "focus" : "spike",
      title: `${kind}${event.site ? ` ${event.site}` : ""}`,
      detail: `${teamLabelOf(context, round.winningTeam)} won${round.result ? ` by ${humanize(round.result)}` : ""} · ${formatRoundTime(event.timeInRoundMs)}`,
      score: roundScoreLabel(match, round),
      teamId: event.teamId,
      player:
        player ?? (event.playerName ? { puuid: null, gameName: event.playerName, tagLine: event.playerTag } : null),
      playerNote: focus ? "focused player" : teamLabelOf(context, event.teamId),
      weaponName: null,
      evidence: [
        `${kind.toLowerCase()}-site=${event.site ?? "unknown"}`,
        `event-time-ms=${event.timeInRoundMs ?? "unknown"}`,
      ],
      priority: (focus ? 100 : 0) + (round.spikeDefuse ? 52 : 45),
    });
  }
  return points;
}

function economyTurningPoints(
  match: MatchDetail,
  focusPuuid: string | null,
  context: MatchContext,
): MatchTurningPoint[] {
  const points: MatchTurningPoint[] = [];
  for (const round of match.rounds) {
    if (!round.winningTeam || !hasComparableEconomy(round)) continue;
    const averages = teamLoadoutAverages(round);
    const winnerKey = teamKey(round.winningTeam);
    const winningAverage = averages.get(winnerKey);
    const richerOpponent = Array.from(averages.entries())
      .filter(([team]) => team !== winnerKey)
      .sort((left, right) => right[1] - left[1])[0];
    if (winningAverage === undefined || !richerOpponent || richerOpponent[1] - winningAverage < 1_500) continue;
    const focusTeam = focusPuuid ? (context.teamByPlayer.get(focusPuuid) ?? null) : null;
    const focus = focusTeam === winnerKey;
    points.push({
      roundNumber: round.number,
      kind: "eco",
      tone: focus ? "focus" : "eco",
      title: "Economy upset",
      detail: `${teamLabelOf(context, round.winningTeam)} won with ${Math.round(winningAverage).toLocaleString()} vs ${Math.round(richerOpponent[1]).toLocaleString()} average loadout`,
      score: roundScoreLabel(match, round),
      teamId: round.winningTeam,
      player: null,
      playerNote: focus ? "focused team" : null,
      weaponName: null,
      evidence: [`winner-average-loadout=${winningAverage}`, `opponent-average-loadout=${richerOpponent[1]}`],
      priority: (focus ? 100 : 0) + 55 + Math.min(20, Math.floor((richerOpponent[1] - winningAverage) / 500)),
    });
  }
  return points;
}

function openingTurningPoints(
  match: MatchDetail,
  focusPuuid: string | null,
  context: MatchContext,
): MatchTurningPoint[] {
  return Array.from(context.eventsByRound.entries()).map(([roundNumber, events]) => {
    const event = events[0]!;
    const focus = event.killerPuuid === focusPuuid || event.victimPuuid === focusPuuid;
    const round = context.roundsByNumber.get(roundNumber) ?? null;
    return {
      roundNumber,
      kind: "opening" as const,
      tone: focus ? ("focus" as const) : ("entry" as const),
      title: "Opening kill",
      detail: `${teamLabelOf(context, event.killerTeam)} first pick · ${formatRoundTime(event.timeInRoundMs)}`,
      score: roundScoreLabel(match, round),
      teamId: event.killerTeam,
      player: playerFromKiller(event),
      playerNote: event.victimName ? `vs ${playerName(event.victimName, event.victimTag)}` : null,
      weaponName: event.weaponName,
      evidence: [`first-kill=${event.killerPuuid ?? event.killerName}->${event.victimPuuid ?? event.victimName}`],
      priority: (focus ? 100 : 0) + 30,
    };
  });
}

type MatchContext = {
  roundNumbers: Set<number>;
  roundsByNumber: Map<number, MatchRoundDetail>;
  eventsByRound: Map<number, MatchKillEvent[]>;
  playerByPuuid: Map<string, MatchPlayerDetail>;
  teamByPlayer: Map<string, string>;
  teamLabel: Map<string, string>;
  playerByName: Map<string, MatchPlayerDetail>;
  playerByNameTag: Map<string, MatchPlayerDetail>;
};

function buildMatchContext(match: MatchDetail): MatchContext {
  const roundNumbers = new Set<number>();
  const roundsByNumber = new Map<number, MatchRoundDetail>();
  for (const round of match.rounds) {
    roundNumbers.add(round.number);
    if (!roundsByNumber.has(round.number)) roundsByNumber.set(round.number, round);
  }
  const playerByPuuid = new Map<string, MatchPlayerDetail>();
  const teamByPlayer = new Map<string, string>();
  const teamLabel = new Map<string, string>();
  const playerByName = new Map<string, MatchPlayerDetail>();
  const playerByNameTag = new Map<string, MatchPlayerDetail>();
  for (const team of match.teams) {
    const teamKeyValue = teamKey(team.teamId);
    if (!teamLabel.has(teamKeyValue)) teamLabel.set(teamKeyValue, team.label);
    for (const player of team.players) {
      if (player.puuid && !playerByPuuid.has(player.puuid)) playerByPuuid.set(player.puuid, player);
      if (player.puuid && !teamByPlayer.has(player.puuid)) teamByPlayer.set(player.puuid, teamKeyValue);
      const nameKey = player.gameName.toLowerCase();
      if (!playerByName.has(nameKey)) playerByName.set(nameKey, player);
      const nameTagKey = `${nameKey}#${player.tagLine?.toLowerCase() ?? ""}`;
      if (!playerByNameTag.has(nameTagKey)) playerByNameTag.set(nameTagKey, player);
    }
  }
  const eventsByRound = new Map<number, MatchKillEvent[]>();
  for (const event of match.killEvents) {
    const roundNumber = killRoundNumber(match, event);
    if (roundNumber === null) continue;
    const events = eventsByRound.get(roundNumber);
    if (events) events.push(event);
    else eventsByRound.set(roundNumber, [event]);
  }
  for (const [round, events] of eventsByRound) eventsByRound.set(round, sortEvents(events));
  return {
    roundNumbers,
    roundsByNumber,
    eventsByRound,
    playerByPuuid,
    teamByPlayer,
    teamLabel,
    playerByName,
    playerByNameTag,
  };
}

function sortEvents(events: MatchKillEvent[]): MatchKillEvent[] {
  return [...events].sort(
    (left, right) =>
      (left.timeInRoundMs ?? Number.MAX_SAFE_INTEGER) - (right.timeInRoundMs ?? Number.MAX_SAFE_INTEGER) ||
      (left.timeInMatchMs ?? Number.MAX_SAFE_INTEGER) - (right.timeInMatchMs ?? Number.MAX_SAFE_INTEGER),
  );
}

function hasComparableEconomy(round: MatchRoundDetail): boolean {
  return teamLoadoutAverages(round).size >= 2;
}

function teamLoadoutAverages(round: MatchRoundDetail): Map<string, number> {
  const totals = new Map<string, { value: number; players: number }>();
  for (const player of round.playerStats) {
    const team = teamKey(player.teamId);
    if (!team || player.loadoutValue === null) continue;
    const current = totals.get(team) ?? { value: 0, players: 0 };
    current.value += player.loadoutValue;
    current.players += 1;
    totals.set(team, current);
  }
  return new Map(Array.from(totals.entries()).map(([team, total]) => [team, total.value / total.players]));
}

function roundScoreLabel(match: MatchDetail, round: MatchRoundDetail | null): string | null {
  if (!round?.teamScores.length) return null;
  return match.teams
    .map(
      (team) =>
        `${team.label} ${round.teamScores.find((score) => teamKey(score.teamId) === teamKey(team.teamId))?.roundsWon ?? 0}`,
    )
    .join(" · ");
}

function teamLabelOf(context: MatchContext, teamId: string | null | undefined): string {
  if (!teamId) return "Unknown team";
  return context.teamLabel.get(teamKey(teamId)) ?? teamId;
}

function playerForSpike(
  context: MatchContext,
  gameName: string | null,
  tagLine: string | null,
): MatchTurningPoint["player"] {
  if (!gameName) return null;
  const normalizedName = gameName.toLowerCase();
  const normalizedTag = tagLine?.toLowerCase() ?? null;
  const matchPlayer = normalizedTag
    ? context.playerByNameTag.get(`${normalizedName}#${normalizedTag}`)
    : context.playerByName.get(normalizedName);
  return matchPlayer
    ? { puuid: matchPlayer.puuid, gameName: matchPlayer.gameName, tagLine: matchPlayer.tagLine }
    : { puuid: null, gameName, tagLine };
}

function playerFromKiller(event: MatchKillEvent): MatchTurningPoint["player"] {
  return { puuid: event.killerPuuid, gameName: event.killerName, tagLine: event.killerTag };
}

function playerName(name: string, tag: string | null): string {
  return tag ? `${name}#${tag}` : name;
}

function teamKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function cloneAlive(source: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map(Array.from(source.entries()).map(([team, players]) => [team, new Set(players)]));
}

function formatRoundTime(value: number | null): string {
  if (value === null) return "at unknown time";
  const seconds = Math.max(0, Math.floor(value / 1_000));
  return `at ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}
