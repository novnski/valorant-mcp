import { expect, test } from "bun:test";
import { HenrikClient } from "./henrik-client";
import { ProviderTransport } from "./provider-transport";
import { SharedReads, delay, requestSignal, withRequestContext } from "./request-context";
import { TransientCache } from "./transient-cache";
import { ValorantRuntime } from "./valorant-runtime";
import { LineupsRuntime } from "./lineups-runtime";
import { StratsApiError, StratsClient } from "./strats-client";
import { completeProviderMatch } from "../../evals/fixtures/complete-provider";

const account = { puuid: "focus-puuid", name: "Focus", tag: "EU", platforms: ["pc"] };

test("concurrent accounts/history/rank collapse, reuse larger windows, and clear failed work", async () => {
  const calls = { account: 0, history: 0, rank: 0, detail: 0 };
  let fail = false;
  const api = {
    async getAccountByRiotId() {
      calls.account++;
      await delay(10);
      return account;
    },
    async getAccountByPuuid() {
      calls.account++;
      return account;
    },
    async getMmrByPuuid() {
      calls.rank++;
      await delay(10);
      if (fail) throw new Error("transient");
      return { current: { rr: 20, tier: { name: "Diamond 1" } } };
    },
    async getMatchesByPuuid(_r: string, _p: string, _id: string, size: number) {
      calls.history++;
      await delay(10);
      if (fail) throw new Error("transient");
      return Array.from({ length: size }, (_, i) => completeProviderMatch(`efficiency-match-${i}`));
    },
    async getMatch() {
      calls.detail++;
      return completeProviderMatch("efficiency-match-0");
    },
  };
  const runtime = new ValorantRuntime(api);
  const input = { player: "Focus#EU", region: "eu" as const, platform: "pc" as const, limit: 10 };
  await Promise.all([runtime.listMatches(input), runtime.listMatches(input)]);
  expect(calls).toEqual({ account: 1, history: 1, rank: 0, detail: 0 });
  await runtime.listMatches({ ...input, limit: 5 });
  expect(calls.history).toBe(1);
  await Promise.all([runtime.getPlayer("Focus#EU", "eu", "pc"), runtime.getPlayer("Focus#EU", "eu", "pc")]);
  expect(calls.rank).toBe(1);
  fail = true;
  await expect(runtime.listMatches({ ...input, mode: "swiftplay" })).rejects.toThrow("transient");
  fail = false;
  await runtime.listMatches({ ...input, mode: "swiftplay" });
  expect(calls.history).toBe(3);
  expect(calls.detail).toBe(0);
});

test("TTL sweep removes unrelated expired entries; LRU and bytes are bounded", () => {
  let now = 0;
  const cache = new TransientCache<string>(2, 100, () => now);
  cache.set("one", "a", 10);
  cache.set("two", "b", 20);
  cache.get("one");
  cache.set("three", "c", 20);
  expect(cache.get("two")).toBeNull();
  now = 11;
  cache.get("unrelated");
  expect(cache.size).toBe(1);
  cache.set("oversized", "x".repeat(101), 10);
  expect(cache.size).toBe(1);
  expect(cache.byteSize).toBeLessThanOrEqual(100);
});

test("one cancelled shared waiter does not cancel another; all cancelled work stops", async () => {
  const reads = new SharedReads();
  let calls = 0;
  let completed = 0;
  const operation = async () => {
    calls++;
    await delay(40, requestSignal());
    completed++;
    return 42;
  };
  const one = new AbortController();
  const two = new AbortController();
  const a = reads.run("same", operation, one.signal).catch((e) => e);
  const b = reads.run("same", operation, two.signal);
  one.abort();
  expect(await b).toBe(42);
  await a;
  expect(calls).toBe(1);
  expect(completed).toBe(1);
  const three = new AbortController();
  const c = reads.run("new", operation, three.signal).catch((e) => e);
  await delay(1);
  three.abort();
  await c;
  await delay(45);
  expect(completed).toBe(1);
  expect(await reads.run("new", operation)).toBe(42);
  expect(completed).toBe(2);
});

test("HTTP 200 / envelope 429 applies a shared cooldown before the next request starts", async () => {
  const starts: number[] = [];
  const transport = new ProviderTransport(
    "test",
    1,
    async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? Response.json({ status: 429, errors: [{ message: "secret" }] }, { headers: { "x-ratelimit-reset": "0.06" } })
        : Response.json({ status: 200, data: account });
    },
    500,
  );
  await expect(transport.json("https://example.test", {}, true)).rejects.toMatchObject({
    code: "rate-limited",
    status: 429,
  });
  await transport.json("https://example.test", {}, true);
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(55);
});

