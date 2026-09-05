import { killRoundNumber } from "../services/match-kill-round";
import { matchCompleteness } from "../services/match-completeness";
import { ValorantInputError } from "./errors";
import { normalizeMapSpatialPosition } from "../domain/map-spatial-resources";
import type {
  MatchDetail,
  MatchKillEvent,
  MatchPlayerDetail,
  MatchRoundDetail,
  MatchRoundEvidenceAnalysis,
} from "../domain/types";
import { inferInitialAttackerTeam, sideForRound } from "../services/match-side";
import { abilityCastContext, nearestMapCallout, type AbilityCastContext, type NearestCallout } from "./game-knowledge";
import { buildAttentionSnapshot, mapFacingRadians, type AttentionSnapshot } from "./view-analysis";

export type ScoreTiming = "before" | "after" | "either";
export type RoundPhase = "opening" | "pre-plant" | "post-plant" | "retake" | "late-round";

export type PlayerRef = {
  puuid: string | null;
  riotId: string;
  gameName: string;
  tagLine: string | null;
  teamId: string | null;
  agentName: string | null;
};

export type RoundScoreState = {
  roundNumber: number;
  order: string[];
  before: Record<string, number>;
  after: Record<string, number>;
  beforeLabel: string;
  afterLabel: string;
  focusTeamId: string | null;
  focusBeforeLabel: string | null;
  focusAfterLabel: string | null;
};

export type RoundTimelineEvent = {
  id: string;
  order: number;
  kind: "kill" | "plant" | "defuse";
  phase: RoundPhase;
  timeInRoundMs: number | null;
  actor: PlayerRef;
  target: PlayerRef | null;
  weaponName: string | null;
  assistants: string[];
  distanceMeters: number | null;
  site: string | null;
  actorCallout: NearestCallout | null;
  targetCallout: NearestCallout | null;
  attention: AttentionSnapshot | null;
  aliveBefore: Record<string, number>;
  aliveAfter: Record<string, number>;
  tags: string[];
  trade: { eventId: string; by: PlayerRef; delayMs: number } | null;
};

export type RoundIntelligence = {
  matchId: string;
  map: string | null;
  roundNumber: number;
  score: RoundScoreState;
  winner: { teamId: string | null; side: "attack" | "defense" | null; result: string | null };
  focus: {
    player: PlayerRef;
    side: "attack" | "defense" | null;
    outcome: "win" | "loss" | "unknown";
    kills: number;
    deaths: number;
  } | null;
  timeline: RoundTimelineEvent[];
  keyMoments: RoundTimelineEvent[];
  decisiveEvent: RoundTimelineEvent | null;
  abilityContext: Array<{ player: PlayerRef; context: AbilityCastContext }>;
  observedFacts: string[];
  supportedInferences: string[];
  limitations: string[];
};

export type DuelReplay = {
  matchId: string;
  map: string | null;
  roundNumber: number;
  score: RoundScoreState;
  eventId: string;
  eventIndex: number;
  eventCount: number;
  previousEventId: string | null;
  nextEventId: string | null;
  previousEventLabel: string | null;
  nextEventLabel: string | null;
  phase: RoundPhase;
  timeInRoundMs: number | null;
  killer: PlayerRef;
  victim: PlayerRef;
  weaponName: string | null;
  distanceMeters: number | null;
  killerPosition: { x: number; y: number; viewRadians: number | null; mapFacingRadians: number | null } | null;
  victimPosition: { x: number; y: number; viewRadians: number | null; mapFacingRadians: number | null } | null;
  killerCallout: NearestCallout | null;
  victimCallout: NearestCallout | null;
  trade: RoundTimelineEvent["trade"];
  tags: string[];
  attention: AttentionSnapshot | null;
  summary: string;
  limitations: string[];
};

export type TacticalMarker = {
  index: number;
  player: PlayerRef;
  role: "killer" | "victim" | "selected";
  relation: "focus" | "ally" | "enemy" | "neutral";
  x: number;
  y: number;
  viewRadians: number | null;
  mapFacingRadians: number | null;
  callout: NearestCallout | null;
};

export type TacticalSnapshot = {
  replay: DuelReplay;
  markers: TacticalMarker[];
  availablePlayers: PlayerRef[];
  warnings: string[];
};

export type RoundKillList = {
  matchId: string;
  map: string | null;
  roundNumber: number;
  score: RoundScoreState;
  kills: Array<{
    number: number;
    eventId: string;
    label: string;
    timeInRoundMs: number | null;
    killer: PlayerRef;
    victim: PlayerRef;
    weaponName: string | null;
    distanceMeters: number | null;
    killerCallout: NearestCallout | null;
    victimCallout: NearestCallout | null;
    traded: boolean;
    tradeDelayMs: number | null;
  }>;
};

export type DeathReview = {
  matchId: string;
  player: PlayerRef;
  filters: {
    roundFrom: number | null;
    roundTo: number | null;
    score: string | null;
    scoreTiming: ScoreTiming;
  };
  totalDeaths: number;
  selectedIndex: number;
  selected: DeathMoment | null;
  deaths: DeathMoment[];
  navigation: {
    previousDeathIndex: number | null;
    nextDeathIndex: number | null;
    previousEventId: string | null;
    nextEventId: string | null;
    buttonChoices: string[];
  };
  limitations: string[];
};

export type DeathMoment = {
  index: number;
  roundNumber: number;
  scoreBefore: string;
  scoreAfter: string;
  eventId: string;
  phase: RoundPhase;
  timeInRoundMs: number | null;
  killer: PlayerRef;
  victim: PlayerRef;
  weaponName: string | null;
  distanceMeters: number | null;
  killerCallout: NearestCallout | null;
  victimCallout: NearestCallout | null;
  trade: RoundTimelineEvent["trade"];
  focusTeamOutcome: "win" | "loss" | "unknown";
  aliveBefore: Record<string, number>;
  aliveAfter: Record<string, number>;
  impact: string[];
  attention: AttentionSnapshot | null;
  explanation: string;
};

export type TimelineEventRef = {
  id: string;
  round: number;
  kind: RoundTimelineEvent["kind"];
  timeInRoundMs: number | null;
  actor: string;
  target: string | null;
  site: string | null;
  fact: string;
};
export type MatchTimeline = {
  version: "match-timeline-v2";
  matchId: string;
  map: string | null;
  matchPatch: string | null;
  focus: PlayerRef | null;
  participants: Record<string, PlayerRef>;
  events: Record<string, TimelineEventRef>;
  rounds: Array<{
    roundNumber: number;
    scoreBefore: string;
    scoreAfter: string;
    side: "attack" | "defense" | null;
    outcome: "win" | "loss" | "unknown";
    winner: RoundIntelligence["winner"];
    focusKills: number | null;
    focusDeaths: number | null;
    focusUntradedDeaths: number | null;
    opening: string | null;
    objective: string | null;
    decisiveEvent: string | null;
    keyMoments: string[];
    observedFacts: string[];
    supportedInferences: string[];
  }>;
  summary: {
    rounds: number;
    wins: number;
    losses: number;
    unknown: number;
    focusKills: number | null;
    focusDeaths: number | null;
    openingDeaths: number | null;
    untradedDeaths: number | null;
  };
  evidence: ReturnType<typeof matchCompleteness>;
  limitations: string[];
};

