type UnknownRecord = Record<string, unknown>;

const TRADE_WINDOW_MS = 5_000;

export function derivePlayerKast(raw: unknown, puuid: string, scoredRoundCount: number | null = null): number | null {
  if (!isRecord(raw) || !puuid) {
    return null;
  }

  const rounds = valueAt(raw, ["rounds"]);
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return null;
  }

  const visibleRounds = rounds
    .map((round, index) => (isRecord(round) ? { round, index } : null))
    .filter((entry): entry is { round: UnknownRecord; index: number } => entry !== null)
    .slice(0, scoredRoundCount !== null && scoredRoundCount > 0 ? scoredRoundCount : undefined);

  if (visibleRounds.length === 0) {
    return null;
  }

  const playerTeam = teamForPlayer(raw, puuid);
  let kastRounds = 0;

  for (const { round, index } of visibleRounds) {
    const eventRound = rawEventRound(round, index);
    const events = killEventsForRound(raw, eventRound);
    const roundStats = roundStatForPlayer(round, puuid);
    const kills = numberAt(roundStats, ["stats", "kills"]) ?? numberAt(roundStats, ["kills"]) ?? 0;
    const assists = numberAt(roundStats, ["stats", "assists"]) ?? numberAt(roundStats, ["assists"]) ?? 0;
    const killed = kills > 0 || events.some((event) => playerPuuid(event, "killer") === puuid);
    const assisted = assists > 0 || events.some((event) => assistantsInclude(event, puuid));
    const deaths = events.filter((event) => playerPuuid(event, "victim") === puuid);
    const survived = deaths.length === 0;
    const traded = deaths.some((death) => deathWasTraded(raw, events, death, playerTeam));

    if (killed || assisted || survived || traded) {
      kastRounds += 1;
    }
  }

  return kastRounds / visibleRounds.length;
}

function rawEventRound(round: UnknownRecord, index: number): number {
  return numberAt(round, ["round"]) ?? numberAt(round, ["round_num"]) ?? numberAt(round, ["id"]) ?? index;
}

function roundStatForPlayer(round: UnknownRecord, puuid: string): UnknownRecord | null {
  const stats = valueAt(round, ["stats"]);
  if (!Array.isArray(stats)) {
    return null;
  }

  return (
    (stats.find((row) => {
      if (!isRecord(row)) {
        return false;
      }
      return stringAt(valueAt(row, ["player"]), ["puuid"]) === puuid || stringAt(row, ["puuid"]) === puuid;
    }) as UnknownRecord | undefined) ?? null
  );
}

function assistantsInclude(event: UnknownRecord, puuid: string): boolean {
  const assistants = valueAt(event, ["assistants"]);
  return (
    Array.isArray(assistants) &&
    assistants.some((assistant) => {
      if (typeof assistant === "string") {
        return assistant === puuid;
      }
      return (
        isRecord(assistant) &&
        (stringAt(assistant, ["puuid"]) === puuid ||
          stringAt(assistant, ["subject"]) === puuid ||
          stringAt(valueAt(assistant, ["account"]), ["puuid"]) === puuid)
      );
    })
  );
}

function deathWasTraded(
  raw: UnknownRecord,
  events: UnknownRecord[],
  death: UnknownRecord,
  playerTeam: string | null,
): boolean {
  if (!playerTeam) {
    return false;
  }

  const killerPuuid = playerPuuid(death, "killer");
  if (!killerPuuid) {
    return false;
  }

  const deathTime = eventTime(death);
  return events.some((event) => {
    if (playerPuuid(event, "victim") !== killerPuuid) {
      return false;
    }

    const tradingPuuid = playerPuuid(event, "killer");
    const tradingTeam = playerTeamAt(event, "killer") ?? (tradingPuuid ? teamForPlayer(raw, tradingPuuid) : null);
    if (!tradingTeam || tradingTeam.toLowerCase() !== playerTeam.toLowerCase()) {
      return false;
    }

    const tradeTime = eventTime(event);
    return (
      deathTime === null || tradeTime === null || (tradeTime >= deathTime && tradeTime - deathTime <= TRADE_WINDOW_MS)
    );
  });
}

function killEventsForRound(raw: UnknownRecord, round: number): UnknownRecord[] {
  const kills = valueAt(raw, ["kills"]);
  if (!Array.isArray(kills)) {
    return [];
  }
  return kills.filter(
    (kill) => isRecord(kill) && (numberAt(kill, ["round"]) ?? numberAt(kill, ["round_num"])) === round,
  );
}

function teamForPlayer(raw: UnknownRecord, puuid: string): string | null {
  const players =
    valueAt(raw, ["players", "all_players"]) ?? valueAt(raw, ["players"]) ?? valueAt(raw, ["data", "players"]);
  const candidates = Array.isArray(players)
    ? players
    : isRecord(players)
      ? Object.values(players).flatMap((value) => (Array.isArray(value) ? value : []))
      : [];
  const player = candidates.find(
    (candidate) =>
      isRecord(candidate) &&
      (stringAt(candidate, ["puuid"]) === puuid ||
        stringAt(candidate, ["subject"]) === puuid ||
        stringAt(valueAt(candidate, ["account"]), ["puuid"]) === puuid),
  );
  return stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]) ?? null;
}

function playerPuuid(event: UnknownRecord, role: "killer" | "victim"): string | null {
  const player = valueAt(event, [role]);
  return (
    stringAt(player, ["puuid"]) ?? stringAt(player, ["subject"]) ?? stringAt(valueAt(player, ["account"]), ["puuid"])
  );
}

function playerTeamAt(event: UnknownRecord, role: "killer" | "victim"): string | null {
  const player = valueAt(event, [role]);
  return stringAt(player, ["team_id"]) ?? stringAt(player, ["team"]);
}

function eventTime(event: UnknownRecord): number | null {
  return numberAt(event, ["time_in_round_in_ms"]) ?? numberAt(event, ["time_in_round_ms"]);
}

function stringAt(source: unknown, path: string[]): string | null {
  const value = valueAt(source, path);
  return typeof value === "string" && value.trim() ? value : null;
}

function numberAt(source: unknown, path: string[]): number | null {
  const value = valueAt(source, path);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valueAt(source: unknown, path: string[]): unknown {
  let cursor = source;
  for (const key of path) {
    if (!isRecord(cursor)) {
      return null;
    }
    cursor = cursor[key];
  }
  return cursor;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
