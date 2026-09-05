import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { SqliteMatchCache } from "../src/cache/sqlite-match-cache";
import { normalizeMatchDetail } from "../src/services/match-detail-normalizer";
import { providerMatch } from "../evals/fixtures/provider";

const root = join(import.meta.dir, "..");
const temp = await mkdtemp(join(tmpdir(), "valorant package smoke "));
const logPath = join(tmpdir(), "valorant-mcp-package-install.log");
const installLog: string[] = [];

async function run(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  installLog.push(stdout, stderr);
  await writeFile(logPath, installLog.join("\n"));
  assert.equal(code, 0, `Command failed: bun ${args.join(" ")}; see ${logPath}`);
  return stdout;
}

try {
  await run(["pm", "pack", "--destination", temp], root);
  const packed = (await readdir(temp)).find((name) => name.endsWith(".tgz"));
  assert(packed, "No release tarball produced");
  const install = join(temp, "consumer");
  await mkdir(install);
  await writeFile(
    join(install, "package.json"),
    JSON.stringify({ private: true, dependencies: { "valorant-mcp": `file:${join(temp, packed)}` } }),
  );
  await run(["install", "--ignore-scripts"], install);
  const installed = join(install, "node_modules", "valorant-mcp");
  const contents = await readdir(installed);
  for (const forbidden of ["src", "scripts", "evals", "skills", ".env", ".git", "execution-plans"]) {
    assert(!contents.includes(forbidden), `Package leaked ${forbidden}`);
  }
  const entry = join(installed, "dist", "mcp", "server.js");
  const env = {
    ...process.env,
    HENRIK_API_KEY: "package-smoke-not-a-real-key",
    VALORANT_MATCH_CACHE_PATH: join(temp, "matches.sqlite3"),
  } as Record<string, string>;
  const cache = SqliteMatchCache.open(env.VALORANT_MATCH_CACHE_PATH!);
  cache.saveMatch({
    matchId: "cache-match-1",
    platform: "pc",
    region: "eu",
    raw: providerMatch("cache-match-1"),
    sourceEndpoint: "match-detail-v4",
    baseProjection: normalizeMatchDetail(providerMatch("cache-match-1"), {
      region: "eu",
      platform: "pc",
      source: "live",
    })!,
  });
  cache.close();
  const client = new Client({ name: "package-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: temp,
    env,
    stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk);
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 15);
    for (const tool of listed.tools) {
      assert(tool.title && tool.description && tool.outputSchema);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
    }
    const knowledge = await client.callTool({
      name: "valorant_get_game_knowledge",
      arguments: { agent: "Sova", map: "Haven" },
    });
    assert(!knowledge.isError, JSON.stringify(knowledge.content));
    assert.equal((knowledge.structuredContent as { agent: { name: string } }).agent.name, "Sova");
    const args = { match_id: "cache-match-1", region: "eu", platform: "pc", focus_player: "focus-puuid" };
    for (const name of ["valorant_get_match_timeline", "valorant_review_position", "valorant_render_round"]) {
      const response = await client.callTool({
        name,
        arguments:
          name === "valorant_review_position"
            ? { match_id: args.match_id, region: args.region, platform: args.platform, player: "focus-puuid" }
            : name === "valorant_render_round"
              ? { ...args, round_number: 1 }
              : args,
      });
      assert(!response.isError, JSON.stringify(response.content));
      const image = response.content.find((block) => block.type === "image");
      if (name !== "valorant_get_match_timeline") {
        assert(image?.type === "image", `${name} returned no image`);
        const bytes = Buffer.from(image.data, "base64");
        assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        await writeFile(join(tmpdir(), `valorant-mcp-${name}.png`), bytes);
      }
    }
    const invalid = await client.callTool({
      name: "valorant_list_matches",
      arguments: { player: "Test#EU", limit: 21 },
    });
    assert(invalid.isError, "Out-of-range input was not rejected");
  } finally {
    await client.close();
    await writeFile(join(tmpdir(), "valorant-mcp-package-server.log"), diagnostics);
  }
  // Smoke-test the actual packed CLI, not an import of the source module.
  const version = await run([entry, "--version"], temp);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  assert.equal(version.trim(), `valorant-mcp ${pkg.version}`);
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  const httpToken = "package-http-test-token-with-at-least-32-characters";
  const child = Bun.spawn([process.execPath, entry, "--http", "--port", String(port)], {
    cwd: temp,
    env: { ...env, VALORANT_MCP_TOKEN: httpToken },
    stdout: "ignore",
    stderr: "pipe",
  });
  const httpDiagnostics = new Response(child.stderr).text();
  const httpClient = new Client({ name: "package-http-smoke", version: "1.0.0" });
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        ready = (await fetch(url)).status === 401;
      } catch {
        /* wait for process startup */
      }
      if (ready || child.exitCode !== null) break;
      await Bun.sleep(100);
    }
    assert(ready, "Packaged HTTP server did not start");
    await httpClient.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${httpToken}` } } }),
    );
    assert.equal((await httpClient.listTools()).tools.length, 15);
    const response = await httpClient.callTool({
      name: "valorant_get_match_timeline",
      arguments: { match_id: "cache-match-1", region: "eu", platform: "pc", focus_player: "focus-puuid" },
    });
    assert(!response.isError, JSON.stringify(response.content));
  } finally {
    await httpClient.close();
    child.kill();
    await child.exited;
    await writeFile(join(tmpdir(), "valorant-mcp-package-http.log"), await httpDiagnostics);
  }
  console.log(
    `Package smoke passed: isolated install, 15 schemas, local knowledge, cached timeline, position review, PNG rendering, input validation, CLI, and authenticated localhost HTTP.\nInstall log: ${logPath}`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
