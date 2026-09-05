# Valorant MCP

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for post-match Valorant analysis. Give an MCP-capable assistant a Riot ID or match link to inspect stats, review rounds and deaths, render tactical maps, or find community lineups.

**15 tools · Bun + TypeScript · local stdio or HTTP · your own Henrik API key**

## Quick start

Prefer a download? Get `valorant-mcp-1.0.0.tgz` from the [GitHub release](https://github.com/novnski/valorant-mcp/releases/latest), extract it, open the `package` folder, and run `bun install --production --ignore-scripts`. The executable and game assets are already built. Copy `.env.example` to `.env`, add your Henrik key, and follow one of the connection options below. Bun is still required.

To install from source:

Install [Bun](https://bun.sh/docs/installation) **1.3.8 or newer** and Git. Get a key from the [Henrik dashboard](https://api.henrikdev.xyz/dashboard/) → **API Keys**. You do not need a Riot developer key or game login.

```sh
git clone https://github.com/novnski/valorant-mcp.git
cd valorant-mcp
bun install --frozen-lockfile
bun run build
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`. Edit `.env` and set `HENRIK_API_KEY` to your own key. Keep this file private; it is excluded from Git and release packages.

```sh
bun --env-file=.env dist/mcp/server.js --check
```

This checks configuration and bundled assets without API requests. It does not validate the key remotely or create the match cache.

## Option 1: local stdio

The client launches the server as a local subprocess. There is no port to open or separate daemon to manage.

For clients that use an `mcpServers` JSON configuration, merge this entry into the existing configuration. Replace **both absolute paths**; use the full path to Bun if the desktop application cannot find it in `PATH`.

```json
{
  "mcpServers": {
    "valorant": {
      "command": "bun",
      "args": ["--env-file=/absolute/path/to/valorant-mcp/.env", "/absolute/path/to/valorant-mcp/dist/mcp/server.js"]
    }
  }
}
```

Use `command -v bun` on macOS/Linux or `(Get-Command bun).Source` on PowerShell to find Bun. In Windows JSON, use forward slashes (`C:/Users/you/valorant-mcp/...`) or escape backslashes. Restart the client after saving its configuration. An example is in [`examples/mcp.json`](examples/mcp.json); VS Code's `servers` format is in [`examples/vscode-mcp.json`](examples/vscode-mcp.json).

Clients with a secure environment-variable configuration can inject `HENRIK_API_KEY` directly and omit `--env-file`. Executor is optional; [existing Executor installations](docs/executor.md) can keep using their shared connection.

Try asking:

- “Show the last three competitive matches for Name#TAG in EU.”
- “Analyze the second match. Which rounds changed the result?”
- “Review my first death in that match and show the teammate positions.”
- “Find Sova attack lineups on Haven near C long.”

Player and match tools accept full Tracker.gg Valorant profile/match links. A list index is only for conversation: subsequent calls use the exact returned `match_id`. Specify the player's region (`na`, `eu`, `latam`, `br`, `ap`, `kr`) and platform (`pc`, `console`); defaults are `eu` and `pc`.

## Option 2: local HTTP URL

Use this when your desktop MCP client expects a URL, or when several local clients should share one process and request limiter.

In `.env`, set `VALORANT_MCP_TOKEN` to a **separate random token of at least 32 characters**. Generate one using a password manager; do not reuse the Henrik key. Start the server:

```sh
bun --env-file=.env dist/mcp/server.js --http
```

Keep that terminal open. In the MCP client, choose **Streamable HTTP**, set the URL to `http://127.0.0.1:3000/mcp`, and configure the header `Authorization: Bearer YOUR_VALORANT_MCP_TOKEN`. The Henrik key stays in the server environment.

For clients that support this JSON shape:

```json
{
  "mcpServers": {
    "valorant": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer REPLACE_WITH_YOUR_LOCAL_MCP_TOKEN" }
    }
  }
}
```

An example is in [`examples/http-mcp.json`](examples/http-mcp.json). Use `--http --port 4000` if port 3000 is occupied, and change the client URL to match. The listener binds only to `127.0.0.1`, checks Host and Origin headers, and accepts tokens only in the Authorization header. A cloud-hosted client cannot reach your computer's loopback address. This mode is for local use, not a public multi-user service.

## Tools

| Tool                          | Use                                                                      |
| ----------------------------- | ------------------------------------------------------------------------ |
| `valorant_get_player`         | Identity, account level, current rank/RR, peak rank                      |
| `valorant_list_matches`       | 1–20 recent matches with exact IDs; optional queue filter                |
| `valorant_get_match`          | Teams, result, scoreboard, combat and economy evidence                   |
| `valorant_analyze_match`      | Turning points, performance, economy, damage, abilities, duels           |
| `valorant_get_match_timeline` | Per-round facts, supported inferences, and score transitions             |
| `valorant_get_round`          | One round's complete normalized event ledger                             |
| `valorant_explain_round`      | Resolve a round number or score such as 6–7                              |
| `valorant_list_round_kills`   | Numbered kills for selecting a duel                                      |
| `valorant_review_deaths`      | Filtered death review, evidence, and tactical PNG                        |
| `valorant_review_position`    | A death relative to recorded living teammates                            |
| `valorant_render_round`       | Tactical PNG for one recorded kill event                                 |
| `valorant_get_game_knowledge` | Bundled agents, abilities, maps, callouts, weapons, terminology          |
| `valorant_get_raw_match`      | Provider metadata, players, teams, rounds, or kills for verification     |
| `valorant_search_lineups`     | Strats.gg lineups filtered by agent, map, side, ability, level, position |
| `valorant_get_lineup`         | One lineup's details and provider media links                            |

Tools return structured data alongside text. Tactical images are standard MCP `image` content blocks; display depends on the client. [`skills/valorant-analyst`](skills/valorant-analyst/SKILL.md) is an optional evidence-review procedure for clients that support skills.

## Configuration and local data

| Variable                     | Default             | Purpose                                                               |
| ---------------------------- | ------------------- | --------------------------------------------------------------------- |
| `HENRIK_API_KEY`             | Required            | Your Henrik API key                                                   |
| `HENRIK_REQUESTS_PER_MINUTE` | `30`                | Per-process pacing, integer 1–300; set within your key quota          |
| `VALORANT_MCP_TOKEN`         | HTTP only           | Separate random client Bearer token; 32–256 non-whitespace characters |
| `VALORANT_MATCH_CACHE_PATH`  | OS application data | Override the SQLite cache file path                                   |

The default cache is `~/Library/Application Support/Valorant MCP/matches.sqlite3` on macOS, `$XDG_DATA_HOME/valorant-mcp/matches.sqlite3` (or `~/.local/share/...`) on Linux, and `%LOCALAPPDATA%/Valorant MCP/matches.sqlite3` on Windows.

Recent lists are live with short in-memory reuse and are never saved to disk. Opening a specific match saves only that match. Repeated analysis can reuse it across restarts. The cache contains player IDs and match evidence; treat it as personal data. Delete the SQLite file while all server processes are stopped to clear saved matches. Cache failures are reported in tool errors or provenance warnings.

Henrik receives the player and match identifiers you request. Lineup searches contact Strats.gg's public API. No analytics or game-client access is included. Multiple running server processes each pace independently; account-wide limits still apply.

## Limits

This is post-match analysis from provider data. Recorded kill positions are discrete snapshots. Facing cones do not prove visibility through walls or utility. There is no POV, continuous movement, comms, intent, or crosshair evidence. Reports distinguish observations from inferences.

Recent history depends on Henrik availability and access; it is not a lifetime archive. Tracker profile platform/playlist hints are applied, but its season filter is not. Local game knowledge is a bundled snapshot and can lag patches. Strats.gg's lineup API is an external dependency and can change independently.

## Troubleshooting

- **Command not found:** use the absolute path to Bun in client configuration.
- **Missing key:** verify the absolute `--env-file` path and run `--check` using that same file.
- **401/403:** check the Henrik dashboard for key validity and access, then restart the client.
- **429:** wait for the tool's retry time; lower request pacing and avoid repeated fresh profile calls.
- **Missing match:** check region, platform, and exact match ID; provider history may be unavailable.
- **Asset/native module errors:** use a supported Bun platform and reinstall from the lockfile. Keep `assets/` alongside `dist/`; do not move only the JavaScript file.
- **HTTP 401:** configure the separate local MCP token in the client Authorization header.
- **No terminal output:** a server launched without flags waits for MCP messages. Use `--help`, `--version`, or `--check` for terminal diagnostics.

## Development

```sh
bun run check         # build, strict typecheck, formatting, offline tests
bun run smoke:package # isolated release install; test stdio and localhost HTTP
bun run format        # format source and documentation
```

See [contributing and verification](CONTRIBUTING.md), [architecture](docs/architecture.md), and [evaluation tasks](evals/README.md). GitHub is the distribution source; this project is not currently published to npm. `bun pm pack` builds a package containing the executable, required artwork, and license notices.

## License and attribution

Original code is [MIT licensed](LICENSE). Game assets and provider content retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

Valorant MCP was created under Riot Games' [Legal Jibber Jabber](https://www.riotgames.com/en/legal) policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.
