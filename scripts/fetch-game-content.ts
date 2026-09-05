import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const target = process.argv[2];
const locale = process.argv[3] ?? "en-US";
if (!target || !/^[a-z]{2}-[A-Z]{2}$/.test(locale))
  throw new Error("Usage: bun scripts/fetch-game-content.ts <snapshot-directory> [en-US]");
const directory = resolve(target);
await mkdir(directory, { recursive: true });
const routes = {
  version: "/v1/version",
  agents: "/v1/agents?isPlayableCharacter=true",
  maps: "/v1/maps",
  weapons: "/v1/weapons",
};
const sources = await Promise.all(
  Object.entries(routes).map(async ([name, path]) => {
    const url = new URL(path, "https://valorant-api.com");
    if (name !== "version") url.searchParams.set("language", locale);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!response.ok) throw new Error(`Public ${name} source unavailable (${response.status})`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error(`Oversized ${name} metadata`);
    const body = JSON.parse(text);
    if (body.status !== 200 || !body.data) throw new Error(`Invalid ${name} envelope`);
    await writeFile(join(directory, `${name}.json`), text);
    return {
      file: `${name}.json`,
      url: url.href,
      sha256: createHash("sha256").update(text).digest("hex"),
      bytes: Buffer.byteLength(text),
      cacheControl: response.headers.get("cache-control"),
    };
  }),
);
await writeFile(
  join(directory, "manifest.json"),
  JSON.stringify(
    { version: 1, source: "valorant-api.com", unofficial: true, locale, fetchedAt: new Date().toISOString(), sources },
    null,
    2,
  ) + "\n",
);
console.error(
  `Saved ${sources.length} explicit public metadata responses to ${directory}. Build with scripts/build-game-knowledge.ts.`,
);
