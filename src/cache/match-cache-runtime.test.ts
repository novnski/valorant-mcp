import { providerMatch } from "../../evals/fixtures/provider";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ValorantRuntime } from "../mcp/valorant-runtime";
import type { MatchCache } from "./match-cache";
import { SqliteMatchCache } from "./sqlite-match-cache";

test("recent lists persist nothing and only the selected complete match becomes durable", async () => {
  await withCache(async ({ cache, path }) => {
    const provider = fakeProvider();
    const runtime = new ValorantRuntime(provider, cache);
    const listed = await runtime.listMatches({ player: "Focus#EU", region: "eu", platform: "pc", limit: 20 });
    expect(listed.matches).toHaveLength(1);
    expect(cache.countMatches()).toBe(0);

    const first = await runtime.analyzeMatch({
      matchId: listed.matches[0]!.matchId,
      region: "eu",
      platform: "pc",
      focusPlayer: "focus-puuid",
    });
    expect(first.cache).toMatchObject({ source: "recent-list", matchSaved: true });
    await runtime.getMatchTimeline({
      matchId: listed.matches[0]!.matchId,
      region: "eu",
      platform: "pc",
      focusPlayer: "focus-puuid",
    });
    expect(provider.calls.detail).toBe(0);
    expect(cache.countMatches()).toBe(1);
    cache.close();

    const reopened = SqliteMatchCache.open(path);
    const offlineProvider = fakeProvider({ failDetail: true });
    const restarted = new ValorantRuntime(offlineProvider, reopened);
    const repeat = await restarted.getRound({
      matchId: listed.matches[0]!.matchId,
      roundNumber: 1,
      region: "eu",
      platform: "pc",
      focusPlayer: "focus-puuid",
    });
    const repeatTimeline = await restarted.getMatchTimeline({
      matchId: listed.matches[0]!.matchId,
      region: "eu",
      platform: "pc",
      focusPlayer: "focus-puuid",
    });
    const raw = await restarted.getRawMatch({
      matchId: listed.matches[0]!.matchId,
      region: "eu",
      platform: "pc",
      section: "kills",
    });
    expect(repeat.cache).toMatchObject({ source: "local-projection", matchSaved: true });
    expect(repeatTimeline.cache).toMatchObject({ source: "local-projection", matchSaved: true });
    expect(repeatTimeline.summary.rounds).toBe(1);
    expect(raw.cache.matchSaved).toBe(true);
    expect(offlineProvider.calls.detail).toBe(0);
    reopened.close();
  }, false);
});

test("an incomplete recent-list payload falls through to exactly one detail request", async () => {
  await withCache(async ({ cache }) => {
    const provider = fakeProvider({ partialList: true });
    const runtime = new ValorantRuntime(provider, cache);
    const listed = await runtime.listMatches({ player: "Focus#EU", region: "eu", platform: "pc", limit: 5 });
    expect(cache.countMatches()).toBe(0);
    const loaded = await runtime.getMatch({ matchId: listed.matches[0]!.matchId, region: "eu", platform: "pc" });
    expect(loaded.cache).toMatchObject({ source: "henrik-detail", matchSaved: true });
    expect(provider.calls.detail).toBe(1);
    expect(cache.countMatches()).toBe(1);
  });
});

test("repeated detail-dependent operations reuse one direct fetch", async () => {
  await withCache(async ({ cache }) => {
    const provider = fakeProvider();
    const runtime = new ValorantRuntime(provider, cache);
    await runtime.analyzeMatch({ matchId: "cache-match-1", region: "eu", platform: "pc", focusPlayer: "focus-puuid" });
    await runtime.explainRound({
      matchId: "cache-match-1",
      region: "eu",
      platform: "pc",
      focusPlayer: "focus-puuid",
      roundNumber: 1,
    });
    await runtime.getRawMatch({ matchId: "cache-match-1", region: "eu", platform: "pc", section: "all" });
    await runtime.getTacticalSnapshot({ matchId: "cache-match-1", region: "eu", platform: "pc", roundNumber: 1 });
    expect(provider.calls.detail).toBe(1);
    expect(cache.countMatches()).toBe(1);
  });
});

test("a cache write failure keeps live analysis usable and returns a visible warning", async () => {
  const provider = fakeProvider();
  const failingCache: MatchCache = {
    readMatch: () => null,
    readFocusProjection: () => null,
    saveMatch: () => {
      throw new Error("cache disk is unavailable; private-token-must-not-leak");
    },
    saveFocusProjection: () => {
      throw new Error("cache disk is unavailable; private-token-must-not-leak");
    },
    readDerivedProjection: () => null,
    saveDerivedProjection: () => {
      throw new Error("cache disk is unavailable; private-token-must-not-leak");
    },
    countMatches: () => 0,
    close: () => undefined,
  };
  const runtime = new ValorantRuntime(provider, failingCache);
  const loaded = await runtime.getMatch({ matchId: "cache-match-1", region: "eu", platform: "pc" });
  expect(loaded.detail.matchId).toBe("cache-match-1");
  expect(loaded.cache).toMatchObject({
    matchSaved: false,
    warning: "Could not save the local match cache; check cache permissions and disk space.",
  });
  expect(provider.calls.detail).toBe(1);
});

function fakeProvider(options: { partialList?: boolean; failDetail?: boolean } = {}) {
  const calls = { detail: 0, list: 0 };
  return {
    calls,
    async getAccountByRiotId(name: string, tag: string) {
      return { puuid: "focus-puuid", region: "eu", name, tag, platforms: ["pc"] };
    },
    async getAccountByPuuid(puuid: string) {
      return { puuid, region: "eu", name: "Focus", tag: "EU", platforms: ["pc"] };
    },
    async getMmrByPuuid() {
      return null;
    },
    async getMatchesByPuuid() {
      calls.list += 1;
      return [options.partialList ? partialProviderMatch("cache-match-1") : providerMatch("cache-match-1")];
    },
    async getMatch(_region: string, _platform: string, matchId: string) {
      calls.detail += 1;
      if (options.failDetail) throw new Error("detail endpoint must not be called");
      return providerMatch(matchId);
    },
  };
}

function partialProviderMatch(matchId: string): unknown {
  const full = providerMatch(matchId) as Record<string, unknown>;
  return { ...full, rounds: [], kills: [] };
}

async function withCache(
  run: (input: { cache: SqliteMatchCache; path: string }) => Promise<void>,
  close = true,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "valorant-cache-runtime-"));
  const path = join(directory, "matches.sqlite3");
  const cache = SqliteMatchCache.open(path);
  try {
    await run({ cache, path });
  } finally {
    if (close) cache.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