export type PositionReview = {
  matchId: string;
  player: PlayerRef;
  death: DeathMoment;
  replay: DuelReplay;
  teammates: Array<{
    player: PlayerRef;
    distanceToVictimMeters: number | null;
    distanceToKillerMeters: number;
    callout: NearestCallout | null;
    killerAlignment: "direct" | "inside-cone" | "looking-away" | "unknown";
    killerAngleDeltaDegrees: number | null;
    killerInsideAssumedCone: boolean | null;
  }>;
  snapshot: TacticalSnapshot;
  observedFacts: string[];
  supportedInferences: string[];
  limitations: string[];
};

export function resolveMatchPlayer(detail: MatchDetail, selector: string): MatchPlayerDetail {
  const needle = selector.trim().toLocaleLowerCase();
  if (!needle) throw new ValorantInputError("A player Riot ID, PUUID, game name, or agent name is required");
  const players = detail.teams.flatMap((team) => team.players);
  const exact = players.filter(
    (player) =>
      player.puuid?.toLocaleLowerCase() === needle ||
      riotId(player.gameName, player.tagLine).toLocaleLowerCase() === needle ||
      player.gameName.toLocaleLowerCase() === needle ||
      player.agentName?.toLocaleLowerCase() === needle,
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new ValorantInputError(
      `Player selector ${selector} is ambiguous: ${exact.map((player) => `${riotId(player.gameName, player.tagLine)} (${player.agentName ?? "agent unknown"})`).join(", ")}`,
    );
  }
  throw new ValorantInputError(
    `Player ${selector} is not in this match. Available players: ${players.map((player) => `${riotId(player.gameName, player.tagLine)} (${player.agentName ?? "agent unknown"})`).join(", ")}`,
  );
}

export function roundScoreStates(detail: MatchDetail, focusPuuid: string | null = null): RoundScoreState[] {
  const order = detail.teams.map((team) => team.teamId);
  const focusTeamId = focusPuuid ? teamForPuuid(detail, focusPuuid) : null;
  const current = Object.fromEntries(order.map((teamId) => [teamId, 0])) as Record<string, number>;
  let previousRound = 0;
  let known = true;
  return [...detail.rounds]
    .sort((left, right) => left.number - right.number)
    .map((round) => {
      const beforeKnown = known && round.number === previousRound + 1;
      const before = { ...current };
      for (const team of round.teamScores) current[team.teamId] = team.roundsWon;
      if (round.winningTeam && !round.teamScores.some((row) => sameTeam(row.teamId, round.winningTeam!))) {
        const canonical = order.find((teamId) => sameTeam(teamId, round.winningTeam!)) ?? round.winningTeam;
        current[canonical] = (current[canonical] ?? 0) + 1;
      }
      known =
        (beforeKnown && round.winningTeam !== null) ||
        (order.every((id) => round.teamScores.some((t) => sameTeam(t.teamId, id))) &&
          round.teamScores.reduce((sum, t) => sum + t.roundsWon, 0) === round.number);
      previousRound = round.number;
      const after = { ...current };
      return {
        roundNumber: round.number,
        order,
        before,
        after,
        beforeLabel: beforeKnown ? scoreLabel(order, before) : "unknown",
        afterLabel: known ? scoreLabel(order, after) : "unknown",
        focusTeamId,
        focusBeforeLabel: focusTeamId
          ? beforeKnown
            ? perspectiveScoreLabel(order, before, focusTeamId)
            : "unknown"
          : null,
        focusAfterLabel: focusTeamId ? (known ? perspectiveScoreLabel(order, after, focusTeamId) : "unknown") : null,
      };
    });
}

export function resolveRoundNumber(
  detail: MatchDetail,
  input: {
    roundNumber?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
    focusPuuid?: string | null;
  },
): { roundNumber: number; matchedBy: "round" | "score-before" | "score-after"; score: RoundScoreState } {
  const scores = roundScoreStates(detail, input.focusPuuid ?? null);
  if (input.roundNumber !== undefined) {
    const state = scores.find((candidate) => candidate.roundNumber === input.roundNumber);
    if (!state)
      throw new ValorantInputError(
        `Round ${input.roundNumber} is unavailable. Available rounds: ${scores.map((candidate) => candidate.roundNumber).join(", ")}`,
      );
    return { roundNumber: input.roundNumber, matchedBy: "round", score: state };
  }
  const parsed = parseScore(input.score);
  if (!parsed) throw new ValorantInputError("Provide either round_number or score in A-B format, for example 6-7");
  const timing = input.scoreTiming ?? "before";
  const preferred = timing === "either" ? (["before", "after"] as const) : ([timing] as const);
  for (const candidateTiming of preferred) {
    const matches = scores.filter((state) => scoreMatches(state, parsed, candidateTiming, Boolean(input.focusPuuid)));
    if (matches.length === 1)
      return {
        roundNumber: matches[0]!.roundNumber,
        matchedBy: candidateTiming === "before" ? "score-before" : "score-after",
        score: matches[0]!,
      };
    if (matches.length > 1)
      throw new ValorantInputError(
        `Score ${input.score} matches multiple rounds (${matches.map((state) => state.roundNumber).join(", ")}); specify round_number`,
      );
  }
  throw new ValorantInputError(
    `No round matches score ${input.score} (${timing}). Recorded score transitions: ${scores.map((state) => `R${state.roundNumber} ${state.focusBeforeLabel ?? state.beforeLabel}→${state.focusAfterLabel ?? state.afterLabel}`).join(", ")}`,
  );
}

export function buildRoundIntelligence(
  detail: MatchDetail,
  roundNumber: number,
  focusPuuid: string | null,
): RoundIntelligence {
  const round = roundByNumber(detail, roundNumber);
  const score = roundScoreStates(detail, focusPuuid).find((candidate) => candidate.roundNumber === roundNumber)!;
  const timeline = buildTimeline(detail, round, focusPuuid);
  const focusPlayer = focusPuuid
    ? (detail.teams.flatMap((team) => team.players).find((player) => player.puuid === focusPuuid) ?? null)
    : null;
  const focusTeam = focusPlayer?.teamId ?? null;
  const initialAttackerTeam = inferInitialAttackerTeam(detail);
  const winnerSide = round.winningTeam
    ? sideForRound(detail, round.winningTeam, round.number, initialAttackerTeam)
    : null;
  const focusOutcome =
    !focusTeam || !round.winningTeam ? "unknown" : sameTeam(focusTeam, round.winningTeam) ? "win" : "loss";
  const focusKills = focusPuuid
    ? timeline.filter((event) => event.kind === "kill" && event.actor.puuid === focusPuuid).length
    : 0;
  const focusDeaths = focusPuuid
    ? timeline.filter((event) => event.kind === "kill" && event.target?.puuid === focusPuuid).length
    : 0;
  const decisiveEvent = decisiveRoundEvent(round, timeline);
  const keyMoments = uniqueEvents([
    timeline.find((event) => event.kind === "kill") ?? null,
    ...timeline.filter(
      (event) =>
        event.kind !== "kill" ||
        event.tags.some((tag) =>
          ["trade", "man-advantage-swing", "equalizer", "closing-kill", "clutch-kill"].includes(tag),
        ),
    ),
    decisiveEvent,
  ]).slice(0, 8);
  const observedFacts = observedRoundFacts(detail, round, score, timeline, focusPlayer, focusOutcome, decisiveEvent);
  const supportedInferences =
    detail.evidence && detail.evidence.kills.state !== "complete"
      ? []
      : roundInferences(detail, round, timeline, focusPlayer, focusOutcome);
  const roster = detail.teams.flatMap((team) => team.players);
  const abilityContext = round.playerStats.flatMap((stats) => {
    const player = roster.find((candidate) =>
      sameIdentity(candidate.puuid, candidate.gameName, candidate.tagLine, {
        puuid: stats.puuid,
        gameName: stats.gameName,
        tagLine: stats.tagLine,
      }),
    );
    const context = abilityCastContext(player?.agentName ?? null, stats.abilityCasts);
    return player && context && context.casts.length ? [{ player: playerRef(player), context }] : [];
  });
  return {
    matchId: detail.matchId,
    map: detail.mapName,
    roundNumber,
    score,
    winner: { teamId: round.winningTeam, side: winnerSide, result: round.result },
    focus: focusPlayer
      ? {
          player: playerRef(focusPlayer),
          side: sideForRound(detail, focusPlayer.teamId, round.number, initialAttackerTeam),
          outcome: focusOutcome,
          kills: focusKills,
          deaths: focusDeaths,
        }
      : null,
    timeline,
    keyMoments,
    decisiveEvent,
    abilityContext,
    observedFacts,
    supportedInferences,
    limitations: unique([...detail.warnings, ...evidenceLimitations(timeline)]),
  };
}

