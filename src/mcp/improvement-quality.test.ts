import { normalizeMapSpatialPosition } from "../domain/map-spatial-resources";
import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { completeProviderMatch } from "../../evals/fixtures/complete-provider";
import { providerMatch } from "../../evals/fixtures/provider";
import { normalizeMatchDetail } from "../services/match-detail-normalizer";
import { canReuseListedMatch, losesEvidence } from "../services/match-completeness";
import { rawPage } from "./raw-page";
import { ValorantRuntime } from "./valorant-runtime";
import { createValorantMcpServer } from "./server";

function normalize(raw: unknown) {
  return normalizeMatchDetail(raw, { region: "eu", platform: "pc", source: "live" })!;
}
function provider(raw = completeProviderMatch("quality-match-1")) {
  const calls = { detail: 0 };
  return {
    calls,
    async getAccountByRiotId(name: string, tag: string) {
      return { puuid: "focus-puuid", name, tag, platforms: ["pc", "console"] };
    },
    async getAccountByPuuid(puuid: string) {
      return { puuid, name: "Focus", tag: "EU", platforms: ["pc", "console"] };
    },
    async getMmrByPuuid() {
      return { current: { tier: { id: 20, name: "Diamond 3" }, rr: 50 } };
    },
    async getMatchesByPuuid() {
      return [raw];
    },
    async getMatch() {
      calls.detail++;
      return raw;
    },
  };
}

test("sparse two-player recent data cannot establish complete evidence or zero deaths", async () => {
  const raw = { ...(providerMatch("quality-match-1") as object), rounds: [{}], kills: [] };
  const detail = normalize(raw);
  expect(canReuseListedMatch(detail)).toBe(false);
  expect(detail.warnings.join(" ")).toContain("Missing evidence does not establish zero");
  const runtime = new ValorantRuntime(provider(raw));
  expect(
    (
      await runtime.getMatchTimeline({
        matchId: "quality-match-1",
        region: "eu",
        platform: "pc",
        focusPlayer: "focus-puuid",
      })
    ).summary.focusDeaths,
  ).toBeNull();
});

test("capability requirements distinguish scoreboard, tactical, missing, and explicit zero", () => {
  const full = completeProviderMatch("quality-match-1", 30);
  expect(canReuseListedMatch(normalize(full))).toBe(true);
  const partial = normalize({ ...full, rounds: [{}], kills: [] });
  expect(canReuseListedMatch(partial, "scoreboard")).toBe(true);
  expect(canReuseListedMatch(partial, "tactical")).toBe(false);
  expect(losesEvidence(normalize(full), partial)).toBe(true);
  const remake = completeProviderMatch("quality-match-1", 0);
  expect(normalize(remake).evidence?.kills.state).not.toBe("complete");
  const unknownMode = normalize({ ...full, metadata: { ...full.metadata, queue: { id: "deathmatch" } } });
  expect(unknownMode.evidence?.roster.expected).toBeNull();
});

test("console identity and freshness remain distinct", async () => {
  const result = await new ValorantRuntime(provider()).getPlayer("Focus#EU", "eu", "console");
  expect(result.identity).toMatchObject({ platform: "console", availablePlatforms: ["pc", "console"] });
  expect(result.rank?.updatedAt).toBeNull();
  expect(result.rank?.fetchedAt).toEqual(expect.any(String));
});

test("raw pages retain exact values, escaped pointers, pagination and a byte budget", () => {
  const rows = Array.from({ length: 200 }, (_, id) => ({ id, nested: "x".repeat(5000) }));
  const first = rawPage({ "a/b": rows }, {});
  expect(first.expandable[0]?.path).toBe("/a~1b");
  const page = rawPage({ "a/b": rows }, { path: "/a~1b", limit: 100 });
  expect(page.pagination).toMatchObject({ total: 200, returned: 100, nextOffset: 100 });
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(50_000);
  const scalar = rawPage({ "a/b": rows }, { path: "/a~1b/1/id" });
  expect(scalar.data).toBe(1);
  const text = rawPage(rows, { path: "/0/nested", offset: 4000, limit: 20 });
  expect(text.data).toBe("x".repeat(1000));
  expect(text.pagination.nextOffset).toBeNull();
  expect(() => rawPage(rows, { path: "/__proto__" })).toThrow("No raw field");
});

test("30-round MCP timeline stays below 50 KB with resolvable events and score transitions", async () => {
  const runtime = new ValorantRuntime(provider(completeProviderMatch("quality-match-1", 30)));
  const server = createValorantMcpServer(runtime);
  const client = new Client({ name: "budget-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const response = await client.callTool({
      name: "valorant_get_match_timeline",
      arguments: { match_id: "quality-match-1", focus_player: "focus-puuid" },
    });
    expect(response.isError).not.toBe(true);
    const content = response.structuredContent as any;
    expect(content.rounds.length).toBe(30);
    expect(content.rounds.at(-1).scoreAfter).toBe("15-15");
    for (const round of content.rounds)
      for (const id of round.keyMoments) {
        expect(content.events[id].round).toBe(round.roundNumber);
        expect(content.participants[content.events[id].actor]).toBeDefined();
      }
    expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThan(50_000);
    expect(JSON.stringify(content)).not.toContain('"attention"');
    const next = await runtime.getMatchTimeline({
      matchId: "quality-match-1",
      region: "eu",
      platform: "pc",
      roundFrom: 11,
      roundTo: 20,
      limit: 5,
    });
    expect(next.pagination).toMatchObject({ returned: 5, nextRound: 16, totalRounds: 30 });
  } finally {
    await client.close();
    await server.close();
  }
});

