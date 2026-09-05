import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { HenrikClient } from "./henrik-client";
import { ValorantRuntime } from "./valorant-runtime";
import { SqliteMatchCache } from "../cache/sqlite-match-cache";
import { completeProviderMatch } from "../../evals/fixtures/complete-provider";
import { normalizeRankHistory } from "./rank-history";
import { createValorantMcpServer } from "./server";

const rr = (id: string, date: string, delta: number) => ({
  match_id: id,
  date,
  map: { id: "haven", name: "Haven" },
  tier: { id: 12, name: "Gold 1" },
  season: { id: "season", short: "E10A1" },
  rr: 0,
  last_change: delta,
  elo: 1000,
  refunded_rr: 3,
  was_derank_protected: true,
});
const args = { player: "Focus#EU", region: "eu" as const, platform: "console" as const };

function provider() {
  const calls = { detail: [] as string[], history: [] as unknown[][], rr: 0 };
  return {
    calls,
    async getAccountByRiotId() {
      return { puuid: "focus-puuid", name: "Focus", tag: "EU", region: "eu", platforms: ["pc", "console"] };
    },
    async getAccountByPuuid() {
      return this.getAccountByRiotId();
    },
    async getMmrByPuuid() {
      return null;
    },
    async getMmrHistoryByPuuid() {
      calls.rr++;
      return {
        account: { puuid: "focus-puuid" },
        history: [
          rr("match-old", "2026-01-01", -20),
          rr("match-new", "2026-01-03", 10),
          rr("match-new", "2026-01-03", 10),
        ],
      };
    },
    async getMatchesByPuuid(...input: unknown[]) {
      calls.history.push(input);
      return [completeProviderMatch("match-new"), completeProviderMatch("match-new")];
    },
    async getMatch(_region: string, _platform: string, id: string) {
      calls.detail.push(id);
      return completeProviderMatch(id, 10);
    },
  };
}

test("RR history preserves zero, refunds and derank protection, sorts/deduplicates, and never opens matches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "valorant-rr-"));
  const cache = SqliteMatchCache.open(join(dir, "cache.sqlite"));
  const p = provider();
  const runtime = new ValorantRuntime(p, cache);
  try {
    const value = await runtime.getRankHistory({ ...args, limit: 1 });
    expect(value.history).toMatchObject([
      { matchId: "match-new", rr: 0, rrDelta: 10, refundedRr: 3, wasDerankProtected: true },
    ]);
    expect(value.player.platform).toBe("console");
    expect(value.truncated).toBe(true);
    expect((await runtime.getRankHistory({ ...args, limit: 10 })).history).toHaveLength(2);
    expect(p.calls).toMatchObject({ rr: 1, detail: [], history: [] });
    expect(cache.countMatches()).toBe(0);
    expect(value.limitations.join(" ")).toContain("not Riot's hidden");
    expect(() => normalizeRankHistory({ account: { puuid: "wrong" }, history: [] }, "focus-puuid")).toThrow();
    expect(() =>
      normalizeRankHistory({ history: [{ ...rr("x", "2026-01-01", 0), last_change: "secret error" }] }, "focus-puuid"),
    ).toThrow();
  } finally {
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("history map and start reach Henrik in ten-row pages and RR uses the documented console route", async () => {
  const urls: URL[] = [];
  const client = new HenrikClient("fake-test", 300, async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return Response.json({
      status: 200,
      data: url.pathname.includes("mmr-history")
        ? { history: [] }
        : Array.from({ length: Number(url.searchParams.get("size")) }, (_, i) => ({
            metadata: { match_id: `match-${Number(url.searchParams.get("start")) + i}` },
          })),
    });
  });
  const history = await client.getMatchesByPuuid("eu", "console", "focus-puuid", 15, "competitive", "Haven", 20);
  expect(history).toHaveLength(15);
  expect(urls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
    { start: "20", size: "10", mode: "competitive", map: "Haven" },
    { start: "30", size: "5", mode: "competitive", map: "Haven" },
  ]);
  await client.getMmrHistoryByPuuid("eu", "console", "focus-puuid");
  expect(urls.at(-1)!.pathname).toBe("/valorant/v2/by-puuid/mmr-history/eu/console/focus-puuid");
});

test("match list deduplicates without guessing more results, separates filter caches, and advances raw offsets", async () => {
  const p = provider();
  const runtime = new ValorantRuntime(p);
  const value = await runtime.listMatches({ ...args, limit: 2, map: "Haven", start: 20 });
  expect(value.matches).toHaveLength(1);
  expect(value).toMatchObject({
    returned: 1,
    hasMore: null,
    window: { start: 20, providerRows: 2, nextStart: 22, returnedUnique: 1 },
  });
  await runtime.listMatches({ ...args, limit: 2, map: "Haven", start: 20 });
  await runtime.listMatches({ ...args, limit: 2, map: "Ascent", start: 20 });
  await runtime.listMatches({ ...args, limit: 2, map: "Ascent", start: 22 });
  expect(p.calls.history).toHaveLength(3);
  expect(p.calls.detail).toEqual([]);
  expect(p.calls.history[0]?.slice(0, 7)).toEqual(["eu", "console", "focus-puuid", 2, undefined, "Haven", 20]);
});

