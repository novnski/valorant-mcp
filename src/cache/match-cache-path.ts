import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";

export const matchCachePathEnv = "VALORANT_MATCH_CACHE_PATH";

export function resolveMatchCachePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const { join, resolve } = platform === "win32" ? win32 : posix;
  const configured = env[matchCachePathEnv]?.trim();
  if (configured) return resolve(configured);
  if (platform === "darwin") return join(home, "Library", "Application Support", "Valorant MCP", "matches.sqlite3");
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    return join(
      localAppData ? resolve(localAppData) : join(home, "AppData", "Local"),
      "Valorant MCP",
      "matches.sqlite3",
    );
  }
  const xdgData = env.XDG_DATA_HOME?.trim();
  return join(xdgData ? resolve(xdgData) : join(home, ".local", "share"), "valorant-mcp", "matches.sqlite3");
}

export function prepareMatchCachePath(path: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
}

export function restrictMatchCacheFile(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows and some mounted filesystems do not expose POSIX modes.
  }
}