export function buildDuelReplay(
  detail: MatchDetail,
  input: {
    roundNumber: number;
    eventId?: string;
    focusPuuid?: string | null;
  },
): DuelReplay {
  const intelligence = buildRoundIntelligence(detail, input.roundNumber, input.focusPuuid ?? null);
  const kills = intelligence.timeline.filter(
    (event): event is RoundTimelineEvent & { target: PlayerRef } => event.kind === "kill" && event.target !== null,
  );
  if (!kills.length) throw new ValorantInputError(`Round ${input.roundNumber} has no recorded kill events to render`);
  const selected = input.eventId
    ? kills.find((event) => event.id === input.eventId)
    : ((input.focusPuuid ? kills.find((event) => event.target.puuid === input.focusPuuid) : null) ?? kills.at(-1)!);
  if (!selected)
    throw new ValorantInputError(
      `Kill event ${input.eventId} is unavailable. Available events: ${kills.map((event) => event.id).join(", ")}`,
    );
  const eventIndex = kills.findIndex((event) => event.id === selected.id);
  const raw = rawKillForTimelineEvent(detail, selected);
  const killerLocation =
    raw?.playerLocations.find((location) =>
      sameIdentity(location.puuid, location.gameName, location.tagLine, selected.actor),
    ) ?? null;
  const victimLocation =
    raw?.playerLocations.find((location) =>
      sameIdentity(location.puuid, location.gameName, location.tagLine, selected.target),
    ) ?? null;
  const killerPosition = normalizeMapSpatialPosition(detail.mapName, killerLocation?.location ?? null);
  const victimPosition = normalizeMapSpatialPosition(detail.mapName, raw?.victimLocation ?? null);
  const locationLimit =
    !killerPosition || !victimPosition
      ? ["One or both duel positions are unavailable, so the image shows only recorded coordinates."]
      : [];
  return {
    matchId: detail.matchId,
    map: detail.mapName,
    roundNumber: input.roundNumber,
    score: intelligence.score,
    eventId: selected.id,
    eventIndex: eventIndex + 1,
    eventCount: kills.length,
    previousEventId: kills[eventIndex - 1]?.id ?? null,
    nextEventId: kills[eventIndex + 1]?.id ?? null,
    previousEventLabel: kills[eventIndex - 1] ? humanKillLabel(kills[eventIndex - 1]!, eventIndex) : null,
    nextEventLabel: kills[eventIndex + 1] ? humanKillLabel(kills[eventIndex + 1]!, eventIndex + 2) : null,
    phase: selected.phase,
    timeInRoundMs: selected.timeInRoundMs,
    killer: selected.actor,
    victim: selected.target,
    weaponName: selected.weaponName,
    distanceMeters: selected.distanceMeters,
    killerPosition: killerPosition
      ? {
          ...killerPosition,
          viewRadians: killerLocation?.viewRadians ?? null,
          mapFacingRadians: mapFacingRadians(
            detail.mapName,
            killerLocation?.location ?? null,
            killerLocation?.viewRadians ?? null,
          ),
        }
      : null,
    victimPosition: victimPosition
      ? {
          ...victimPosition,
          viewRadians: victimLocation?.viewRadians ?? null,
          mapFacingRadians: mapFacingRadians(
            detail.mapName,
            victimLocation?.location ?? raw?.victimLocation ?? null,
            victimLocation?.viewRadians ?? null,
          ),
        }
      : null,
    killerCallout: nearestMapCallout(detail.mapName, killerLocation?.location ?? null),
    victimCallout: nearestMapCallout(detail.mapName, raw?.victimLocation ?? null),
    trade: selected.trade,
    tags: selected.tags,
    attention: selected.attention,
    summary: deathSentence(selected, intelligence),
    limitations: [...locationLimit, ...intelligence.limitations],
  };
}

export function buildRoundKillList(detail: MatchDetail, roundNumber: number, focusPuuid: string | null): RoundKillList {
  const intelligence = buildRoundIntelligence(detail, roundNumber, focusPuuid);
  const kills = intelligence.timeline.filter(
    (event): event is RoundTimelineEvent & { target: PlayerRef } => event.kind === "kill" && event.target !== null,
  );
  return {
    matchId: detail.matchId,
    map: detail.mapName,
    roundNumber,
    score: intelligence.score,
    kills: kills.map((event, index) => ({
      number: index + 1,
      eventId: event.id,
      label: humanKillLabel(event, index + 1),
      timeInRoundMs: event.timeInRoundMs,
      killer: event.actor,
      victim: event.target,
      weaponName: event.weaponName,
      distanceMeters: event.distanceMeters,
      killerCallout: event.actorCallout,
      victimCallout: event.targetCallout,
      traded: event.trade !== null,
      tradeDelayMs: event.trade?.delayMs ?? null,
    })),
  };
}

