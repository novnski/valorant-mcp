import { ProviderTransport, ProviderTransportError } from "./provider-transport";
import { stratsCatalog, stratsGroups, stratsLineup } from "./provider-validation";
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

export type StratsFailureCode = import("./provider-transport").ProviderFailure;

export class StratsApiError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number | null,
    readonly code: StratsFailureCode,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = "StratsApiError";
    this.retryable = code === "rate-limited" || code === "unavailable" || code === "upstream-failure";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class StratsClient {
  private readonly baseUrl = "https://api.strats.gg/internal/api/v1";
  private readonly transport: ProviderTransport;

  constructor(
    private readonly requestsPerMinute = 60,
    fetcher?: Fetcher,
  ) {
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 300) {
      throw new Error("requestsPerMinute must be an integer between 1 and 300");
    }
    this.transport = new ProviderTransport("strats.gg", Math.ceil(60_000 / requestsPerMinute), fetcher);
  }

  async listMaps(): Promise<StratsMap[]> {
    return this.validated<StratsMap[]>("/games/valorant/maps", stratsCatalog);
  }

  async listCharacters(): Promise<StratsCharacter[]> {
    return this.validated<StratsCharacter[]>("/games/valorant/characters", stratsCatalog);
  }

  async listGroupedLineups(mapSourceId: string, characterId: string): Promise<StratsGroup[]> {
    const path = `/games/valorant/map_sources/${encodeURIComponent(mapSourceId)}/characters/${encodeURIComponent(characterId)}/lineups/grouped`;
    return this.validated<StratsGroup[]>(path, stratsGroups);
  }

  async getLineup(lineupId: string): Promise<StratsLineup> {
    const lineup = await this.validated<StratsLineup>(`/lineups/${encodeURIComponent(lineupId)}`, stratsLineup);
    if (!lineup || typeof lineup !== "object" || !lineup.id) {
      throw new StratsApiError(
        `Strats.gg returned an unexpected payload for lineup ${lineupId}`,
        null,
        "invalid-payload",
      );
    }
    return lineup;
  }

  private async validated<T>(
    path: string,
    schema: { safeParse: (value: unknown) => { success: boolean } },
  ): Promise<T> {
    try {
      const body = await this.transport.json(`${this.baseUrl}${path}`, { Accept: "application/json" });
      if (!schema.safeParse(body).success) throw new StratsApiError("Invalid Strats.gg fields", 200, "invalid-payload");
      return body as T;
    } catch (error) {
      if (error instanceof ProviderTransportError)
        throw new StratsApiError("Strats.gg request failed", error.status, error.code, error.retryAt);
      throw error;
    }
  }
}
