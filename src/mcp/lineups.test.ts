import { describe, expect, test } from "bun:test";

import { LineupsRuntime } from "./lineups-runtime";
import { StratsApiError, StratsClient } from "./strats-client";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const mapsFixture = [
  {
    id: "ascent",
    name: "Ascent",
    map_sources: [
      { id: "ascent-attacker", source_url: "https://example.com/ascent-a.svg", overview: "attacker" },
      { id: "ascent-defender", source_url: "https://example.com/ascent-d.svg", overview: "defender" },
    ],
  },
  {
    id: "bind",
    name: "Bind",
    map_sources: [{ id: "bind-attacker", source_url: "https://example.com/bind-a.svg", overview: "attacker" }],
  },
];

const charactersFixture = [
  {
    id: "sova",
    name: "Sova",
    utilities: [
      { id: "recon-dart", name: "Recon Dart" },
      { id: "shock-dart", name: "Shock Dart" },
    ],
  },
];

function lineup(id: string, title: string, utility: string, level: string, views: number, status = "approved") {
  return {
    id,
    title,
    description: null,
    status,
    video_url: `https://www.youtube.com/watch?v=${id}`,
    image_url: `https://example.com/${id}.png`,
    level,
    views,
    left: 10,
    top: 20,
    points: [
      { left: 30, top: 40 },
      { left: 50, top: 60 },
    ],
    utility: { id: utility, name: utility === "recon-dart" ? "Recon Dart" : "Shock Dart" },
    character: { id: "sova", name: "Sova" },
    map_source: { id: "ascent-attacker", source_url: "https://example.com/ascent-a.svg", overview: "attacker" },
    map_id: "ascent",
    map_name: "Ascent",
    posted_at: "2024-01-01T00:00:00Z",
  };
}

const groupedFixture = [
  {
    point: { left: 18.2, top: 18.0 },
    lineups: [
      lineup("lineup-1", "Standard sova B dart from B Main", "recon-dart", "easy", 61_892),
      lineup("lineup-2", "Sova shock from B main to default", "shock-dart", "medium", 30_153),
    ],
  },
  {
    point: { left: 50, top: 50 },
    lineups: [
      lineup("lineup-3", "Sova arrow for A site default", "recon-dart", "easy", 22_146),
      lineup("lineup-4", "Pending lineup that should be hidden", "recon-dart", "easy", 999_999, "pending"),
    ],
  },
];

function fakeFetcher(routes: Record<string, unknown>): Fetcher {
  return async (input) => {
    const url = String(input);
    for (const [suffix, body] of Object.entries(routes)) {
      if (url.endsWith(suffix))
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  };
}

const asyncFetcher = fakeFetcher({
  "/games/valorant/maps": mapsFixture,
  "/games/valorant/characters": charactersFixture,
  "/games/valorant/map_sources/ascent-attacker/characters/sova/lineups/grouped": groupedFixture,
  "/games/valorant/map_sources/ascent-defender/characters/sova/lineups/grouped": [],
  "/games/valorant/map_sources/bind-attacker/characters/sova/lineups/grouped": [],
  "/lineups/lineup-1": groupedFixture[0].lineups[0],
});

function client(): StratsClient {
  return new StratsClient(300, asyncFetcher);
}

describe("StratsClient", () => {
  test("lists maps and characters as raw JSON arrays", async () => {
    const maps = await client().listMaps();
    expect(maps.map((map) => map.id)).toEqual(["ascent", "bind"]);
    const characters = await client().listCharacters();
    expect(characters[0]).toMatchObject({ id: "sova", name: "Sova" });
  });

  test("lists grouped lineups for a map source and character", async () => {
    const groups = await client().listGroupedLineups("ascent-attacker", "sova");
    expect(groups).toHaveLength(2);
    expect(groups[0].lineups?.[0]?.title).toBe("Standard sova B dart from B Main");
  });

  test("classifies a missing resource as not-found", async () => {
    const missing = fakeFetcher({
      "/games/valorant/maps": mapsFixture,
      "/games/valorant/characters": charactersFixture,
    });
    const error = await new StratsClient(300, missing).listGroupedLineups("ascent-attacker", "sova").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StratsApiError);
    expect((error as StratsApiError).code).toBe("not-found");
  });

  test("rejects a non-JSON response as invalid-payload", async () => {
    const htmlFetcher: Fetcher = async () => new Response("<html>gateway</html>", { status: 200 });
    const error = await new StratsClient(300, htmlFetcher).listMaps().then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(StratsApiError);
    expect((error as StratsApiError).code).toBe("invalid-payload");
  });
});

