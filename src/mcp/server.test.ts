import { PatchNotesRuntime } from "./patch-notes-runtime";
import { rawPage } from "./raw-page";
import { afterEach, describe, expect, test } from "bun:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { emptyCacheProvenance } from "../cache/match-cache";
import { sanitizedMatchDetail, sanitizedMatchSummary } from "./test-fixture";
import { createValorantMcpServer, type ValorantToolRuntime } from "./server";
import { LineupsRuntime, type LineupSearchInput, type NormalizedLineup } from "./lineups-runtime";
import {
  buildDuelReplay,
  buildMatchTimeline,
  pageMatchTimeline,
  buildPositionReview,
  buildRoundIntelligence,
  buildRoundKillList,
  buildTacticalSnapshot,
  reviewPlayerDeaths,
} from "./round-intelligence";

const clients: Client[] = [];
const servers: ReturnType<typeof createValorantMcpServer>[] = [];

afterEach(async () => {
  while (clients.length) await clients.pop()!.close();
  while (servers.length) await servers.pop()!.close();
});

describe("valorant MCP server", () => {
  test("advertises the complete read-only workflow", async () => {
    const { client } = await connect(fakeRuntime());
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "valorant_get_player",
      "valorant_list_matches",
      "valorant_get_rank_history",
      "valorant_compare_matches",
      "valorant_get_match",
      "valorant_analyze_match",
      "valorant_get_match_timeline",
      "valorant_get_round",
      "valorant_explain_round",
      "valorant_list_round_kills",
      "valorant_review_deaths",
      "valorant_review_position",
      "valorant_get_game_knowledge",
      "valorant_get_game_content",
      "valorant_get_game_asset",
      "valorant_get_patch_notes",
      "valorant_get_raw_match",
      "valorant_render_round",
      "valorant_search_lineups",
      "valorant_get_lineup",
    ]);
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(listed.tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);
  });

  test("returns numbered match IDs for conversational follow-up", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_list_matches",
      arguments: { player: "SamplePlayer#EU", region: "eu", platform: "pc", limit: 5 },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_match_list",
      player: { puuid: "sanitized-profile-puuid", riotId: "SamplePlayer#EU" },
      matches: [{ index: 1, matchId: "sanitized-match-001" }],
    });
    expect(textBlocks(response.content)).toContain("1. **WIN · Haven**");
    expect(textBlocks(response.content)).toContain("match_id: sanitized-match-001");
  });

  test("accepts full Tracker.gg profile and match URLs at the protocol boundary", async () => {
    const { client } = await connect(fakeRuntime());
    const profile = await client.callTool({
      name: "valorant_list_matches",
      arguments: {
        player:
          "https://tracker.gg/valorant/profile/riot/Sample%20Player%23TEST/overview?platform=pc&playlist=swiftplay&season=8102cd81-43a0-d0d7-bd59-47b8fe9bed1b",
        region: "eu",
        platform: "pc",
      },
    });
    const match = await client.callTool({
      name: "valorant_get_raw_match",
      arguments: {
        match_id: "https://tracker.gg/valorant/match/8aa18f0a-58bc-4f13-ba0b-9afc4be74f95",
        region: "eu",
        platform: "pc",
      },
    });

    expect(profile.isError).not.toBe(true);
    expect(textBlocks(profile.content)).toContain("season=8102cd81-43a0-d0d7-bd59-47b8fe9bed1b was not applied");
    expect(match.isError).not.toBe(true);
  });

  test("returns an actual PNG image block for a tactical round", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_render_round",
      arguments: {
        match_id: "sanitized-match-001",
        round_number: 1,
        region: "eu",
        platform: "pc",
        focus_player: "sanitized-profile-puuid",
      },
    });

    expect(response.isError).not.toBe(true);
    const image = response.content.find((block) => block.type === "image");
    expect(image?.type).toBe("image");
    if (image?.type !== "image") throw new Error("Expected image block");
    const bytes = Buffer.from(image.data, "base64");
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.byteLength).toBeGreaterThan(20_000);
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_round_image",
      match_id: "sanitized-match-001",
      round_number: 1,
      rendered_samples: 2,
      event_index: 1,
      event_count: 1,
    });
  });

  test("returns a death review with an image and navigation metadata", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_review_deaths",
      arguments: {
        match_id: "sanitized-match-001",
        player: "Omen",
        focus_player: "sanitized-profile-puuid",
        round_from: 1,
        round_to: 1,
        region: "eu",
        platform: "pc",
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content.some((block) => block.type === "image")).toBe(true);
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_death_review",
      review: { totalDeaths: 1, selected: { eventId: "r1-kill-0", weaponName: "Vandal" } },
      navigation: { buttonChoices: ["Explain this round"] },
    });
  });

  test("returns a bounded whole-match timeline with fact and inference separation", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_get_match_timeline",
      arguments: {
        match_id: "sanitized-match-001",
        focus_player: "sanitized-profile-puuid",
        region: "eu",
        platform: "pc",
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_match_timeline",
      summary: { rounds: 1 },
      rounds: [{ roundNumber: 1, observedFacts: expect.any(Array), supportedInferences: expect.any(Array) }],
      cache: { source: "memory" },
    });
    expect(textBlocks(response.content)).toContain("### R1");
    expect(textBlocks(response.content).length).toBeLessThan(4_000);
  });

  test("returns teammate-relative position evidence with a tactical PNG", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_review_position",
      arguments: { match_id: "sanitized-match-001", player: "Omen", death_index: 1, region: "eu", platform: "pc" },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content.some((block) => block.type === "image")).toBe(true);
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_position_review",
      death: { eventId: "r1-kill-0" },
      teammates: [],
      observedFacts: expect.any(Array),
      supportedInferences: expect.any(Array),
      cache: { source: "memory" },
    });
    expect(textBlocks(response.content)).toContain("Recorded living teammates");
  });

  test("lists kills with human labels while keeping event IDs out of visible text", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_list_round_kills",
      arguments: {
        match_id: "sanitized-match-001",
        round_number: 1,
        focus_player: "sanitized-profile-puuid",
        region: "eu",
        platform: "pc",
      },
    });
    const text = textBlocks(response.content);
    expect(response.isError).not.toBe(true);
    expect(text).toContain("**Kill 1**");
    expect(text).toContain("killed");
    expect(text).not.toContain("r1-kill-0");
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_round_kill_list",
      kills: [{ number: 1, eventId: "r1-kill-0", label: expect.stringContaining("Kill 1:") }],
      actions: [
        {
          label: expect.stringContaining("Kill 1:"),
          tool: "valorant_render_round",
          arguments: { event_id: "r1-kill-0" },
        },
      ],
    });
  });

  test("exposes local game knowledge and bounded raw sections", async () => {
    const { client } = await connect(fakeRuntime());
    const knowledge = await client.callTool({
      name: "valorant_get_game_knowledge",
      arguments: { agent: "Phoenix", term: "trade" },
    });
    expect(knowledge.structuredContent).toMatchObject({
      kind: "valorant_game_knowledge",
      agent: { role: "Duelist" },
      term: { name: "trade" },
    });
    const raw = await client.callTool({
      name: "valorant_get_raw_match",
      arguments: { match_id: "sanitized-match-001", section: "metadata", region: "eu", platform: "pc" },
    });
    expect(raw.structuredContent).toMatchObject({
      kind: "valorant_raw_match",
      match_id: "sanitized-match-001",
      section: "metadata",
      data: { metadata: "fixture" },
    });
  });

  test("keeps round explanations compact and separates facts from inference", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_explain_round",
      arguments: {
        match_id: "sanitized-match-001",
        round_number: 1,
        focus_player: "sanitized-profile-puuid",
        region: "eu",
        platform: "pc",
      },
    });
    const text = textBlocks(response.content);
    expect(text).toContain("### Observed");
    expect(text).toContain("### Key moments");
    expect(text).not.toContain("### Event log");
    expect(text.length).toBeLessThan(3_000);
  });

  test("keeps map image text in the message and returns a marker legend", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_render_round",
      arguments: {
        match_id: "sanitized-match-001",
        round_number: 1,
        focus_player: "sanitized-profile-puuid",
        region: "eu",
        platform: "pc",
      },
    });
    const text = textBlocks(response.content);
    expect(text).toContain("Markers:");
    expect(text).toContain("killer");
    expect(text).toContain("victim");
    expect(text).not.toContain("recorded spatial samples are shown");
    expect(text.length).toBeLessThan(2_000);
  });

  test("rejects invalid round arguments before running the handler", async () => {
    const { client } = await connect(fakeRuntime());
    const response = await client.callTool({
      name: "valorant_get_round",
      arguments: { match_id: "sanitized-match-001", round_number: 0, region: "eu", platform: "pc" },
    });
    expect(response.isError).toBe(true);
    expect(textBlocks(response.content)).toContain("Input validation error");
  });

  test("searches lineups through the shared runtime", async () => {
    const { client } = await connect(fakeRuntime(), stubLineups());
    const response = await client.callTool({
      name: "valorant_search_lineups",
      arguments: { agent: "Sova", map: "Ascent", side: "attacker", query: "b main", limit: 5 },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_lineup_search",
      agent: "Sova",
      map: "Ascent",
      side: "attacker",
      maps_searched: ["ascent"],
      matches: [{ id: "lineup-1", title: "Standard sova B dart from B Main" }],
    });
    const text = textBlocks(response.content);
    expect(text).toContain("**Standard sova B dart from B Main**");
    expect(text).toContain("youtube.com/watch?v=fixture");
    expect(text).toContain("stand 18.2% / 18.0%");
  });

  test("returns one lineup detail with trajectory", async () => {
    const { client } = await connect(fakeRuntime(), stubLineups());
    const response = await client.callTool({ name: "valorant_get_lineup", arguments: { lineup_id: "lineup-1" } });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      kind: "valorant_lineup",
      lineup: { id: "lineup-1", agent: "Sova", side: "attacker" },
    });
    const text = textBlocks(response.content);
    expect(text).toContain("Trajectory:");
    expect(text).toContain("30.0%/40.0%");
  });
});

