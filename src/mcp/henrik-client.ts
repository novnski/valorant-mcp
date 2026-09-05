import { ProviderTransport, ProviderTransportError } from "./provider-transport";
import { accountPayload, matchPayload, rankPayload } from "./provider-validation";
export type HenrikAccount = {
  puuid: string;
  region?: string;
  account_level?: number;
  name: string;
  tag: string;
  card?: string;
  title?: string;
  platforms?: string[];
  updated_at?: string;
};

type HenrikEnvelope<T> = {
  status: number;
  data?: T;
  errors?: Array<{ message?: string; code?: number }>;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type HenrikFailureCode =
  | "cancelled"
  | "missing-config"
  | "invalid-config"
  | "not-found"
  | "rate-limited"
  | "unauthorized"
  | "invalid-payload"
  | "unavailable"
  | "upstream-failure";

export class HenrikApiError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number | null,
    readonly code: HenrikFailureCode,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = "HenrikApiError";
    this.retryable = code === "rate-limited" || code === "unavailable" || code === "upstream-failure";
  }
}

export class HenrikClient {
  private readonly baseUrl = "https://api.henrikdev.xyz";
  private readonly transport: ProviderTransport;

  constructor(
    private readonly apiKey: string,
    private readonly requestsPerMinute = 30,
    fetchImpl: Fetcher = fetch,
    options: { timeoutMs?: number } = {},
  ) {
    if (!apiKey.trim()) throw new HenrikApiError("HENRIK_API_KEY is required", null, "missing-config");
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 300) {
      throw new HenrikApiError(
        "HENRIK_REQUESTS_PER_MINUTE must be an integer between 1 and 300",
        null,
        "invalid-config",
      );
    }
    this.transport = new ProviderTransport(
      "henrik",
      Math.ceil(60_000 / requestsPerMinute),
      fetchImpl,
      options.timeoutMs,
    );
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): HenrikClient {
    const apiKey = env.HENRIK_API_KEY?.trim() || "";
    const configuredRpm = Number(env.HENRIK_REQUESTS_PER_MINUTE ?? "30");
    return new HenrikClient(apiKey, configuredRpm);
  }

  async getAccountByRiotId(name: string, tag: string): Promise<HenrikAccount> {
    const envelope = await this.get<HenrikAccount>(
      `/valorant/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    );
    if (!envelope.data)
      throw new HenrikApiError(`No Henrik account data for ${name}#${tag}`, envelope.status, "not-found");
    if (!accountPayload.safeParse(envelope.data).success)
      throw new HenrikApiError("Invalid account fields", envelope.status, "invalid-payload");
    return envelope.data;
  }

  async getAccountByPuuid(puuid: string): Promise<HenrikAccount> {
    const envelope = await this.get<HenrikAccount>(`/valorant/v2/by-puuid/account/${encodeURIComponent(puuid)}`);
    if (!envelope.data)
      throw new HenrikApiError(`No Henrik account data for PUUID ${puuid}`, envelope.status, "not-found");
    if (!accountPayload.safeParse(envelope.data).success)
      throw new HenrikApiError("Invalid account fields", envelope.status, "invalid-payload");
    return envelope.data;
  }

  async getMmrByPuuid(region: string, platform: string, puuid: string): Promise<unknown | null> {
    const envelope = await this.get<unknown>(
      `/valorant/v3/by-puuid/mmr/${encodeURIComponent(region)}/${encodeURIComponent(platform)}/${encodeURIComponent(puuid)}`,
    );
    if (!rankPayload.safeParse(envelope.data ?? null).success)
      throw new HenrikApiError("Invalid rank fields", envelope.status, "invalid-payload");
    return envelope.data ?? null;
  }

  async getMatchesByPuuid(
    region: string,
    platform: string,
    puuid: string,
    size = 10,
    mode?: string,
    map?: string,
    start = 0,
  ): Promise<unknown[]> {
    const path = `/valorant/v4/by-puuid/matches/${encodeURIComponent(region)}/${encodeURIComponent(platform)}/${encodeURIComponent(puuid)}`;
    const targetSize = Math.min(20, Math.max(1, Math.floor(size)));
    const rows: unknown[] = [];
    while (rows.length < targetSize) {
      const pageSize = Math.min(10, targetSize - rows.length);
      const params = new URLSearchParams({ size: String(pageSize), start: String(start + rows.length) });
      if (mode) params.set("mode", mode);
      if (map) params.set("map", map);
      const envelope = await this.get<unknown[]>(`${path}?${params.toString()}`);
      if (!Array.isArray(envelope.data) || !envelope.data.every((row) => matchPayload.safeParse(row).success))
        throw new HenrikApiError("Invalid match history fields", envelope.status, "invalid-payload");
      const page = envelope.data;
      rows.push(...page.slice(0, pageSize));
      if (page.length < pageSize) break;
    }
    return rows.slice(0, targetSize);
  }

  async getMatch(region: string, _platform: string, matchId: string): Promise<unknown | null> {
    const envelope = await this.get<unknown>(
      `/valorant/v4/match/${encodeURIComponent(region)}/${encodeURIComponent(matchId)}`,
    );
    if (envelope.data !== null && !matchPayload.safeParse(envelope.data).success)
      throw new HenrikApiError("Invalid match fields", envelope.status, "invalid-payload");
    return envelope.data ?? null;
  }

  async getMmrHistoryByPuuid(region: string, platform: string, puuid: string): Promise<unknown> {
    return (
      await this.get(
        `/valorant/v2/by-puuid/mmr-history/${encodeURIComponent(region)}/${encodeURIComponent(platform)}/${encodeURIComponent(puuid)}`,
      )
    ).data;
  }

  async getWebsite(locale: string): Promise<unknown> {
    return (await this.get(`/valorant/v1/website/${encodeURIComponent(locale.toLowerCase())}`)).data;
  }
  async getWebsiteEntry(locale: string, id: string): Promise<unknown> {
    return (
      await this.get(`/valorant/v1/website/${encodeURIComponent(locale.toLowerCase())}/${encodeURIComponent(id)}`)
    ).data;
  }

  private async get<T>(path: string): Promise<HenrikEnvelope<T>> {
    try {
      return (await this.transport.json(
        `${this.baseUrl}${path}`,
        { Authorization: this.apiKey },
        true,
      )) as HenrikEnvelope<T>;
    } catch (error) {
      if (error instanceof ProviderTransportError)
        throw new HenrikApiError("Henrik request failed", error.status, error.code, error.retryAt);
      throw error;
    }
  }
}