test("comparison persists only distinct selected IDs, remains offline after restart, and rejects absent players", async () => {
  const dir = mkdtempSync(join(tmpdir(), "valorant-compare-"));
  const path = join(dir, "cache.sqlite");
  const p = provider();
  let cache = SqliteMatchCache.open(path);
  let runtime = new ValorantRuntime(p, cache);
  const input = {
    ...args,
    player: "focus-puuid",
    matchIds: ["selected-match-1", "selected-match-2", "selected-match-1"],
  };
  try {
    const value = await runtime.compareMatches(input);
    expect(value.sample.selectedMatches).toBe(2);
    expect(value.matches.map((row) => row.matchId)).toEqual(input.matchIds.slice(0, 2));
    expect(value.comparableGroups).toHaveLength(1);
    expect(value.comparableGroups[0]?.sampleSize).toBe(2);
    expect(p.calls.detail).toEqual(input.matchIds.slice(0, 2));
    expect(p.calls.history).toHaveLength(0);
    expect(cache.countMatches()).toBe(2);
    expect(JSON.stringify(value).length).toBeLessThan(15_000);
    runtime.close();
    cache = SqliteMatchCache.open(path);
    runtime = new ValorantRuntime(
      {
        ...p,
        async getMatch() {
          throw new Error("Network forbidden");
        },
        async getAccountByPuuid() {
          throw new Error("Network forbidden");
        },
      },
      cache,
    );
    expect((await runtime.compareMatches(input)).matches.every((row) => row.cache.matchSaved)).toBe(true);
    await expect(
      runtime.compareMatches({ ...input, matchIds: ["selected-match-1", "selected-match-1"] }),
    ).rejects.toThrow("distinct");
    const absent = new ValorantRuntime(
      {
        ...p,
        async getAccountByPuuid() {
          return { puuid: "absent", name: "Absent", tag: "EU", region: "eu" };
        },
      },
      null,
    );
    await expect(absent.compareMatches({ ...input, player: "absent" })).rejects.toThrow("not a participant");
  } finally {
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real saved corpus comparisons expose mixed contexts and evidence coverage without history expansion", async () => {
  const real = [1, 2].map((i) =>
    JSON.parse(readFileSync(join(import.meta.dir, "../../evals/fixtures/representative", `match-${i}.json`), "utf8")),
  );
  // Corpus fixtures intentionally anonymize each file independently; bind the explicitly selected player for this paired test only.
  real.forEach((row, i) => {
    row.metadata.match_id = `real-match-${i + 1}`;
  });
  const p = provider();
  p.getMatch = async (_region, _platform, id) => real[Number(id.at(-1)) - 1];
  const runtime = new ValorantRuntime(p);
  const focus = real[0].players[0];
  const second = real[1].players[0];
  second.puuid = focus.puuid;
  second.name = focus.name;
  second.tag = focus.tag;
  const result = await runtime.compareMatches({
    ...args,
    player: focus.puuid,
    matchIds: ["real-match-1", "real-match-2"],
  });
  expect(result.comparableGroups).toHaveLength(2);
  expect(result.matches.every((row) => row.evidence && row.patch)).toBe(true);
  expect(p.calls.history).toHaveLength(0);
});

test("MCP schemas bound RR and selected comparisons", async () => {
  const server = createValorantMcpServer(new ValorantRuntime(provider()));
  const client = new Client({ name: "extensions", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const rr = await client.callTool({
      name: "valorant_get_rank_history",
      arguments: { player: "Focus#EU", platform: "console", limit: 1 },
    });
    expect(rr.isError).not.toBe(true);
    expect(rr.structuredContent).toMatchObject({ kind: "valorant_rank_history", history: [{ matchId: "match-new" }] });
    const compare = await client.callTool({
      name: "valorant_compare_matches",
      arguments: { player: "focus-puuid", match_ids: ["selected-match-1", "selected-match-2"] },
    });
    expect(compare.isError).not.toBe(true);
    for (const request of [
      { name: "valorant_get_rank_history", arguments: { player: "Focus#EU", limit: 51 } },
      { name: "valorant_compare_matches", arguments: { player: "Focus#EU", match_ids: ["selected-match-1"] } },
    ])
      expect((await client.callTool(request)).isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