async function connect(runtime: ValorantToolRuntime, lineups?: LineupsRuntime): Promise<{ client: Client }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createValorantMcpServer(runtime, lineups ?? stubLineups());
  const client = new Client({ name: "valorant-test-client", version: "1.0.0" });
  servers.push(server);
  clients.push(client);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client };
}

function fakeRuntime(): ValorantToolRuntime {
  const detail = sanitizedMatchDetail({
    killEvents: [
      {
        ...sanitizedMatchDetail().killEvents[0]!,
        victimLocation: { x: 2_300, y: -7_500 },
        playerLocations: [
          {
            ...sanitizedMatchDetail().killEvents[0]!.playerLocations[0]!,
            location: { x: 1_900, y: -7_900 },
          },
        ],
      },
    ],
  });
  const cache = emptyCacheProvenance("memory");
  return {
    async getRankHistory() {
      throw new Error("Not used by this fixture");
    },
    async compareMatches() {
      throw new Error("Not used by this fixture");
    },
    async getPatchNotes(input) {
      return new PatchNotesRuntime(null).getPatchNotes(input);
    },
    async getPlayer() {
      return {
        identity: {
          puuid: "sanitized-profile-puuid",
          riotId: "SamplePlayer#EU",
          gameName: "SamplePlayer",
          tagLine: "EU",
          region: "eu",
          platform: "pc",
          availablePlatforms: ["pc"],
          accountLevel: 201,
          cardId: null,
          titleId: null,
        },
        rank: {
          tierId: 18,
          tierName: "Diamond I",
          rr: 44,
          elo: 1_844,
          peakTierName: "Ascendant I",
          peakTierId: 21,
          leaderboardPlacement: null,
          updatedAt: "2026-06-12T10:00:00Z",
        },
      };
    },
    async listMatches(input) {
      const trackerProfile = input.player.startsWith("https://tracker.gg/");
      return {
        player: {
          puuid: "sanitized-profile-puuid",
          riotId: "SamplePlayer#EU",
          gameName: "SamplePlayer",
          tagLine: "EU",
          region: "eu",
          platform: "pc",
          availablePlatforms: ["pc"],
          accountLevel: 201,
          cardId: null,
          titleId: null,
        },
        input: {
          source: trackerProfile ? ("tracker-profile" as const) : ("direct" as const),
          appliedPlatform: input.platform,
          appliedPlaylist: trackerProfile ? "swiftplay" : (input.mode ?? null),
          ignoredSeason: trackerProfile ? "8102cd81-43a0-d0d7-bd59-47b8fe9bed1b" : null,
        },
        matches: [{ ...sanitizedMatchSummary(), index: 1 }],
        requested: input.limit,
        returned: 1,
        hasMore: false,
      };
    },
    async getMatch() {
      return { detail, focusPuuid: "sanitized-profile-puuid", cache };
    },
    async getMatchProjection() {
      throw new Error("not used in this test");
    },
    async analyzeMatch() {
      throw new Error("not used in this test");
    },
    async getMatchTimeline() {
      return { ...pageMatchTimeline(buildMatchTimeline(detail, "sanitized-profile-puuid"), {}), cache };
    },
    async getRound() {
      throw new Error("not used in this test");
    },
    async explainRound() {
      return { matchedBy: "round", intelligence: buildRoundIntelligence(detail, 1, "sanitized-profile-puuid"), cache };
    },
    async listRoundKills() {
      return { ...buildRoundKillList(detail, 1, "sanitized-profile-puuid"), cache };
    },
    async reviewDeaths(input) {
      return {
        ...reviewPlayerDeaths(detail, {
          player: input.player ?? input.focusPlayer ?? "sanitized-profile-puuid",
          deathIndex: input.deathIndex,
        }),
        cache,
      };
    },
    async reviewPosition(input) {
      return { ...buildPositionReview(detail, { player: input.player, deathIndex: input.deathIndex }), cache };
    },
    async getDuelReplay(input) {
      return {
        ...buildDuelReplay(detail, {
          roundNumber: input.roundNumber ?? 1,
          eventId: input.eventId,
          focusPuuid: input.focusPlayer ?? "sanitized-profile-puuid",
        }),
        cache,
      };
    },
    async getTacticalSnapshot(input) {
      return {
        ...buildTacticalSnapshot(detail, {
          roundNumber: input.roundNumber ?? 1,
          eventId: input.eventId,
          focusPuuid: input.focusPlayer ?? "sanitized-profile-puuid",
          players: input.players,
          includeKiller: input.includeKiller,
          includeVictim: input.includeVictim,
        }),
        cache,
      };
    },
    async getRawMatch(input) {
      return {
        matchId: input.matchId,
        section: input.section,
        ...rawPage({ metadata: "fixture" }, input),
        source: "henrik-raw",
        cache,
      };
    },
  };
}

