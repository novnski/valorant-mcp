// Strats.gg open lineups API client. Read-only, no key, light pacing.
// The Strats.gg lineup tool exposes a public JSON API under /internal/api/v1
// for maps, characters, and per-map-source per-character lineups.

export type StratsUtility = {
  id: string;
  name: string;
  icon_url: string | null;
};

export type StratsCharacter = {
  id: string;
  name: string;
  description: string | null;
  utilities: StratsUtility[] | null;
};

export type StratsMapSource = {
  id: string;
  source_url: string | null;
  overview: string | null; // "attacker" | "defender"
};

export type StratsMap = {
  id: string;
  name: string;
  description: string | null;
  full_image_url: string | null;
  thumb_image_url: string | null;
  map_sources: StratsMapSource[] | null;
};

export type StratsPoint = {
  left: number;
  top: number;
};

export type StratsLineup = {
  id: string;
  name: string | null;
  title: string | null;
  description: string | null;
  status: string | null;
  video_url: string | null;
  image_url: string | null;
  level: string | null;
  views: number;
  left: number | null;
  top: number | null;
  liked: number | null;
  disliked: number | null;
  favorite: boolean | null;
  points: StratsPoint[] | null;
  utility: StratsUtility | null;
  character: Pick<StratsCharacter, "id" | "name"> | null;
  map_source: StratsMapSource | null;
  map_id: string | null;
  map_name: string | null;
  posted_at: string | null;
};

export type StratsGroup = {
  point: StratsPoint | null;
  lineups: StratsLineup[] | null;
};

export type StratsFailureCode = "not-found" | "invalid-payload" | "unavailable" | "upstream-failure";

export class StratsApiError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number | null,
    readonly code: StratsFailureCode,
  ) {
    super(message);
    this.name = "StratsApiError";
    this.retryable = code === "unavailable" || code === "upstream-failure";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class StratsClient {
  private readonly baseUrl = "https://api.strats.gg/internal/api/v1";
  private readonly timeoutMs = 12_000;
  private readonly fetcher: Fetcher;
  private nextRequestAt = 0;
  private throttleChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly requestsPerMinute = 60,
    fetcher?: Fetcher,
  ) {
    this.fetcher = fetcher ?? fetch;
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 300) {
      throw new Error("requestsPerMinute must be an integer between 1 and 300");
    }
  }

  async listMaps(): Promise<StratsMap[]> {
    return this.get<StratsMap[]>("/games/valorant/maps");
  }

  async listCharacters(): Promise<StratsCharacter[]> {
    return this.get<StratsCharacter[]>("/games/valorant/characters");
  }

  async listGroupedLineups(mapSourceId: string, characterId: string): Promise<StratsGroup[]> {
    const path = `/games/valorant/map_sources/${encodeURIComponent(mapSourceId)}/characters/${encodeURIComponent(characterId)}/lineups/grouped`;
    return this.get<StratsGroup[]>(path);
  }

  async getLineup(lineupId: string): Promise<StratsLineup> {
    const lineup = await this.get<StratsLineup>(`/lineups/${encodeURIComponent(lineupId)}`);
    if (!lineup || typeof lineup !== "object" || !lineup.id) {
      throw new StratsApiError(
        `Strats.gg returned an unexpected payload for lineup ${lineupId}`,
        null,
        "invalid-payload",
      );
    }
    return lineup;
  }

  private async get<T>(path: string): Promise<T> {
    await this.throttle();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new StratsApiError("Strats.gg lineup request timed out or was unavailable", null, "unavailable");
    }

    let body: T;
    try {
      body = (await response.json()) as T;
    } catch {
      throw new StratsApiError("Strats.gg returned a non-JSON response", response.status, "invalid-payload");
    }
    if (!response.ok) {
      const message = `Strats.gg request failed with HTTP ${response.status}`;
      throw new StratsApiError(message, response.status, classify(response.status));
    }
    return body;
  }

  private async throttle(): Promise<void> {
    const intervalMs = Math.ceil(60_000 / this.requestsPerMinute);
    const turn = this.throttleChain.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - Date.now());
      if (waitMs) await Bun.sleep(waitMs);
      this.nextRequestAt = Date.now() + intervalMs;
    });
    this.throttleChain = turn.catch(() => undefined);
    await turn;
  }
}

function classify(status: number): StratsFailureCode {
  if (status === 404) return "not-found";
  if (status >= 500) return "upstream-failure";
  return "invalid-payload";
}
