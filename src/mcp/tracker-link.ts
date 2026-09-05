import { ValorantInputError } from "./errors";
export type ParsedTrackerProfileInput = {
  player: string;
  source: "direct" | "tracker-profile";
  platform: "pc" | "console" | null;
  playlist: string | null;
  season: string | null;
};

export type ParsedTrackerMatchInput = {
  matchId: string;
  source: "direct" | "tracker-match";
};

const trackerHosts = new Set(["tracker.gg", "www.tracker.gg"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTrackerProfileInput(input: string): ParsedTrackerProfileInput {
  const normalized = normalizeInput(input);
  const url = parseInputUrl(normalized);
  if (!url) return { player: normalized, source: "direct", platform: null, playlist: null, season: null };
  assertTrackerUrl(url);
  const segments = pathSegments(url);
  if (
    segments[0]?.toLocaleLowerCase() !== "valorant" ||
    segments[1]?.toLocaleLowerCase() !== "profile" ||
    segments[2]?.toLocaleLowerCase() !== "riot" ||
    !segments[3]
  ) {
    throw new ValorantInputError("Tracker profile URL must use /valorant/profile/riot/<Name%23TAG>/...");
  }
  const player = decodeSegment(segments[3], "Tracker Riot ID").trim();
  if (!player.includes("#"))
    throw new ValorantInputError("Tracker profile URL does not contain a complete Name#TAG Riot ID");
  const rawPlatform = url.searchParams.get("platform")?.trim().toLocaleLowerCase() ?? null;
  const platform = rawPlatform === "pc" || rawPlatform === "console" ? rawPlatform : null;
  const playlist = boundedHint(url.searchParams.get("playlist"));
  const season = boundedHint(url.searchParams.get("season"));
  return { player, source: "tracker-profile", platform, playlist, season };
}

export function parseTrackerMatchInput(input: string): ParsedTrackerMatchInput {
  const normalized = normalizeInput(input);
  const url = parseInputUrl(normalized);
  if (!url) return { matchId: normalized, source: "direct" };
  assertTrackerUrl(url);
  const segments = pathSegments(url);
  if (segments[0]?.toLocaleLowerCase() !== "valorant" || segments[1]?.toLocaleLowerCase() !== "match" || !segments[2]) {
    throw new ValorantInputError("Tracker match URL must use /valorant/match/<match-id>");
  }
  const matchId = decodeSegment(segments[2], "Tracker match ID").trim().toLocaleLowerCase();
  if (!uuidPattern.test(matchId))
    throw new ValorantInputError("Tracker match URL does not contain a valid Valorant match UUID");
  return { matchId, source: "tracker-match" };
}

function normalizeInput(input: string): string {
  const trimmed = input.trim().replace(/^<|>$/g, "").replace(/\\&/g, "&");
  if (!trimmed) throw new ValorantInputError("Player or match input is required");
  return trimmed;
}

function parseInputUrl(input: string): URL | null {
  if (!/^https?:\/\//i.test(input)) return null;
  try {
    return new URL(input);
  } catch {
    throw new ValorantInputError("The supplied Tracker.gg URL is malformed");
  }
}

function assertTrackerUrl(url: URL): void {
  if (url.protocol !== "https:" || !trackerHosts.has(url.hostname.toLocaleLowerCase())) {
    throw new ValorantInputError("Only HTTPS tracker.gg Valorant profile or match links are accepted");
  }
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function decodeSegment(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ValorantInputError(`${label} contains invalid URL encoding`);
  }
}

function boundedHint(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= 80 ? normalized : null;
}
