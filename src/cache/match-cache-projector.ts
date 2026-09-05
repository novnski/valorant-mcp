import { createHash } from "node:crypto";

import type { MatchDetail } from "../domain/types";

type UnknownRecord = Record<string, unknown>;

const sensitiveKey =
  /(?:authorization|cookie|ssid|password|access.?token|entitlement.?token|refresh.?token|client.?secret|session.?token|api.?key)/i;

export function scrubSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSensitive);
  if (!isRecord(value)) return value;
  const result: UnknownRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue;
    result[key] = scrubSensitive(entry);
  }
  return result;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function matchCompletenessScore(detail: MatchDetail): number {
  const players = detail.teams.reduce((count, team) => count + team.players.length, 0);
  const rounds = detail.rounds.length;
  const kills = detail.killEvents.length;
  const positionedKills = detail.killEvents.filter(
    (event) => event.victimLocation || event.playerLocations.length,
  ).length;
  const roundPlayers = detail.rounds.reduce((count, round) => count + round.playerStats.length, 0);
  const objectives = detail.rounds.filter((round) => round.spikePlant || round.spikeDefuse).length;
  return players * 10 + rounds * 10 + Math.min(kills, 500) + positionedKills * 2 + roundPlayers + objectives * 3;
}

export function baseMatchProjection(detail: MatchDetail): MatchDetail {
  const {
    analysis: _analysis,
    performance: _performance,
    economy: _economy,
    duels: _duels,
    roundEvidence: _roundEvidence,
    coaching: _coaching,
    ...base
  } = detail;
  return { ...base, source: "cache" };
}

export function matchPayloadId(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const metadata = isRecord(raw.metadata) ? raw.metadata : null;
  const meta = isRecord(raw.meta) ? raw.meta : null;
  for (const value of [metadata?.match_id, metadata?.matchid, meta?.id, raw.match_id, raw.matchId]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
