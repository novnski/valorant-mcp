import { MatchCacheError } from "../cache/match-cache";
import { HenrikApiError } from "./henrik-client";
import { StratsApiError } from "./strats-client";

/** Deliberately safe, actionable feedback about a user's selection. */
export class ValorantInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValorantInputError";
  }
}

export function actionableError(error: unknown): string {
  if (error instanceof HenrikApiError) {
    if (error.code === "invalid-config")
      return "HENRIK_REQUESTS_PER_MINUTE must be an integer between 1 and 300. Correct it in your server environment and restart the client.";
    if (error.code === "missing-config")
      return "Set HENRIK_API_KEY in the server environment or load a private .env file with Bun's --env-file flag, then restart your MCP client. Get a key at https://api.henrikdev.xyz/dashboard/.";
    if (error.code === "rate-limited")
      return `Henrik rate limit reached.${error.retryAt ? ` Retry after ${error.retryAt}.` : " Wait before retrying."}`;
    if (error.code === "not-found")
      return "Henrik could not find that player or match. Verify the Riot ID/PUUID, shard, platform, and match_id.";
    if (error.status === 401 || error.status === 403)
      return "Henrik rejected HENRIK_API_KEY. Check the key and its access in the Henrik dashboard, then restart your MCP client.";
    return `Henrik request failed (${error.code}). Verify the player identifier, shard, platform, and API availability.`;
  }
  if (error instanceof StratsApiError) {
    if (error.code === "not-found")
      return "Strats.gg could not find that lineup, map source, or character. Verify the lineup id and map/agent names.";
    return "The Strats.gg lineup API is unavailable. Verify the lineup id and try again later.";
  }
  if (error instanceof MatchCacheError)
    return "The local match cache could not be read or written. Check available disk space and permissions, or set VALORANT_MATCH_CACHE_PATH to a writable file path.";
  if (error instanceof ValorantInputError) return error.message.slice(0, 4_000);
  return "Valorant analysis failed unexpectedly. Retry with an exact match ID and a narrower round or player selection. If it persists, report the tool name and steps at https://github.com/novnski/valorant-mcp/issues; omit credentials and private match data.";
}
