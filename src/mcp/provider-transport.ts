import { abortable, delay, recordProviderTrace, requestSignal, type ProviderTrace } from "./request-context";

export type ProviderFailure =
  "rate-limited" | "unauthorized" | "not-found" | "invalid-payload" | "unavailable" | "upstream-failure" | "cancelled";
export class ProviderTransportError extends Error {
  constructor(
    readonly code: ProviderFailure,
    readonly status: number | null,
    readonly retryAt: string | null = null,
  ) {
    super(code);
  }
}
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ProviderTransport {
  private readonly policies = new WeakMap<object, { maxAgeMs: number | null; noStore: boolean }>();
  private nextStart = 0;
  private cooldownUntil = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly provider: string,
    private readonly intervalMs: number,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = 12_000,
  ) {}

  async json(url: string, headers: HeadersInit, envelope = false): Promise<unknown> {
    return this.request(url, headers, envelope);
  }
  async binary(url: string, headers: HeadersInit = {}, maxBytes = 2 * 1024 * 1024): Promise<Buffer> {
    return (await this.request(url, headers, false, maxBytes)) as Buffer;
  }
  cachePolicy(value: object) {
    return this.policies.get(value) ?? { maxAgeMs: null, noStore: false };
  }
  private async request(url: string, headers: HeadersInit, envelope = false, binaryLimit?: number): Promise<unknown> {
    const callerSignal = requestSignal();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const queuedAt = Date.now();
      let startedAt: number | null = null;
      let response: Response | undefined;
      let trace: ProviderTrace | undefined;
      try {
        await this.turn(signal);
        startedAt = Date.now();
        response = await abortable(this.fetcher(url, { headers, signal, redirect: "error" }), signal);
        trace = safeTrace(this.provider, response, startedAt - queuedAt, Date.now() - startedAt, attempt);
        this.applyCooldown(response.headers, response.status);
        // HTTP errors remain correctly classified even when their body is not JSON.
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderTransportError(
            classify(response.status),
            response.status,
            response.status === 429 ? new Date(this.cooldownUntil).toISOString() : null,
          );
        }
        const bytes = await readBody(response, signal, binaryLimit ?? 16 * 1024 * 1024);
        let body: unknown = bytes;
        if (binaryLimit === undefined) {
          try {
            body = JSON.parse(bytes.toString("utf8"));
          } catch {
            throw new ProviderTransportError("invalid-payload", response.status);
          }
        }
        if (envelope) {
          if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            !Number.isInteger((body as { status?: number }).status)
          )
            throw new ProviderTransportError("invalid-payload", response.status);
          const status = (body as { status: number }).status;
          if (status >= 400) {
            trace.status = status;
            this.applyCooldown(response.headers, status);
            throw new ProviderTransportError(
              classify(status),
              status,
              status === 429 ? new Date(this.cooldownUntil).toISOString() : null,
            );
          }
          if (status < 200 || status >= 300 || !Object.hasOwn(body, "data"))
            throw new ProviderTransportError("invalid-payload", response.status);
        }
        if (trace) trace.upstreamMs = Date.now() - startedAt;
        if (body !== null && typeof body === "object") {
          const control = response.headers.get("cache-control") ?? "";
          const maxAge = control.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1];
          this.policies.set(body, {
            maxAgeMs: maxAge ? Number(maxAge) * 1000 : null,
            noStore: /(?:no-store|no-cache)/i.test(control),
          });
        }
        return body;
      } catch (error) {
        if (trace && startedAt !== null) trace.upstreamMs = Date.now() - startedAt;
        const failure = signal.aborted
          ? new ProviderTransportError(callerSignal?.aborted ? "cancelled" : "unavailable", response?.status ?? null)
          : error instanceof ProviderTransportError
            ? error
            : new ProviderTransportError("unavailable", response?.status ?? null);
        // Never retry auth, missing data, invalid payloads, or 429 in the same operation.
        if (attempt < 2 && !signal.aborted && ["upstream-failure", "unavailable"].includes(failure.code)) {
          try {
            await delay(250, signal);
          } catch {
            throw new ProviderTransportError(callerSignal?.aborted ? "cancelled" : "unavailable", null);
          }
          continue;
        }
        throw failure;
      } finally {
        if (trace) recordProviderTrace(trace);
      }
    }
    throw new ProviderTransportError("unavailable", null);
  }

  private async turn(signal: AbortSignal): Promise<void> {
    const turn = this.queue.then(async () => {
      signal.throwIfAborted();
      while (Date.now() < Math.max(this.nextStart, this.cooldownUntil))
        await delay(Math.max(this.nextStart, this.cooldownUntil) - Date.now(), signal);
      signal.throwIfAborted();
      this.nextStart = Date.now() + this.intervalMs;
    });
    this.queue = turn.catch(() => undefined);
    await abortable(turn, signal);
  }
  private applyCooldown(headers: Headers, status: number): void {
    const remaining = numericHeader(headers, "x-ratelimit-remaining");
    if (status !== 429 && remaining !== 0) return;
    const reset = numericHeader(headers, "x-ratelimit-reset");
    const retry = headers.get("retry-after");
    const retrySeconds = retry && /^\d+(\.\d+)?$/.test(retry.trim()) ? Number(retry) : null;
    const retryDate = retry && retrySeconds === null ? Date.parse(retry) : NaN;
    const until = Math.max(
      reset !== null ? Date.now() + reset * 1000 : 0,
      retrySeconds !== null ? Date.now() + retrySeconds * 1000 : 0,
      Number.isFinite(retryDate) ? retryDate : 0,
    );
    this.cooldownUntil = Math.max(
      this.cooldownUntil,
      until > Date.now() ? until : Date.now() + (status === 429 ? 60_000 : 1_000),
    );
  }
}
function classify(status: number): ProviderFailure {
  return status === 429
    ? "rate-limited"
    : status === 401 || status === 403
      ? "unauthorized"
      : status === 404
        ? "not-found"
        : status >= 500
          ? "upstream-failure"
          : status === 408
            ? "unavailable"
            : "invalid-payload";
}
function numericHeader(headers: Headers, key: string): number | null {
  const value = headers.get(key);
  if (value === null || !/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000_000 ? number : null;
}
function safeTrace(
  provider: string,
  response: Response,
  queueWaitMs: number,
  upstreamMs: number,
  attempt: number,
): ProviderTrace {
  const cache = response.headers.get("x-cache-status")?.toUpperCase() ?? null;
  const requestId = response.headers.get("x-request-id");
  return {
    provider,
    sourceFetchedAt: new Date().toISOString(),
    queueWaitMs,
    upstreamMs,
    attempt,
    status: response.status,
    quota: {
      limit: numericHeader(response.headers, "x-ratelimit-limit"),
      remaining: numericHeader(response.headers, "x-ratelimit-remaining"),
      resetSeconds: numericHeader(response.headers, "x-ratelimit-reset"),
    },
    cache: {
      status: cache && ["HIT", "MISS", "STALE", "BYPASS"].includes(cache) ? cache : null,
      ttlSeconds: numericHeader(response.headers, "x-cache-ttl"),
    },
    requestId: requestId && /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : null,
  };
}
async function readBody(response: Response, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new ProviderTransportError("invalid-payload", response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderTransportError("invalid-payload", response.status);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > maxBytes) throw new ProviderTransportError("invalid-payload", response.status);
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