export function buildTacticalSnapshot(
  detail: MatchDetail,
  input: {
    roundNumber: number;
    eventId?: string;
    focusPuuid?: string | null;
    players?: string[];
    includeKiller?: boolean;
    includeVictim?: boolean;
  },
): TacticalSnapshot {
  const replay = buildDuelReplay(detail, input);
  const selectedEvent: RoundTimelineEvent = buildRoundIntelligence(
    detail,
    input.roundNumber,
    input.focusPuuid ?? null,
  ).timeline.find((event) => event.id === replay.eventId)!;
  const raw = rawKillForTimelineEvent(detail, selectedEvent);
  if (!raw) throw new ValorantInputError(`Raw position snapshot is unavailable for ${replay.eventId}`);
  const roster = detail.teams.flatMap((team) => team.players);
  const focusTeam = input.focusPuuid ? teamForPuuid(detail, input.focusPuuid) : null;
  const availablePlayers = raw.playerLocations.flatMap((location) => {
    const player = roster.find((candidate) =>
      sameIdentity(candidate.puuid, candidate.gameName, candidate.tagLine, location),
    );
    return player ? [playerRef(player)] : [];
  });
  if (!availablePlayers.some((player) => samePlayerRefs(player, replay.victim))) availablePlayers.push(replay.victim);

  const requested: Array<{ player: PlayerRef; role: TacticalMarker["role"] }> = [];
  if (input.includeKiller !== false) requested.push({ player: replay.killer, role: "killer" });
  if (input.includeVictim !== false) requested.push({ player: replay.victim, role: "victim" });
  for (const selector of input.players ?? [])
    requested.push({ player: playerRef(resolveMatchPlayer(detail, selector)), role: "selected" });

  const warnings: string[] = [];
  const seen = new Set<string>();
  const markers: TacticalMarker[] = [];
  for (const item of requested) {
    const key = playerRefKey(item.player);
    if (seen.has(key)) continue;
    seen.add(key);
    const location = raw.playerLocations.find((candidate) =>
      sameIdentity(candidate.puuid, candidate.gameName, candidate.tagLine, item.player),
    );
    const rawPosition = location?.location ?? (samePlayerRefs(item.player, replay.victim) ? raw.victimLocation : null);
    const position = normalizeMapSpatialPosition(detail.mapName, rawPosition);
    if (!position) {
      warnings.push(`${item.player.riotId} has no usable position in ${replay.eventId}.`);
      continue;
    }
    const role = samePlayerRefs(item.player, replay.killer)
      ? "killer"
      : samePlayerRefs(item.player, replay.victim)
        ? "victim"
        : item.role;
    markers.push({
      index: markers.length + 1,
      player: item.player,
      role,
      relation:
        input.focusPuuid && item.player.puuid === input.focusPuuid
          ? "focus"
          : focusTeam && item.player.teamId
            ? sameTeam(focusTeam, item.player.teamId)
              ? "ally"
              : "enemy"
            : "neutral",
      x: position.x,
      y: position.y,
      viewRadians: location?.viewRadians ?? null,
      mapFacingRadians: mapFacingRadians(detail.mapName, rawPosition, location?.viewRadians ?? null),
      callout: nearestMapCallout(detail.mapName, rawPosition),
    });
  }
  return { replay, markers, availablePlayers, warnings };
}

export function reviewPlayerDeaths(
  detail: MatchDetail,
  input: {
    player: string;
    roundFrom?: number;
    roundTo?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
    deathIndex?: number;
  },
): DeathReview {
  const selectedPlayer = resolveMatchPlayer(detail, input.player);
  const scoreTiming = input.scoreTiming ?? "before";
  const scores = roundScoreStates(detail, selectedPlayer.puuid);
  const scoreFilter = parseScore(input.score);
  const all: DeathMoment[] = [];
  for (const round of detail.rounds) {
    if (input.roundFrom !== undefined && round.number < input.roundFrom) continue;
    if (input.roundTo !== undefined && round.number > input.roundTo) continue;
    const score = scores.find((candidate) => candidate.roundNumber === round.number)!;
    if (
      scoreFilter &&
      !scoreMatches(score, scoreFilter, scoreTiming === "either" ? "before" : scoreTiming, true) &&
      !(scoreTiming === "either" && scoreMatches(score, scoreFilter, "after", true))
    )
      continue;
    const intelligence = buildRoundIntelligence(detail, round.number, selectedPlayer.puuid);
    for (const event of intelligence.timeline) {
      if (event.kind !== "kill" || !event.target || !samePlayerRef(event.target, selectedPlayer)) continue;
      all.push(deathMoment(all.length + 1, event as RoundTimelineEvent & { target: PlayerRef }, intelligence));
    }
  }
  const requestedIndex = Math.min(Math.max(input.deathIndex ?? 1, 1), Math.max(all.length, 1));
  const selected = all[requestedIndex - 1] ?? null;
  return {
    matchId: detail.matchId,
    player: playerRef(selectedPlayer),
    filters: {
      roundFrom: input.roundFrom ?? null,
      roundTo: input.roundTo ?? null,
      score: input.score ?? null,
      scoreTiming,
    },
    totalDeaths: all.length,
    selectedIndex: selected ? requestedIndex : 0,
    selected,
    deaths: all.slice(0, 20),
    navigation: {
      previousDeathIndex: selected && requestedIndex > 1 ? requestedIndex - 1 : null,
      nextDeathIndex: selected && requestedIndex < all.length ? requestedIndex + 1 : null,
      previousEventId: selected && requestedIndex > 1 ? all[requestedIndex - 2]!.eventId : null,
      nextEventId: selected && requestedIndex < all.length ? all[requestedIndex]!.eventId : null,
      buttonChoices: [
        ...(selected && requestedIndex > 1 ? ["◀ Previous death"] : []),
        ...(selected && requestedIndex < all.length ? ["Next death ▶"] : []),
        ...(selected ? ["Explain this round", "Show this duel"] : []),
      ].slice(0, 4),
    },
    limitations: [
      ...detail.warnings,
      "Death review uses discrete kill-event snapshots, not continuous POV or movement. Counts describe recorded events; absent events do not prove zero deaths or no trade.",
      "Impact labels describe recorded man-advantage and trade timing; they do not assign blame or infer comms, intent, or utility not present in the feed.",
    ],
  };
}

export function buildMatchTimeline(detail: MatchDetail, focusPuuid: string | null): MatchTimeline {
  const focusPlayer = focusPuuid
    ? (detail.teams.flatMap((t) => t.players).find((p) => p.puuid === focusPuuid) ?? null)
    : null;
  const participants: MatchTimeline["participants"] = {};
  const events: MatchTimeline["events"] = {};
  const evidence = detail.evidence ?? matchCompleteness(detail);
  const completeKills = evidence.kills.state === "complete";
  const limitations = new Set(detail.warnings);
  const playerKey = (player: PlayerRef): string => {
    const key =
      Object.keys(participants).find(
        (key) => participants[key]!.riotId === player.riotId && participants[key]!.puuid === player.puuid,
      ) ?? `p${Object.keys(participants).length + 1}`;
    participants[key] = player;
    return key;
  };
  const eventRef = (event: RoundTimelineEvent | null, round: number): string | null => {
    if (!event) return null;
    events[event.id] ??= {
      id: event.id,
      round,
      kind: event.kind,
      timeInRoundMs: event.timeInRoundMs,
      actor: playerKey(event.actor),
      target: event.target ? playerKey(event.target) : null,
      site: event.site,
      fact:
        event.kind === "kill"
          ? `Recorded elimination${event.weaponName ? ` with ${event.weaponName}` : ""}.`
          : `Recorded spike ${event.kind}.`,
    };
    return event.id;
  };
  const rounds = [...detail.rounds]
    .sort((a, b) => a.number - b.number)
    .map((round) => {
      const intelligence = buildRoundIntelligence(detail, round.number, focusPuuid);
      intelligence.limitations.forEach((value) => limitations.add(value));
      const opening = intelligence.timeline.find((e) => e.kind === "kill") ?? null;
      const objective = intelligence.timeline.find((e) => e.kind === "plant" || e.kind === "defuse") ?? null;
      return {
        roundNumber: round.number,
        scoreBefore: intelligence.score.focusBeforeLabel ?? intelligence.score.beforeLabel,
        scoreAfter: intelligence.score.focusAfterLabel ?? intelligence.score.afterLabel,
        side: intelligence.focus?.side ?? null,
        outcome: intelligence.focus?.outcome ?? ("unknown" as const),
        winner: intelligence.winner,
        focusKills: completeKills ? (intelligence.focus?.kills ?? null) : null,
        focusDeaths: completeKills ? (intelligence.focus?.deaths ?? null) : null,
        focusUntradedDeaths:
          completeKills && focusPuuid
            ? intelligence.timeline.filter((e) => e.kind === "kill" && e.target?.puuid === focusPuuid && !e.trade)
                .length
            : null,
        opening: eventRef(opening, round.number),
        objective: eventRef(objective, round.number),
        decisiveEvent: eventRef(intelligence.decisiveEvent, round.number),
        keyMoments: intelligence.keyMoments.slice(0, 4).map((e) => eventRef(e, round.number)!),
        observedFacts: intelligence.observedFacts.slice(0, 2),
        supportedInferences: completeKills ? intelligence.supportedInferences.slice(0, 1) : [],
      };
    });
  limitations.add(
    "Event references resolve in events and participants. Full facts, utility counts and snapshots are available through the round/death/position tools.",
  );
  limitations.add(
    "Recorded positions are discrete kill-event snapshots, not continuous POV, movement, comms, intent, crosshair placement or proven visibility.",
  );
  if (!completeKills)
    limitations.add(
      "Kill coverage is incomplete or unknown. Focus totals and trade absence remain unknown; listed events are only recorded observations.",
    );
  const sum = (key: "focusKills" | "focusDeaths" | "focusUntradedDeaths") =>
    focusPuuid && completeKills ? rounds.reduce((sum, r) => sum + (r[key] ?? 0), 0) : null;
  return {
    version: "match-timeline-v2",
    matchId: detail.matchId,
    map: detail.mapName,
    matchPatch: detail.patch,
    focus: focusPlayer ? playerRef(focusPlayer) : null,
    participants,
    events,
    rounds,
    summary: {
      rounds: rounds.length,
      wins: rounds.filter((r) => r.outcome === "win").length,
      losses: rounds.filter((r) => r.outcome === "loss").length,
      unknown: rounds.filter((r) => r.outcome === "unknown").length,
      focusKills: sum("focusKills"),
      focusDeaths: sum("focusDeaths"),
      openingDeaths:
        focusPuuid && completeKills
          ? rounds.filter((r) => r.opening && participants[events[r.opening]!.target ?? ""]?.puuid === focusPuuid)
              .length
          : null,
      untradedDeaths: sum("focusUntradedDeaths"),
    },
    evidence,
    limitations: [...limitations],
  };
}

