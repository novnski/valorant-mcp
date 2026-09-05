import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sanitizedMatchDetail } from "../mcp/test-fixture";
import { matchBaseProjectionVersion } from "./match-cache";
import { resolveMatchCachePath } from "./match-cache-path";
import { SqliteMatchCache } from "./sqlite-match-cache";

test("uses the platform application-data path unless explicitly overridden", () => {
  expect(resolveMatchCachePath({}, "darwin", "/Users/tester")).toBe(
    "/Users/tester/Library/Application Support/Valorant MCP/matches.sqlite3",
  );
  expect(
    resolveMatchCachePath({ VALORANT_MATCH_CACHE_PATH: "/tmp/custom-cache.sqlite3" }, "darwin", "/Users/tester"),
  ).toBe("/tmp/custom-cache.sqlite3");
  expect(
    resolveMatchCachePath({ LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }, "win32", "C:\\Users\\tester"),
  ).toBe("C:\\Users\\tester\\AppData\\Local\\Valorant MCP\\matches.sqlite3");
  expect(resolveMatchCachePath({ XDG_DATA_HOME: "/home/tester/data" }, "linux", "/home/tester")).toBe(
    "/home/tester/data/valorant-mcp/matches.sqlite3",
  );
});

test("creates a permission-restricted, idempotent match cache", () => {
  withCache(({ cache, path }) => {
    expect(cache.countMatches()).toBe(0);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    cache.close();
    const reopened = SqliteMatchCache.open(path);
    expect(reopened.countMatches()).toBe(0);
    reopened.close();
  }, false);
});

test("persists one scrubbed match, normalized evidence, and focus projection", () => {
  withCache(({ cache }) => {
    const detail = sanitizedMatchDetail();
    const saved = cache.saveMatch({
      matchId: detail.matchId,
      platform: detail.platform,
      region: detail.region,
      sourceEndpoint: "match-detail-v4",
      raw: providerRaw(detail.matchId, { api_key: "must-not-persist", cookie: "also-secret" }),
      baseProjection: detail,
    });
    expect(cache.countMatches()).toBe(1);
    const read = cache.readMatch(detail.matchId, detail.platform);
    expect(read).not.toBeNull();
    expect(read?.baseProjectionVersion).toBe(matchBaseProjectionVersion);
    expect(JSON.stringify(read?.raw)).not.toContain("must-not-persist");
    expect(JSON.stringify(read?.raw)).not.toContain("also-secret");
    expect(read?.baseProjection).toMatchObject({ matchId: detail.matchId, source: "cache" });

    cache.saveFocusProjection(detail.matchId, detail.platform, "sanitized-profile-puuid", saved.payloadHash, detail);
    expect(
      cache.readFocusProjection(detail.matchId, detail.platform, "sanitized-profile-puuid", saved.payloadHash)?.detail,
    ).toMatchObject({ matchId: detail.matchId, source: "cache" });
    cache.saveDerivedProjection(
      detail.matchId,
      detail.platform,
      "sanitized-profile-puuid",
      "match-timeline",
      "v1",
      saved.payloadHash,
      { rounds: 1 },
    );
    expect(
      cache.readDerivedProjection<{ rounds: number }>(
        detail.matchId,
        detail.platform,
        "sanitized-profile-puuid",
        "match-timeline",
        "v1",
        saved.payloadHash,
      ),
    ).toEqual({ rounds: 1 });
  });
});

test("does not replace richer evidence with a poorer payload", () => {
  withCache(({ cache }) => {
    const rich = sanitizedMatchDetail();
    const first = cache.saveMatch({
      matchId: rich.matchId,
      platform: rich.platform,
      region: rich.region,
      sourceEndpoint: "match-detail-v4",
      raw: providerRaw(rich.matchId, { version: "rich" }),
      baseProjection: rich,
    });
    const poor = sanitizedMatchDetail({ rounds: [], killEvents: [], teams: [] });
    const second = cache.saveMatch({
      matchId: poor.matchId,
      platform: poor.platform,
      region: poor.region,
      sourceEndpoint: "recent-list-v4",
      raw: providerRaw(poor.matchId, { version: "poor" }),
      baseProjection: poor,
    });
    expect(second.projected).toBe(false);
    expect(second.payloadHash).toBe(first.payloadHash);
    expect(cache.readMatch(rich.matchId, rich.platform)?.baseProjection?.rounds).toHaveLength(1);
  });
});

test("rebuilds a corrupt derived base projection from intact raw JSON", () => {
  withCache(({ cache, path }) => {
    const detail = sanitizedMatchDetail();
    cache.saveMatch({
      matchId: detail.matchId,
      platform: detail.platform,
      region: detail.region,
      sourceEndpoint: "match-detail-v4",
      raw: providerRaw(detail.matchId),
      baseProjection: detail,
    });
    cache.close();
    const db = new Database(path);
    db.query(`UPDATE cached_matches SET base_projection_json = 'not-json' WHERE match_id = ?`).run(detail.matchId);
    db.close();
    const reopened = SqliteMatchCache.open(path);
    const read = reopened.readMatch(detail.matchId, detail.platform);
    expect(read?.raw).toMatchObject({ metadata: { match_id: detail.matchId } });
    expect(read?.baseProjection).toBeNull();
    reopened.close();
  }, false);
});

function providerRaw(matchId: string, extra: Record<string, unknown> = {}): unknown {
  return {
    metadata: {
      match_id: matchId,
      map: { name: "Haven" },
      queue: { id: "competitive", name: "Competitive" },
      season: { id: "season" },
    },
    players: [],
    rounds: [],
    kills: [],
    ...extra,
  };
}

function withCache(run: (input: { cache: SqliteMatchCache; path: string }) => void, close = true): void {
  const directory = mkdtempSync(join(tmpdir(), "valorant-match-cache-"));
  const path = join(directory, "matches.sqlite3");
  const cache = SqliteMatchCache.open(path);
  try {
    run({ cache, path });
  } finally {
    if (close) cache.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
