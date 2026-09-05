import { expect, test } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createHash } from "node:crypto";
import { ContentRuntime } from "./content-runtime";
import { ProviderTransport } from "./provider-transport";
import { PatchNotesRuntime, parsePatchSections } from "./patch-notes-runtime";
import { gameKnowledge } from "./game-knowledge";
import { createValorantMcpServer } from "./server";
import { HenrikClient } from "./henrik-client";
import { ValorantRuntime } from "./valorant-runtime";

const vandal = "9c82e19d-4575-0200-1a81-3eacf00cf872";
const agent = gameKnowledge().agents.find((a) => a.name === "Sova")!;
const version = { manifestId: "fixture-manifest", branch: "release-13.05", buildDate: "2026-08-20T00:00:00Z" };
function publicFixture(path: string) {
  return path.includes("/version")
    ? version
    : {
        uuid: vandal,
        displayName: "Vandal",
        displayIcon: `https://media.valorant-api.com/weapons/${vandal}/displayicon.png`,
        shopData: { cost: 2900 },
        weaponStats: { magazineSize: 25, fireRate: 9.75 },
        skins: Array.from({ length: 200 }, () => ({ unneeded: "cosmetic" })),
      };
}

test("fresh weapons use a per-UUID route, selected fields, locale and bounded metadata reuse", async () => {
  const urls: string[] = [];
  const content = new ContentRuntime(
    new ProviderTransport("test", 1, async (input) => {
      urls.push(String(input));
      return Response.json(
        { status: 200, data: publicFixture(String(input)) },
        { headers: { "cache-control": "public, max-age=14400" } },
      );
    }),
  );
  const result = await content.getContent({ kind: "weapon", query: "Vandal", fresh: true });
  expect(result).toMatchObject({
    source: "valorant-api.com",
    content_manifest: "fixture-manifest",
    data: { uuid: vandal, name: "Vandal", price: 2900, magazineSize: 25 },
    source_updated_at: null,
    match_patch: null,
  });
  expect(JSON.stringify(result)).not.toContain("cosmetic");
  expect(urls.some((url) => url.includes(`/weapons/${vandal}?language=en-US`))).toBe(true);
  await content.getContent({ kind: "weapon", query: "Vandal", fresh: true });
  expect(urls).toHaveLength(2);
  await content.getContent({ kind: "weapon", query: vandal, fresh: true, locale: "fr-FR" });
  expect(urls).toHaveLength(3);
  expect(urls.some((url) => /\/weapons(?:\?|$)/.test(url))).toBe(false);
});

test("no-store metadata is not reused and missing fresh content falls back explicitly", async () => {
  let calls = 0;
  const content = new ContentRuntime(
    new ProviderTransport("test", 1, async (input) => {
      calls++;
      return Response.json(
        { status: 200, data: publicFixture(String(input)) },
        { headers: { "cache-control": "no-store" } },
      );
    }),
  );
  await content.getContent({ kind: "weapon", query: "Vandal", fresh: true });
  await content.getContent({ kind: "weapon", query: "Vandal", fresh: true });
  expect(calls).toBe(4);
  const offline = new ContentRuntime(new ProviderTransport("test", 1, async () => new Response(null, { status: 404 })));
  const fallback = await offline.getContent({ kind: "agent", query: "Sova", fresh: true, locale: "fr-FR" });
  expect(fallback).toMatchObject({
    source: "bundled-fallback",
    locale: "en-US",
    requested_locale: "fr-FR",
    data: { name: "Sova" },
  });
  expect(fallback.warning).toContain("bundled snapshot");
  await expect(
    offline.getContent({ kind: "agent", query: "00000000-0000-0000-0000-000000000000", fresh: true }),
  ).rejects.toThrow("not bundled");
});

test("asset retrieval rejects off-provider image URLs before fetch", async () => {
  const urls: string[] = [];
  const content = new ContentRuntime(
    new ProviderTransport("test", 1, async (input) => {
      urls.push(String(input));
      return Response.json({
        status: 200,
        data: String(input).includes("version")
          ? version
          : { uuid: agent.uuid, displayName: "Sova", displayIcon: "http://127.0.0.1/private" },
      });
    }),
  );
  await expect(content.getAsset({ kind: "agent", query: "Sova", fresh: true })).rejects.toThrow(
    "unsupported asset URL",
  );
  expect(urls.every((url) => url.startsWith("https://valorant-api.com/"))).toBe(true);
});