export function pageMatchTimeline(
  timeline: MatchTimeline,
  input: { roundFrom?: number; roundTo?: number; limit?: number },
) {
  const candidates = timeline.rounds.filter(
    (r) => r.roundNumber >= (input.roundFrom ?? 1) && r.roundNumber <= (input.roundTo ?? Infinity),
  );
  const selected: MatchTimeline["rounds"] = [];
  const events: MatchTimeline["events"] = {};
  for (const round of candidates.slice(0, input.limit ?? 30)) {
    const refs = [round.opening, round.objective, round.decisiveEvent, ...round.keyMoments].filter(
      (v): v is string => v !== null,
    );
    const additions = Object.fromEntries(refs.map((id) => [id, timeline.events[id]!]));
    const proposed = { ...timeline, rounds: [...selected, round], events: { ...events, ...additions } };
    if (selected.length && Buffer.byteLength(JSON.stringify(proposed)) > 44_000) break;
    selected.push(round);
    Object.assign(events, additions);
  }
  return {
    ...timeline,
    rounds: selected,
    events,
    pagination: {
      totalRounds: timeline.rounds.length,
      returned: selected.length,
      nextRound: candidates[selected.length]?.roundNumber ?? null,
      summaryScope: "whole-match" as const,
    },
  };
}

export function buildPositionReview(
  detail: MatchDetail,
  input: {
    player: string;
    roundFrom?: number;
    roundTo?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
    deathIndex?: number;
  },
): PositionReview {
  const review = reviewPlayerDeaths(detail, input);
  if (!review.selected)
    throw new ValorantInputError(`${review.player.riotId} has no recorded death matching these filters`);
  const death = review.selected;
  const replay = buildDuelReplay(detail, {
    roundNumber: death.roundNumber,
    eventId: death.eventId,
    focusPuuid: review.player.puuid,
  });
  const intelligence = buildRoundIntelligence(detail, death.roundNumber, review.player.puuid);
  const timelineEvent = intelligence.timeline.find((event) => event.id === death.eventId);
  const raw = timelineEvent ? rawKillForTimelineEvent(detail, timelineEvent) : null;
  const victimLocation =
    raw?.victimLocation ??
    raw?.playerLocations.find((location) =>
      sameIdentity(location.puuid, location.gameName, location.tagLine, replay.victim),
    )?.location ??
    null;
  const support = death.attention?.victimTeamSupport ?? [];
  const teammates = support
    .map((relation) => {
      const location = raw?.playerLocations.find((candidate) =>
        sameIdentity(candidate.puuid, candidate.gameName, candidate.tagLine, relation.observer),
      );
      return {
        player: relation.observer,
        distanceToVictimMeters:
          location && victimLocation
            ? Math.hypot(location.location.x - victimLocation.x, location.location.y - victimLocation.y) / 100
            : null,
        distanceToKillerMeters: relation.distanceMeters,
        callout: relation.observerCallout,
        killerAlignment: relation.alignment,
        killerAngleDeltaDegrees: relation.angleDeltaDegrees,
        killerInsideAssumedCone: relation.withinAssumedFov,
      };
    })
    .sort(
      (left, right) =>
        (left.distanceToVictimMeters ?? Number.MAX_SAFE_INTEGER) -
        (right.distanceToVictimMeters ?? Number.MAX_SAFE_INTEGER),
    );
  const snapshot = buildTacticalSnapshot(detail, {
    roundNumber: death.roundNumber,
    eventId: death.eventId,
    focusPuuid: review.player.puuid,
    players: teammates.map((teammate) => teammate.player.riotId),
  });
  const closeTeammates = teammates.filter(
    (teammate) => teammate.distanceToVictimMeters !== null && teammate.distanceToVictimMeters <= 15,
  );
  const covering = teammates.filter((teammate) => teammate.killerInsideAssumedCone === true);
  const observedFacts = unique([
    death.explanation,
    `${teammates.length} living victim-team teammate${teammates.length === 1 ? " had" : "s had"} a usable position and facing snapshot at the death event.`,
    `${closeTeammates.length} recorded teammate${closeTeammates.length === 1 ? " was" : "s were"} within 15 meters of the victim position.`,
    `${covering.length} recorded teammate${covering.length === 1 ? " had" : "s had"} the killer inside the assumed 103° horizontal cone.`,
    death.trade
      ? `The death was traded after ${death.trade.delayMs} ms by ${death.trade.by.riotId}.`
      : "No five-second trade was recorded for this death.",
  ]);
  const supportedInferences = unique([
    ...(teammates.length && closeTeammates.length === 0
      ? [
          "The snapshot supports that the victim was spatially separated from every recorded living teammate with usable position evidence.",
        ]
      : []),
    ...(teammates.length && covering.length === 0
      ? [
          "No recorded living teammate with usable facing evidence was geometrically oriented toward the killer inside the assumed cone at that instant.",
        ]
      : []),
    ...(death.trade
      ? ["The recorded sequence supports immediate teammate follow-up."]
      : ["The recorded sequence does not show teammate follow-up within the five-second trade window."]),
  ]);
  return {
    matchId: detail.matchId,
    player: review.player,
    death,
    replay,
    teammates,
    snapshot,
    observedFacts,
    supportedInferences,
    limitations: unique([
      ...review.limitations,
      ...snapshot.warnings,
      ...replay.limitations,
      "Distances and facing are from one kill-event snapshot. Walls, elevation, smokes, flashes, nearsight, scoped FOV, comms, awareness, intent, and actual line of sight are unknown.",
    ]),
  };
}

