import { afterEach, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { startHttpServer } from "./http";
import { httpPort } from "./cli";

const token = "test-only-token-with-at-least-32-characters";
const servers: ReturnType<typeof startHttpServer>[] = [];
const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.stop(true);
});

function start() {
  const server = startHttpServer(
    () => {
      const mcp = new McpServer({ name: "http-test", version: "1.0.0" });
      mcp.registerTool(
        "echo",
        { description: "Echo a test value", inputSchema: z.object({ value: z.string() }).strict() },
        ({ value }) => ({ content: [{ type: "text", text: value }] }),
      );
      return mcp;
    },
    0,
    token,
  );
  servers.push(server);
  return new URL(`http://127.0.0.1:${server.port}/mcp`);
}

test("HTTP supports a real MCP discovery and tool call with Bearer authentication", async () => {
  const url = start();
  const client = new Client({ name: "http-test", version: "1.0.0" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["echo"]);
  const result = await client.callTool({ name: "echo", arguments: { value: "local-http-ok" } });
  expect(result.content).toEqual([{ type: "text", text: "local-http-ok" }]);
});

test("HTTP rejects missing credentials, foreign origins, wrong hosts and query tokens", async () => {
  const url = start();
  expect((await fetch(url)).status).toBe(401);
  expect((await fetch(url, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  expect(
    (await fetch(url, { headers: { Authorization: `Bearer ${token}`, Origin: "https://untrusted.example" } })).status,
  ).toBe(403);
  expect((await fetch(url, { headers: { Authorization: `Bearer ${token}`, Host: "untrusted.example" } })).status).toBe(
    403,
  );
  expect((await fetch(`${url}?token=${token}`)).status).toBe(404);
});

test("HTTP requires a separate strong token and validates CLI port choices", () => {
  expect(() => startHttpServer(() => new McpServer({ name: "test", version: "1" }), 0, "short")).toThrow(
    "VALORANT_MCP_TOKEN",
  );
  expect(httpPort([])).toBeNull();
  expect(httpPort(["--http"])).toBe(3000);
  expect(httpPort(["--http", "--port", "4000"])).toBe(4000);
  for (const args of [
    ["--http", "--port", "0"],
    ["--http", "--port", "abc"],
    ["--http", "--port", "65536"],
    ["--http", "--host", "0.0.0.0"],
  ])
    expect(() => httpPort(args)).toThrow();
});
