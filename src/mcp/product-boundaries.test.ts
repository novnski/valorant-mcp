import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("MCP-only product boundary", () => {
  test("does not ship former hosted product or automatic-ingestion surfaces", () => {
    for (const relative of [
      "src/web",
      "src/bot",
      "src/storage",
      "src/archive-worker.ts",
      "src/sync-worker.ts",
      "Dockerfile",
      "compose.yaml",
      "docker",
      "railway.json",
      "playwright.config.ts",
      "public",
      "data/valorant-tracker.sqlite",
    ])
      expect(existsSync(join(root, relative))).toBe(false);
  });

  test("has no website, bot, hosted database, worker, or deployment dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names).not.toContain("discord.js");
    expect(names).not.toContain("react");
    expect(names).not.toContain("react-dom");
    expect(names.some((name) => /postgres|sqlite|redis|playwright/i.test(name))).toBe(false);
    expect(Object.values(pkg.scripts ?? {}).join(" ")).not.toMatch(/web|discord|railway|postgres|sqlite|redis|worker/i);
  });

  test("documents Henrik plus the optional local match-cache path", () => {
    const names = readFileSync(join(root, ".env.example"), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => line.split("=", 1)[0]);
    expect(names).toEqual([
      "HENRIK_API_KEY",
      "HENRIK_REQUESTS_PER_MINUTE",
      "VALORANT_MATCH_CACHE_PATH",
      "VALORANT_MCP_TOKEN",
    ]);
  });
});