function buildTimeline(detail: MatchDetail, round: MatchRoundDetail, focusPuuid: string | null): RoundTimelineEvent[] {
  const evidence = roundEvidence(detail, round.number);
  const ordered = [...evidence.events].sort(
    (left, right) => (left.timeInRoundMs ?? Number.MAX_SAFE_INTEGER) - (right.timeInRoundMs ?? Number.MAX_SAFE_INTEGER),
  );
  const roster = detail.teams.flatMap((team) => team.players);
  const alive = new Map(detail.teams.map((team) => [team.teamId, new Set(team.players.map(playerKey))]));
  const plantTime = evidence.events.find((event) => event.kind === "plant")?.timeInRoundMs ?? null;
  const killEvents = ordered.filter((event) => event.kind === "kill");
  const killCounts = new Map<string, number>();
  return ordered
    .map((event, index) => {
      const actor = refFromEvidence(event.actor, roster);
      const target = event.target ? refFromEvidence(event.target, roster) : null;
      const aliveBefore = aliveCounts(alive);
      const alivePlayerKeys = new Set([...alive.values()].flatMap((players) => [...players]));
      const tags: string[] = [];
      if (event.kind === "kill" && target) {
        const actorKey = playerRefKey(actor);
        const targetKey = playerRefKey(target);
        const actorAlive = teamSet(alive, actor.teamId);
        const targetAlive = teamSet(alive, target.teamId);
        if (!actorAlive.has(actorKey)) {
          actorAlive.add(actorKey);
          tags.push("returned-to-play-or-data-gap");
        }
        if (!targetAlive.has(targetKey)) tags.push("repeat-death-or-data-gap");
        targetAlive.delete(targetKey);
        const count = (killCounts.get(actorKey) ?? 0) + 1;
        killCounts.set(actorKey, count);
        if (count >= 2) tags.push(`${count}k`);
        if (killEvents[0]?.id === event.id) tags.push("opening-kill");
        if (focusPuuid && actor.puuid === focusPuuid) tags.push("focus-kill");
        if (focusPuuid && target.puuid === focusPuuid) tags.push("focus-death");
      }
      const aliveAfter = aliveCounts(alive);
      if (event.kind === "kill" && target) {
        const actorBefore = teamCount(aliveBefore, actor.teamId);
        const targetBefore = teamCount(aliveBefore, target.teamId);
        const actorAfter = teamCount(aliveAfter, actor.teamId);
        const targetAfter = teamCount(aliveAfter, target.teamId);
        if (actorBefore === targetBefore && actorAfter > targetAfter) tags.push("man-advantage-swing");
        if (actorBefore < targetBefore && actorAfter === targetAfter) tags.push("equalizer");
        if (killEvents.at(-1)?.id === event.id && /elimin/i.test(round.result ?? "")) tags.push("closing-kill");
      }
      if (event.kind === "plant") tags.push("site-plant");
      if (event.kind === "defuse") tags.push("retake-complete");
      const phase = eventPhase(event, index, ordered.length, plantTime, detail, round);
      if (phase === "post-plant") tags.push("post-plant");
      if (phase === "retake") tags.push("retake");
      const raw = event.kind === "kill" ? rawKillForEvidenceEvent(detail, event) : null;
      const actorLocation =
        raw?.playerLocations.find((location) =>
          sameIdentity(location.puuid, location.gameName, location.tagLine, actor),
        )?.location ?? null;
      return {
        id: event.id,
        order: index + 1,
        kind: event.kind,
        phase,
        timeInRoundMs: event.timeInRoundMs,
        actor,
        target,
        weaponName: event.weaponName,
        assistants: event.assistants,
        distanceMeters: event.distanceMeters,
        site: event.site,
        actorCallout: nearestMapCallout(detail.mapName, actorLocation),
        targetCallout: nearestMapCallout(detail.mapName, raw?.victimLocation ?? null),
        attention: raw && target ? buildAttentionSnapshot(detail, raw, actor, target, alivePlayerKeys) : null,
        aliveBefore,
        aliveAfter,
        tags,
        trade: null,
      };
    })
    .map((event, index, timeline) => {
      if (event.kind !== "kill" || !event.target) return event;
      const trade = timeline
        .slice(index + 1)
        .find(
          (candidate) =>
            candidate.kind === "kill" &&
            candidate.target &&
            samePlayerRefs(candidate.target, event.actor) &&
            sameTeam(candidate.actor.teamId ?? "", event.target!.teamId ?? "") &&
            candidate.timeInRoundMs !== null &&
            event.timeInRoundMs !== null &&
            candidate.timeInRoundMs - event.timeInRoundMs <= 5_000,
        );
      if (!trade || trade.timeInRoundMs === null || event.timeInRoundMs === null) return event;
      return {
        ...event,
        tags: [...event.tags, "traded"],
        trade: { eventId: trade.id, by: trade.actor, delayMs: trade.timeInRoundMs - event.timeInRoundMs },
      };
    });
}

function eventPhase(
  event: MatchRoundEvidenceAnalysis["rounds"][number]["events"][number],
  index: number,
  count: number,
  plantTime: number | null,
  detail: MatchDetail,
  round: MatchRoundDetail,
): RoundPhase {
  if (event.kind === "plant") return "pre-plant";
  if (event.kind === "defuse") return "retake";
  if (plantTime !== null && event.timeInRoundMs !== null && event.timeInRoundMs >= plantTime) {
    const initialAttacker = inferInitialAttackerTeam(detail);
    const actorSide = event.actor.teamId
      ? sideForRound(detail, event.actor.teamId, round.number, initialAttacker)
      : null;
    return actorSide === "defense" ? "retake" : "post-plant";
  }
  if (index === 0) return "opening";
  if (index >= Math.max(1, count - 2)) return "late-round";
  return "pre-plant";
}

function observedRoundFacts(
  detail: MatchDetail,
  round: MatchRoundDetail,
  score: RoundScoreState,
  timeline: RoundTimelineEvent[],
  focus: MatchPlayerDetail | null,
  focusOutcome: "win" | "loss" | "unknown",
  decisive: RoundTimelineEvent | null,
): string[] {
  const kills = timeline.filter((event) => event.kind === "kill");
  const opening = kills[0];
  const plant = timeline.find((event) => event.kind === "plant");
  const defuse = timeline.find((event) => event.kind === "defuse");
  const facts = [
    `Round ${round.number} started ${score.focusBeforeLabel ?? score.beforeLabel} and ended ${score.focusAfterLabel ?? score.afterLabel}.`,
    `${round.winningTeam ?? "Unknown team"} won${round.result ? ` by ${round.result}` : ""}.`,
    `${kills.length} kills were recorded.`,
  ];
  if (opening?.target)
    facts.push(
      `Opening duel: ${opening.actor.riotId} killed ${opening.target.riotId} at ${formatTime(opening.timeInRoundMs)}.`,
    );
  if (plant)
    facts.push(
      `Spike plant: ${plant.actor.riotId}${plant.site ? ` at ${plant.site}` : ""} at ${formatTime(plant.timeInRoundMs)}.`,
    );
  if (defuse)
    facts.push(
      `Defuse: ${defuse.actor.riotId}${defuse.site ? ` at ${defuse.site}` : ""} at ${formatTime(defuse.timeInRoundMs)}.`,
    );
  if (decisive?.target)
    facts.push(
      `Closing event: ${decisive.actor.riotId} killed ${decisive.target.riotId} with ${decisive.weaponName ?? "an unknown weapon"}.`,
    );
  if (focus)
    facts.push(
      `${riotId(focus.gameName, focus.tagLine)} (${focus.agentName ?? "agent unknown"}) ${focusOutcome === "win" ? "won" : focusOutcome === "loss" ? "lost" : "has an unknown result for"} the round.`,
    );
  if (!detail.mapName) facts.push("Map identity is unavailable.");
  return facts;
}

