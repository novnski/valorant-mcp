import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { HenrikClient } from "./henrik-client";
import { actionableError } from "./errors";
import { resolveMatchCachePath } from "../cache/match-cache-path";
import { assetRoot } from "./paths";
import { ValorantInputError } from "./errors";
import packageInfo from "../../package.json";

export const serverInfo = { name: packageInfo.name, version: packageInfo.version };

/** Returns true for standalone commands; ordinary launches keep stdout protocol-only. */
export function handleCliArgs(args = process.argv.slice(2)): boolean {
  if (args.length === 0) return false;
  if (args[0] === "--http") {
    try {
      httpPort(args);
      return false;
    } catch (error) {
      console.error(actionableError(error));
      process.exitCode = 2;
      return true;
    }
  }
  if (args.length !== 1 || !["--help", "-h", "--version", "-v", "--check"].includes(args[0]!)) {
    console.error("Unknown arguments. Run valorant-mcp --help for usage.");
    process.exitCode = 2;
    return true;
  }
  if (["--version", "-v"].includes(args[0]!)) {
    console.log(`${serverInfo.name} ${serverInfo.version}`);
  } else if (args[0] === "--check") {
    try {
      HenrikClient.fromEnv();
      for (const path of ["catalog.json", "knowledge.json", "maps", "agents"])
        accessSync(join(assetRoot, path), constants.R_OK);
      console.log(
        `Configuration OK. HENRIK_API_KEY is set (not validated remotely).\nBundled assets: readable\nMatch cache: ${resolveMatchCachePath()}\nNo API requests or cache writes were made.`,
      );
    } catch (error) {
      console.error(actionableError(error));
      process.exitCode = 1;
    }
  } else {
    console.log(`${serverInfo.name} ${serverInfo.version}

Local Valorant analysis over MCP stdio. Requires Bun >= 1.3.8.

Usage:
  bun --env-file=/absolute/path/to/.env /absolute/path/to/dist/mcp/server.js
  valorant-mcp [--help | --version | --check]
  valorant-mcp --http [--port 3000]

Environment:
  HENRIK_API_KEY                 Required; https://api.henrikdev.xyz/dashboard/
  HENRIK_REQUESTS_PER_MINUTE     Integer 1..300 (default: 30; match your key quota)
  VALORANT_MATCH_CACHE_PATH      Optional SQLite file; defaults to OS app data
  VALORANT_MCP_TOKEN             Required in HTTP mode; separate 32+ character token

--check validates configuration and bundled assets without contacting APIs.
With no flags, a client starts this process and exchanges MCP messages on stdio.
Setup: https://github.com/novnski/valorant-mcp#quick-start`);
  }
  return true;
}

export function httpPort(args = process.argv.slice(2)): number | null {
  if (args[0] !== "--http") return null;
  if (args.length !== 1 && !(args.length === 3 && args[1] === "--port"))
    throw new ValorantInputError("Usage: valorant-mcp --http [--port 3000]");
  const raw = args[2] ?? "3000";
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new ValorantInputError("HTTP port must be an integer between 1 and 65535.");
  return port;
}
