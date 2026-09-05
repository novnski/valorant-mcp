import { AsyncLocalStorage } from "node:async_hooks";

export type ProviderTrace = {
  provider: string;
  sourceFetchedAt: string;
  queueWaitMs: number;
  upstreamMs: number;
  attempt: number;
  status: number | null;
  quota: { limit: number | null; remaining: number | null; resetSeconds: number | null };
  cache: { status: string | null; ttlSeconds: number | null };
  requestId: string | null;
};
type RequestContext = { signal: AbortSignal | undefined; traces: ProviderTrace[] };
const requests = new AsyncLocalStorage<RequestContext>();
export function requestSignal(): AbortSignal | undefined {
  return requests.getStore()?.signal;
}
export function recordProviderTrace(trace: ProviderTrace): void {
  const context = requests.getStore();
  if (context && context.traces.length < 20) context.traces.push(trace);
}
export function withRequestContext<T>(signal: AbortSignal | undefined, run: (context: RequestContext) => T): T {
  const context: RequestContext = { signal, traces: [] };
  return requests.run(context, () => run(context));
}
export function withRequestSignal<T>(signal: AbortSignal, run: () => T): T {
  return requests.run({ signal, traces: requests.getStore()?.traces ?? [] }, run);
}

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, ms));
      }),
      signal,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Requests share work, but one cancelled waiter must not cancel another caller. */
export class SharedReads {
  private readonly pending = new Map<
    string,
    { promise: Promise<unknown>; controller: AbortController; users: number; done: boolean; traces: ProviderTrace[] }
  >();
  waitIfPending<T>(key: string): Promise<T> | null {
    return this.pending.has(key)
      ? this.run<T>(key, async () => {
          throw new Error("Pending read disappeared");
        })
      : null;
  }
  async run<T>(key: string, operation: () => Promise<T>, signal = requestSignal()): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.pending.get(key);
    if (!entry) {
      if (this.pending.size >= 128) throw new Error("Too many pending reads");
      const controller = new AbortController();
      entry = { promise: Promise.resolve(), controller, users: 0, done: false, traces: [] };
      const created = entry;
      created.promise = Promise.resolve()
        .then(() =>
          withRequestContext(controller.signal, async (context) => {
            try {
              controller.signal.throwIfAborted();
              return await operation();
            } finally {
              created.traces = context.traces;
            }
          }),
        )
        .finally(() => {
          created.done = true;
          if (this.pending.get(key) === created) this.pending.delete(key);
        });
      this.pending.set(key, created);
    }
    entry.users++;
    try {
      return await abortable(entry.promise as Promise<T>, signal);
    } finally {
      entry.traces.forEach(recordProviderTrace);
      entry.users--;
      if (entry.users === 0 && !entry.done) {
        entry.controller.abort();
        if (this.pending.get(key) === entry) this.pending.delete(key);
      }
    }
  }
}