function roundInferences(
  detail: MatchDetail,
  round: MatchRoundDetail,
  timeline: RoundTimelineEvent[],
  focus: MatchPlayerDetail | null,
  focusOutcome: "win" | "loss" | "unknown",
): string[] {
  const kills = timeline.filter((event) => event.kind === "kill");
  const opening = kills[0];
  const plant = timeline.find((event) => event.kind === "plant");
  const winner = round.winningTeam;
  const inferences: string[] = [];
  if (opening?.actor.teamId && winner) {
    inferences.push(
      sameTeam(opening.actor.teamId, winner)
        ? `${winner} converted the recorded opening man advantage into the round win.`
        : `${winner} recovered after losing the recorded opening duel.`,
    );
  }
  if (plant) {
    const prePlantKills = kills.filter(
      (event) =>
        event.timeInRoundMs !== null && plant.timeInRoundMs !== null && event.timeInRoundMs < plant.timeInRoundMs,
    );
    inferences.push(
      `The attackers completed a plant${plant.site ? ` at ${plant.site}` : ""} after ${prePlantKills.length} recorded pre-plant kills; this supports that site access was achieved, but not which path, utility, or call caused it.`,
    );
    if (/defus/i.test(round.result ?? "")) inferences.push("The defenders completed the retake and defuse.");
    else if (winner) inferences.push(`${winner} closed the post-plant or elimination sequence.`);
    const plantRegion = plant.site?.trim().toLocaleLowerCase() ?? null;
    const accessKill = kills.find(
      (event) =>
        event.targetCallout &&
        plantRegion &&
        event.targetCallout.superRegion.trim().toLocaleLowerCase() === plantRegion &&
        !event.trade &&
        event.timeInRoundMs !== null &&
        plant.timeInRoundMs !== null &&
        event.timeInRoundMs < plant.timeInRoundMs,
    );
    if (accessKill?.target) {
      inferences.push(
        `${accessKill.actor.riotId}'s untraded kill on ${accessKill.target.riotId} near ${accessKill.targetCallout!.name} preceded the ${plant.site} plant, so it plausibly contributed to site access. The feed does not prove the exact path, utility sequence, or sightline responsibility.`,
      );
    }
  }
  if (focus && focusOutcome === "loss") {
    const deaths = kills.filter((event) => event.target && samePlayerRef(event.target, focus));
    const untraded = deaths.filter((event) => !event.trade);
    if (deaths.length)
      inferences.push(
        `${focus.agentName ?? focus.gameName} died ${deaths.length} time${deaths.length === 1 ? "" : "s"}; ${untraded.length} death${untraded.length === 1 ? " was" : "s were"} not traded within five seconds.`,
      );
  }
  if (focus) {
    const focusDeaths = kills.filter((event) => event.target && samePlayerRef(event.target, focus));
    for (const death of focusDeaths.slice(0, 3)) {
      const attention = death.attention;
      if (!attention) continue;
      const victimFacing = attention.victimToKiller;
      if (victimFacing?.angleDeltaDegrees !== null && victimFacing?.angleDeltaDegrees !== undefined) {
        inferences.push(
          `${focus.agentName ?? focus.gameName}'s recorded facing was ${Math.round(victimFacing.angleDeltaDegrees)}° from the killer bearing at ${death.id} (${victimFacing.alignment}). This is geometric orientation, not proof of visibility.`,
        );
      }
      inferences.push(`${death.id}: ${attention.geometricSummary}`);
      if (attention.potentialCrossfire === true)
        inferences.push(
          `${death.id}: the victim and at least one living teammate geometrically covered the killer, which is potential crossfire/trade support; obstruction and player state remain unknown.`,
        );
    }
  }
  return inferences;
}

function deathMoment(
  index: number,
  event: RoundTimelineEvent & { target: PlayerRef },
  intelligence: RoundIntelligence,
): DeathMoment {
  const focusTeam = event.target.teamId;
  const outcome =
    !focusTeam || !intelligence.winner.teamId
      ? "unknown"
      : sameTeam(focusTeam, intelligence.winner.teamId)
        ? "win"
        : "loss";
  const impact: string[] = [];
  if (event.tags.includes("opening-kill")) impact.push("opening death conceded the first man disadvantage");
  if (event.trade) impact.push(`traded by ${event.trade.by.riotId} after ${(event.trade.delayMs / 1_000).toFixed(1)}s`);
  else impact.push("not traded within 5.0s");
  if (teamCount(event.aliveBefore, focusTeam) === 1) impact.push("last survivor eliminated");
  if (event.tags.includes("man-advantage-swing")) impact.push("death created a man advantage for the opponent");
  if (event.phase === "post-plant" || event.phase === "retake") impact.push(`${event.phase} death`);
  if (event.tags.includes("closing-kill")) impact.push("round-closing death");
  const explanation = `${event.target.riotId} died to ${event.actor.riotId}'s ${event.weaponName ?? "unknown weapon"} at ${formatTime(event.timeInRoundMs)}${event.distanceMeters !== null ? ` from ${Math.round(event.distanceMeters)}m` : ""}. ${impact.join("; ")}. Their team ${outcome === "win" ? "still won" : outcome === "loss" ? "lost" : "has an unknown outcome for"} the round.`;
  return {
    index,
    roundNumber: intelligence.roundNumber,
    scoreBefore: intelligence.score.focusBeforeLabel ?? intelligence.score.beforeLabel,
    scoreAfter: intelligence.score.focusAfterLabel ?? intelligence.score.afterLabel,
    eventId: event.id,
    phase: event.phase,
    timeInRoundMs: event.timeInRoundMs,
    killer: event.actor,
    victim: event.target,
    weaponName: event.weaponName,
    distanceMeters: event.distanceMeters,
    killerCallout: event.actorCallout,
    victimCallout: event.targetCallout,
    trade: event.trade,
    focusTeamOutcome: outcome,
    aliveBefore: event.aliveBefore,
    aliveAfter: event.aliveAfter,
    impact,
    attention: event.attention,
    explanation,
  };
}

function deathSentence(event: RoundTimelineEvent & { target: PlayerRef }, intelligence: RoundIntelligence): string {
  const death = deathMoment(1, event, intelligence);
  return death.explanation;
}

function humanKillLabel(event: RoundTimelineEvent & { target: PlayerRef }, number: number): string {
  return `Kill ${number}: ${event.actor.agentName ?? event.actor.gameName} killed ${event.target.agentName ?? event.target.gameName} at ${formatTime(event.timeInRoundMs)}`;
}

function decisiveRoundEvent(round: MatchRoundDetail, timeline: RoundTimelineEvent[]): RoundTimelineEvent | null {
  if (/defus/i.test(round.result ?? ""))
    return [...timeline].reverse().find((event) => event.kind === "defuse") ?? timeline.at(-1) ?? null;
  return timeline.at(-1) ?? null;
}