function stubLineups(): LineupsRuntime {
  const lineup: NormalizedLineup = {
    source: "strats.gg",
    patch_validation: "unknown",
    id: "lineup-1",
    agent: "Sova",
    map: "Ascent",
    map_id: "ascent",
    side: "attacker",
    title: "Standard sova B dart from B Main",
    description: null,
    level: "easy",
    level_label: "Essential",
    ability: "Recon Dart",
    ability_id: "recon-dart",
    views: 61_892,
    standing_point: { left: 18.2, top: 18.0 },
    trajectory: [
      { left: 30, top: 40 },
      { left: 50, top: 60 },
    ],
    video_url: "https://www.youtube.com/watch?v=fixture",
    image_url: "https://example.com/shot.png",
    map_image_url: "https://example.com/map.svg",
    posted_at: "2024-01-01T00:00:00Z",
  };
  return {
    async searchLineups(_input: LineupSearchInput) {
      return { maps_searched: ["ascent"], matches: [lineup] };
    },
    async getLineup(lineupId: string) {
      if (lineupId !== "lineup-1") throw new Error(`Unknown lineup id ${lineupId}`);
      return lineup;
    },
  } as unknown as LineupsRuntime;
}

function textBlocks(content: Array<{ type: string; text?: string }>): string {
  return content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
}