test("explicit refresh requests only the selected ID and enforces a cooldown", async () => {
  const api = provider();
  const runtime = new ValorantRuntime(api);
  const input = { matchId: "quality-match-1", region: "eu" as const, platform: "pc" as const };
  await runtime.getMatch(input);
  await runtime.getMatch(input);
  expect(api.calls.detail).toBe(1);
  await runtime.getMatch({ ...input, refresh: true });
  expect(api.calls.detail).toBe(2);
  await expect(runtime.getMatch({ ...input, refresh: true })).rejects.toThrow("refreshed recently");
  await runtime.getMatch(input);
  expect(api.calls.detail).toBe(2);
});

for (const file of ["match-1.json", "match-2.json"]) {
  test(`saved Henrik corpus ${file}: coherent totals and bounded timeline`, async () => {
    const raw = await Bun.file(new URL(`../../evals/fixtures/representative/${file}`, import.meta.url)).json();
    const api = provider(raw);
    const runtime = new ValorantRuntime(api);
    const timeline = await runtime.getMatchTimeline({
      matchId: raw.metadata.match_id,
      region: "eu",
      platform: "pc",
      focusPlayer: raw.players[0].puuid,
    });
    expect(timeline.pagination.returned).toBe(raw.rounds.length);
    expect(Buffer.byteLength(JSON.stringify(timeline))).toBeLessThan(50_000);
    expect(timeline.evidence.roster.state).toBe("complete");
    expect(timeline.evidence.rounds.state).toBe("complete");
    if (file === "match-1.json") {
      // This real Swiftplay ledger includes one self-elimination excluded from scoreboard totals.
      expect(timeline.evidence.kills).toMatchObject({ state: "partial", available: 78, expected: 77 });
      expect(timeline.summary.focusKills).toBeNull();
    } else {
      expect(timeline.evidence.kills.state).toBe("complete");
      expect(timeline.summary.focusKills).toBe(raw.players[0].stats.kills);
    }
  });
}

test("overtime, missing economy, missing rounds, and respawn evidence stay explicit", () => {
  const overtime = completeProviderMatch("quality-match-1", 32);
  const detail = normalize(overtime);
  expect(detail.evidence?.rounds).toMatchObject({ state: "complete", available: 32, expected: 32 });
  const noEconomy = structuredClone(overtime);
  noEconomy.rounds.forEach((r: any) => r.stats.forEach((s: any) => delete s.economy));
  expect(normalize(noEconomy).evidence?.economy.state).toBe("unavailable");
  expect(canReuseListedMatch(normalize(noEconomy))).toBe(true);
  const gap = normalize({ ...overtime, rounds: overtime.rounds.filter((r: any) => r.round !== 2) });
  expect(gap.evidence?.rounds.state).toBe("partial");
  const duplicate = structuredClone(overtime);
  duplicate.kills[1] = structuredClone(duplicate.kills[0]);
  expect(normalize(duplicate).evidence?.kills.state).toBe("partial");
  // Two deaths of the same player at distinct times are distinct observations, not a duplicated event.
  const respawn = completeProviderMatch("quality-match-1", 1);
  respawn.kills.push({ ...structuredClone(respawn.kills[0]), time_in_round_in_ms: 40_000 });
  respawn.players[0].stats.deaths = 2;
  respawn.players[1].stats.kills = 2;
  expect(normalize(respawn).evidence?.kills.state).toBe("complete");
});

test("a kill-free first round does not shift Henrik v4 kills into the wrong round", async () => {
  const raw = completeProviderMatch("quality-match-1", 3);
  raw.kills.shift();
  raw.players[0].stats.deaths = 2;
  raw.players[1].stats.kills = 2;
  raw.kills[0].location = { x: 1_000, y: -2_000 };
  raw.kills[1].location = { x: 3_000, y: -4_000 };
  const runtime = new ValorantRuntime(provider(raw));
  const timeline = await runtime.getMatchTimeline({ matchId: "quality-match-1", region: "eu", platform: "pc" });
  expect(timeline.rounds[0]?.opening).toBeNull();
  expect(timeline.rounds[1]?.opening).toBe("r2-kill-0");
  const second = await runtime.getDuelReplay({
    matchId: "quality-match-1",
    region: "eu",
    platform: "pc",
    roundNumber: 3,
  });
  expect(second.victimPosition).toMatchObject(normalizeMapSpatialPosition("Haven", { x: 3_000, y: -4_000 })!);
});