test("packed-contract native icon is one bounded PNG with matching hash and no duplicated base64", async () => {
  const runtime = new ValorantRuntime(new HenrikClient("offline-test-key"));
  const server = createValorantMcpServer(runtime);
  const client = new Client({ name: "content-image-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right);
  await client.connect(left);
  try {
    const result = await client.callTool({
      name: "valorant_get_game_asset",
      arguments: { kind: "agent", query: "Sova", size: 256 },
    });
    expect(result.isError).not.toBe(true);
    const images = result.content.filter((item) => item.type === "image");
    expect(images).toHaveLength(1);
    const image = images[0]!;
    if (image.type !== "image") throw new Error("Expected image");
    const bytes = Buffer.from(image.data, "base64");
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.length).toBeLessThanOrEqual(256 * 1024);
    expect(result.structuredContent).toMatchObject({
      source: "bundled",
      width: 256,
      height: 256,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain(image.data);
  } finally {
    await client.close();
    await server.close();
  }
});

const article = (patch: string, date: string) => ({
  id: patch,
  title: `VALORANT Patch Notes ${patch}`,
  date,
  category: "provider-category-not-hardcoded",
  url: `https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-${patch.replace(".", "-")}/`,
});
test("patch latest follows publication dates, preserves platform/future wording, and handles null detail", async () => {
  let listCalls = 0;
  const runtime = new PatchNotesRuntime({
    async getWebsite() {
      listCalls++;
      return [article("13.06", "2026-08-01"), article("13.05", "2026-09-01")];
    },
    async getWebsiteEntry(_locale, id) {
      return {
        ...article(id, "2026-09-01"),
        content:
          id === "13.05"
            ? "<h2>ALL PLATFORMS</h2><h3>Agent changes</h3><p>Starting next patch, this will change.</p><h2>PC ONLY</h2><h3>Bug fixes</h3><p>Fixed a bug.</p>"
            : null,
      };
    },
  });
  const latest = await runtime.getPatchNotes({});
  expect(latest.articles[0]?.patch).toBe("13.05");
  expect(latest.latest_scope).toBe("returned-provider-publications");
  expect(latest.articles[0]?.sections).toMatchObject([
    { platform: "all", timing: "may-include-future-announcements" },
    { platform: "pc" },
  ]);
  expect(latest.articles[0]?.sections[0]?.text).toContain("Starting next patch");
  const selected = await runtime.getPatchNotes({ patch: "13.06" });
  expect(selected.articles[0]?.content_status).toBe("metadata-only");
  expect(listCalls).toBe(1);
  expect(parsePatchSections("<h2>PC ONLY</h2><h3>Bugs</h3>" + "x".repeat(3000), ["bugs"])).toMatchObject({
    truncated: true,
    sections: [{ platform: "pc", truncated: true }],
  });
});

test("offline news and hostile article identities cannot claim a verified latest patch", async () => {
  const offline = await new PatchNotesRuntime(null).getPatchNotes({});
  expect(offline).toMatchObject({ source: "bundled-riot-metadata", latest_scope: "known-bundled-publications" });
  expect(offline.warning).toContain("not been verified live");
  expect(offline.articles[0]?.sections).toEqual([]);
  const runtime = new PatchNotesRuntime({
    async getWebsite() {
      return [article("13.05", "2026-09-01"), { ...article("99.99", "2030-01-01"), url: "https://evil.example/news" }];
    },
    async getWebsiteEntry() {
      return { ...article("13.05", "2026-09-01"), url: "https://evil.example/news", content: "malicious body" };
    },
  });
  const result = await runtime.getPatchNotes({});
  expect(result.articles).toHaveLength(1);
  expect(result.articles[0]?.content_status).toBe("metadata-only");
  expect(JSON.stringify(result)).not.toContain("evil.example");
  expect(JSON.stringify(result)).not.toContain("malicious body");
});
