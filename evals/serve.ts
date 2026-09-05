import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createValorantMcpServer } from "../src/mcp/server";
import { evaluationRuntime } from "./runtime";

serveStdio(() => createValorantMcpServer(evaluationRuntime()));
console.error(
  "Synthetic evaluation server. Player: Focus#EU; match: cache-match-1. Match tools use fixtures; lineup tools still contact Strats.gg.",
);