describe("LineupsRuntime", () => {
  test("resolves agent and map case-insensitively and picks the requested side", async () => {
    const runtime = new LineupsRuntime(client());
    const search = await runtime.searchLineups({ agent: "sova", map: "aSCent", side: "attacker", limit: 10 });
    expect(search.maps_searched).toEqual(["ascent"]);
    expect(search.matches.map((match) => match.id)).toEqual(["lineup-1", "lineup-2", "lineup-3"]);
    expect(search.matches[0]).toMatchObject({
      title: "Standard sova B dart from B Main",
      side: "attacker",
      standing_point: { left: 18.2, top: 18.0 },
    });
  });

  test("searches every map when map is omitted", async () => {
    const runtime = new LineupsRuntime(client());
    const search = await runtime.searchLineups({ agent: "Sova", limit: 20 });
    expect(search.maps_searched).toEqual(["ascent", "bind"]);
    expect(search.matches).toHaveLength(3);
  });

  test("returns no matches for a side without a map source", async () => {
    const runtime = new LineupsRuntime(client());
    const search = await runtime.searchLineups({ agent: "Sova", side: "defender", limit: 10 });
    expect(search.maps_searched).toEqual(["ascent"]);
    expect(search.matches).toEqual([]);
  });

  test("filters by ability substring", async () => {
    const runtime = new LineupsRuntime(client());
    const search = await runtime.searchLineups({ agent: "Sova", ability: "shock", limit: 10 });
    expect(search.matches.map((match) => match.id)).toEqual(["lineup-2"]);
  });

  test("filters by level including the display labels", async () => {
    const runtime = new LineupsRuntime(client());
    const essential = await runtime.searchLineups({ agent: "Sova", level: "essential", limit: 10 });
    expect(essential.matches.map((match) => match.id)).toEqual(["lineup-1", "lineup-3"]);
    expect(essential.matches[0].level_label).toBe("Essential");
    const useful = await runtime.searchLineups({ agent: "Sova", level: "useful", limit: 10 });
    expect(useful.matches.map((match) => match.id)).toEqual(["lineup-2"]);
  });

  test("filters by position query with AND semantics", async () => {
    const runtime = new LineupsRuntime(client());
    const search = await runtime.searchLineups({ agent: "Sova", query: "b main", limit: 10 });
    expect(search.matches.map((match) => match.id)).toEqual(["lineup-1", "lineup-2"]);
    const none = await runtime.searchLineups({ agent: "Sova", query: "a site heaven", limit: 10 });
    expect(none.matches).toEqual([]);
  });

  test("sorts by views and caps the limit", async () => {
    const runtime = new LineupsRuntime(client());
    const search = await runtime.searchLineups({ agent: "Sova", limit: 2 });
    expect(search.matches).toHaveLength(2);
    expect(search.matches[0].views).toBeGreaterThan(search.matches[1].views);
  });

  test("excludes non-approved lineups", async () => {
    const runtime = new LineupsRuntime(client());
    const search = await runtime.searchLineups({ agent: "Sova", limit: 20 });
    expect(search.matches.some((match) => match.id === "lineup-4")).toBe(false);
  });

  test("throws an actionable error for an unknown agent or map", async () => {
    const runtime = new LineupsRuntime(client());
    await expect(runtime.searchLineups({ agent: "Nope", limit: 5 })).rejects.toThrow(/Known agents/);
    await expect(runtime.searchLineups({ agent: "Sova", map: "Shambali", limit: 5 })).rejects.toThrow(/Known maps/);
  });

  test("normalizes a single lineup detail with trajectory and side", async () => {
    const runtime = new LineupsRuntime(client());
    const detail = await runtime.getLineup("lineup-1");
    expect(detail).toMatchObject({
      id: "lineup-1",
      agent: "Sova",
      map: "Ascent",
      side: "attacker",
      ability: "Recon Dart",
      video_url: "https://www.youtube.com/watch?v=lineup-1",
      map_image_url: "https://example.com/ascent-a.svg",
    });
    expect(detail.trajectory).toEqual([
      { left: 30, top: 40 },
      { left: 50, top: 60 },
    ]);
    expect(detail.standing_point).toEqual({ left: 10, top: 20 });
  });
});