function evidenceLimitations(timeline: RoundTimelineEvent[]): string[] {
  const kills = timeline.filter((event) => event.kind === "kill");
  const positioned = kills.filter((event) => event.distanceMeters !== null).length;
  const limits = [
    "Events are discrete snapshots, not continuous movement, POV, comms, intent, or crosshair placement.",
  ];
  if (positioned < kills.length)
    limits.push(`${kills.length - positioned}/${kills.length} kill events lack complete killer-victim coordinates.`);
  if (
    timeline.some(
      (event) => event.tags.includes("repeat-death-or-data-gap") || event.tags.includes("returned-to-play-or-data-gap"),
    )
  )
    limits.push(
      "A player reappeared after a recorded death; this may reflect a revive or a provider data gap, so the tool does not guess which.",
    );
  return limits;
}

function roundByNumber(detail: MatchDetail, roundNumber: number): MatchRoundDetail {
  const round = detail.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round)
    throw new ValorantInputError(
      `Round ${roundNumber} is unavailable. Available rounds: ${detail.rounds.map((candidate) => candidate.number).join(", ")}`,
    );
  return round;
}

function roundEvidence(detail: MatchDetail, roundNumber: number): MatchRoundEvidenceAnalysis["rounds"][number] {
  const round = detail.roundEvidence?.rounds.find((candidate) => candidate.roundNumber === roundNumber);
  if (!round) throw new ValorantInputError(`Round ${roundNumber} has no event evidence`);
  return round;
}

function rawKillForTimelineEvent(detail: MatchDetail, event: RoundTimelineEvent): MatchKillEvent | null {
  return (
    detail.killEvents.find(
      (candidate) =>
        killRoundNumber(detail, candidate) === Number(event.id.match(/^r(\d+)-/)?.[1]) &&
        candidate.timeInRoundMs === event.timeInRoundMs &&
        sameIdentity(candidate.killerPuuid, candidate.killerName, candidate.killerTag, event.actor) &&
        event.target !== null &&
        sameIdentity(candidate.victimPuuid, candidate.victimName, candidate.victimTag, event.target),
    ) ?? null
  );
}

function rawKillForEvidenceEvent(
  detail: MatchDetail,
  event: MatchRoundEvidenceAnalysis["rounds"][number]["events"][number],
): MatchKillEvent | null {
  if (event.kind !== "kill" || !event.target) return null;
  return (
    detail.killEvents.find(
      (candidate) =>
        killRoundNumber(detail, candidate) === Number(event.id.match(/^r(\d+)-/)?.[1]) &&
        candidate.timeInRoundMs === event.timeInRoundMs &&
        sameIdentity(candidate.killerPuuid, candidate.killerName, candidate.killerTag, event.actor) &&
        sameIdentity(candidate.victimPuuid, candidate.victimName, candidate.victimTag, event.target!),
    ) ?? null
  );
}

function refFromEvidence(
  input: { puuid: string | null; gameName: string; tagLine: string | null; teamId: string | null },
  roster: MatchPlayerDetail[],
): PlayerRef {
  const player = roster.find((candidate) =>
    sameIdentity(candidate.puuid, candidate.gameName, candidate.tagLine, input),
  );
  return {
    puuid: input.puuid,
    riotId: riotId(input.gameName, input.tagLine),
    gameName: input.gameName,
    tagLine: input.tagLine,
    teamId: input.teamId,
    agentName: player?.agentName ?? null,
  };
}

function playerRef(player: MatchPlayerDetail): PlayerRef {
  return {
    puuid: player.puuid,
    riotId: riotId(player.gameName, player.tagLine),
    gameName: player.gameName,
    tagLine: player.tagLine,
    teamId: player.teamId,
    agentName: player.agentName,
  };
}

function parseScore(value: string | undefined): [number, number] | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2})\s*[-:–]\s*(\d{1,2})$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function scoreMatches(
  state: RoundScoreState,
  score: [number, number],
  timing: "before" | "after",
  focusPerspective: boolean,
): boolean {
  const label = focusPerspective
    ? timing === "before"
      ? state.focusBeforeLabel
      : state.focusAfterLabel
    : timing === "before"
      ? state.beforeLabel
      : state.afterLabel;
  return label === `${score[0]}-${score[1]}`;
}

function scoreLabel(order: string[], score: Record<string, number>): string {
  return `${score[order[0]!] ?? 0}-${score[order[1]!] ?? 0}`;
}

function perspectiveScoreLabel(order: string[], score: Record<string, number>, focusTeam: string): string {
  const focus = order.find((teamId) => sameTeam(teamId, focusTeam)) ?? focusTeam;
  const opponent = order.find((teamId) => !sameTeam(teamId, focus)) ?? order[1]!;
  return `${score[focus] ?? 0}-${score[opponent] ?? 0}`;
}

function aliveCounts(alive: Map<string, Set<string>>): Record<string, number> {
  return Object.fromEntries([...alive].map(([teamId, players]) => [teamId, players.size]));
}

function teamSet(alive: Map<string, Set<string>>, teamId: string | null): Set<string> {
  const key = [...alive.keys()].find((candidate) => sameTeam(candidate, teamId ?? "")) ?? teamId ?? "unknown";
  const existing = alive.get(key);
  if (existing) return existing;
  const created = new Set<string>();
  alive.set(key, created);
  return created;
}

function teamCount(counts: Record<string, number>, teamId: string | null): number {
  const key = Object.keys(counts).find((candidate) => sameTeam(candidate, teamId ?? ""));
  return key ? (counts[key] ?? 0) : 0;
}

function teamForPuuid(detail: MatchDetail, puuid: string): string | null {
  return detail.teams.flatMap((team) => team.players).find((player) => player.puuid === puuid)?.teamId ?? null;
}

function playerKey(player: MatchPlayerDetail): string {
  return player.puuid ?? riotId(player.gameName, player.tagLine);
}
function playerRefKey(player: PlayerRef): string {
  return player.puuid ?? player.riotId;
}
function riotId(name: string, tag: string | null): string {
  return tag ? `${name}#${tag}` : name;
}
function sameTeam(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
function samePlayerRefs(left: PlayerRef, right: PlayerRef): boolean {
  return left.puuid && right.puuid
    ? left.puuid === right.puuid
    : left.riotId.toLocaleLowerCase() === right.riotId.toLocaleLowerCase();
}
function samePlayerRef(left: PlayerRef, right: MatchPlayerDetail): boolean {
  return left.puuid && right.puuid
    ? left.puuid === right.puuid
    : left.riotId.toLocaleLowerCase() === riotId(right.gameName, right.tagLine).toLocaleLowerCase();
}
function sameIdentity(
  puuid: string | null,
  name: string,
  tag: string | null,
  right: { puuid: string | null; gameName: string; tagLine: string | null },
): boolean {
  return puuid && right.puuid
    ? puuid === right.puuid
    : riotId(name, tag).toLocaleLowerCase() === riotId(right.gameName, right.tagLine).toLocaleLowerCase();
}
function formatTime(value: number | null): string {
  return value === null
    ? "unknown time"
    : `${Math.floor(value / 60_000)}:${String(Math.floor((value % 60_000) / 1_000)).padStart(2, "0")}`;
}
function uniqueEvents(events: Array<RoundTimelineEvent | null>): RoundTimelineEvent[] {
  const seen = new Set<string>();
  return events.filter(
    (event): event is RoundTimelineEvent => Boolean(event) && !seen.has(event!.id) && Boolean(seen.add(event!.id)),
  );
}
function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
