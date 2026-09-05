import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { ValorantInputError } from "./errors";

export function startHttpServer(factory: () => McpServer, port: number, token: string) {
  if (token.length < 32 || token.length > 256 || /\s/.test(token)) {
    throw new ValorantInputError(
      "HTTP mode requires VALORANT_MCP_TOKEN: a separate random token of 32–256 non-whitespace characters. Set it in your private .env file and use it as the client's Bearer token.",
    );
  }
  const handler = createMcpHandler(factory, {
    legacy: "stateless",
    onerror: () => console.error("MCP HTTP request failed. Check the client protocol and request parameters."),
  });
  const expected = Buffer.from(`Bearer ${token}`);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    maxRequestBodySize: 1_048_576,
    idleTimeout: 120,
    async fetch(request) {
      const url = new URL(request.url);
      const allowedHosts = new Set([`127.0.0.1:${server.port}`, `localhost:${server.port}`]);
      if (!allowedHosts.has(request.headers.get("host") ?? "")) return new Response("Forbidden host", { status: 403 });
      const origin = request.headers.get("origin");
      if (origin && ![...allowedHosts].some((host) => origin === `http://${host}`))
        return new Response("Forbidden origin", { status: 403 });
      if (url.pathname !== "/mcp" || url.search) return new Response("Not found", { status: 404 });
      const supplied = Buffer.from(request.headers.get("authorization") ?? "");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return new Response("A valid MCP Bearer token is required", {
          status: 401,
          headers: { "WWW-Authenticate": "Bearer" },
        });
      }
      return handler.fetch(request);
    },
    error() {
      return new Response("MCP request failed", { status: 500 });
    },
  });
  return server;
}
