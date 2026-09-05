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
  private readonly timeoutMs = 12_000;
  private nextRequestAt = 0;
  private throttleChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly apiKey: string,
    private readonly requestsPerMinute = 30,
    private readonly fetchImpl: Fetcher = fetch,
  ) {
    if (!apiKey.trim()) throw new HenrikApiError("HENRIK_API_KEY is required", null, "missing-config");
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 300) {
      throw new HenrikApiError(
        "HENRIK_REQUESTS_PER_MINUTE must be an integer between 1 and 300",
        null,
        "invalid-config",
      );
    }
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
    return envelope.data;
  }

  async getAccountByPuuid(puuid: string): Promise<HenrikAccount> {
    const envelope = await this.get<HenrikAccount>(`/valorant/v2/by-puuid/account/${encodeURIComponent(puuid)}`);
    if (!envelope.data)
      throw new HenrikApiError(`No Henrik account data for PUUID ${puuid}`, envelope.status, "not-found");
    return envelope.data;
  }

  async getMmrByPuuid(region: string, platform: string, puuid: string): Promise<unknown | null> {
    const envelope = await this.get<unknown>(
      `/valorant/v3/by-puuid/mmr/${encodeURIComponent(region)}/${encodeURIComponent(platform)}/${encodeURIComponent(puuid)}`,
    );
    return envelope.data ?? null;
  }

  async getMatchesByPuuid(
    region: string,
    platform: string,
    puuid: string,
    size = 10,
    mode?: string,
  ): Promise<unknown[]> {
    const path = `/valorant/v4/by-puuid/matches/${encodeURIComponent(region)}/${encodeURIComponent(platform)}/${encodeURIComponent(puuid)}`;
    const targetSize = Math.min(20, Math.max(1, Math.floor(size)));
    const rows: unknown[] = [];
    while (rows.length < targetSize) {
      const pageSize = Math.min(10, targetSize - rows.length);
      const params = new URLSearchParams({ size: String(pageSize), start: String(rows.length) });
      if (mode) params.set("mode", mode);
      const envelope = await this.get<unknown[]>(`${path}?${params.toString()}`);
      const page = Array.isArray(envelope.data) ? envelope.data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows.slice(0, targetSize);
  }

  async getMatch(region: string, _platform: string, matchId: string): Promise<unknown | null> {
    const envelope = await this.get<unknown>(
      `/valorant/v4/match/${encodeURIComponent(region)}/${encodeURIComponent(matchId)}`,
    );
    return envelope.data ?? null;
  }

  private async get<T>(path: string): Promise<HenrikEnvelope<T>> {
    await this.throttle();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Authorization: this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new HenrikApiError("Henrik request timed out or was unavailable", null, "unavailable");
    }

    let body: HenrikEnvelope<T>;
    try {
      body = (await response.json()) as HenrikEnvelope<T>;
    } catch {
      throw new HenrikApiError("Henrik returned a non-JSON response", response.status, "invalid-payload");
    }
    if (!response.ok || body.status >= 400) {
      const message =
        body.errors
          ?.map((error) => error.message)
          .filter(Boolean)
          .join("; ") || "Henrik request failed";
      throw new HenrikApiError(
        message,
        response.status,
        classify(response.status),
        response.status === 429 ? retryAt(response) : null,
      );
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

function classify(status: number): HenrikFailureCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "upstream-failure";
  return "invalid-payload";
}

function retryAt(response: Response): string {
  const raw = response.headers.get("retry-after")?.trim();
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(Date.now() + seconds * 1_000).toISOString();
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date((Math.floor(Date.now() / 60_000) + 1) * 60_000 + 1_000).toISOString();
}