test("total deadline includes pacing queue and cancellation prevents a queued fetch", async () => {
  let calls = 0;
  const client = new HenrikClient(
    "test-key",
    300,
    async () => {
      calls++;
      return Response.json({ status: 200, data: account });
    },
    { timeoutMs: 50 },
  );
  await client.getAccountByPuuid("p");
  const start = Date.now();
  await expect(client.getAccountByPuuid("p")).rejects.toMatchObject({ code: "unavailable" });
  expect(Date.now() - start).toBeLessThan(180);
  expect(calls).toBe(1);
  const controller = new AbortController();
  const queued = withRequestContext(controller.signal, () => client.getAccountByPuuid("p")).catch((e) => e);
  controller.abort();
  expect(await queued).toMatchObject({ code: "cancelled" });
  await delay(210);
  expect(calls).toBe(1);
});

test("retries one transient failure, never auth or invalid payload, and exposes safe timings", async () => {
  let calls = 0;
  const transport = new ProviderTransport("test", 1, async () => {
    calls++;
    return calls === 1
      ? new Response("private internals", { status: 503 })
      : Response.json(
          { status: 200, data: account },
          {
            headers: {
              "x-ratelimit-limit": "30",
              "x-ratelimit-remaining": "12",
              "x-cache-status": "HIT",
              "x-cache-ttl": "15",
              "x-request-id": "secret-test-key",
            },
          },
        );
  });
  const traces = await withRequestContext(undefined, async (context) => {
    await transport.json("https://example.test", {}, true);
    return context.traces;
  });
  expect(calls).toBe(2);
  expect(traces).toHaveLength(2);
  expect(traces[1]).toMatchObject({
    attempt: 2,
    quota: { remaining: 12 },
    cache: { status: "HIT", ttlSeconds: 15 },
    requestId: null,
  });
  expect(traces[0]!.upstreamMs).toBeLessThan(200);
  expect(JSON.stringify(traces)).not.toContain("secret");
  for (const status of [401, 404]) {
    let failures = 0;
    const api = new HenrikClient("test-key", 300, async () => {
      failures++;
      return new Response("secret-test-key", { status });
    });
    await expect(api.getAccountByPuuid("p")).rejects.toMatchObject({ status });
    expect(failures).toBe(1);
  }
  const invalid = new HenrikClient("test-key", 300, async () => Response.json({ status: 200, data: { name: 5 } }));
  await expect(invalid.getAccountByPuuid("p")).rejects.toMatchObject({ code: "invalid-payload" });
});

test("lineup catalogs/groups are shared across filters, with bounded coverage and explicit failures", async () => {
  const calls = { maps: 0, characters: 0, groups: 0 };
  const raw = {
    id: "one",
    title: "Main recon",
    status: "approved",
    description: null,
    level: "easy",
    views: 12,
    utility: { name: "Recon" },
    posted_at: "2022-01-01",
    points: [],
  };
  const client = {
    async listMaps() {
      calls.maps++;
      return ["A", "B", "C"].map((name) => ({ id: name, name, map_sources: [{ id: name, overview: "attacker" }] }));
    },
    async listCharacters() {
      calls.characters++;
      return [{ id: "sova", name: "Sova" }];
    },
    async listGroupedLineups(map: string) {
      calls.groups++;
      await delay(10);
      if (map === "B") throw new StratsApiError("private failure", 503, "upstream-failure");
      return [{ lineups: [raw] }];
    },
  } as unknown as StratsClient;
  const runtime = new LineupsRuntime(client);
  const input = { agent: "Sova", map: "A", limit: 10 };
  await Promise.all([runtime.searchLineups(input), runtime.searchLineups({ ...input, ability: "recon" })]);
  expect(calls).toEqual({ maps: 1, characters: 1, groups: 1 });
  const search = await runtime.searchLineups({ agent: "Sova", limit: 10, mapBudget: 2, sort: "recent" });
  expect(search.coverage).toMatchObject({
    succeeded: ["A"],
    failed: [{ map: "B", code: "upstream-failure" }],
    skipped: ["C"],
  });
  expect(search.matches[0]).toMatchObject({
    source: "strats.gg",
    patch_validation: "unknown",
    posted_at: "2022-01-01",
  });
  expect(JSON.stringify(search)).not.toContain("private failure");
});
