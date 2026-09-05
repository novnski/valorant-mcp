# Valorant MCP Server Instructions

This repository is a local TypeScript MCP server exposed to MCP clients over stdio or authenticated loopback Streamable HTTP; Executor is an optional shared gateway. It is not a website, Discord bot, hosted service, crawler, scheduled data-ingestion system, or database-backed tracker. Its only durable state is a demand-driven local cache for match IDs the user explicitly opens.

## Product boundary

- Henrik is the only live match data API and provides patch-news discovery. The Strats.gg open public JSON API (`api.strats.gg/internal/api/v1`) is used solely by the read-only lineup tools `valorant_search_lineups` and `valorant_get_lineup`; it needs no key. Valorant-API public metadata and `media.valorant-api.com` assets are allowed only for explicit game-content/asset requests and maintainer-driven content builds. Canonical Riot public patch-publication metadata may be bundled as an offline fallback; no news crawler or background ingestion is allowed.
- Player input is always explicit and may be a Riot ID, PUUID, or full Tracker.gg Valorant profile URL. Match inputs may be Henrik IDs or Tracker.gg match URLs. Decode Tracker links locally; never scrape or call Tracker at runtime, and never introduce a default or linked profile.
- Keep tools read-only and post-match. Do not add live scouting, hidden-player identification, Riot session/cookie handling, or private client APIs.
- Recent player/rank/match-list reads stay live and non-persistent. Persist one match only when a detail-dependent tool explicitly opens that exact match ID; never crawl, backfill, expand participants, or persist the rest of a recent list.
- Reuse a compatible saved match projection before Henrik match-detail I/O. Saved raw JSON may be reprojected locally after a code/schema upgrade. Never persist credentials, authorization headers, cookies, tokens, or provider error internals.
- Presentation transports belong to the MCP client. Do not add a standalone messaging bot.
- Return MCP image blocks for tactical visuals so MCP clients can display them natively.

## Architecture

- `src/mcp/server.ts`: MCP schemas, descriptions, formatting, and transport entrypoint.
- `src/mcp/cli.ts`, `src/mcp/http.ts`: CLI setup and authenticated loopback HTTP.
- `src/mcp/henrik-client.ts`: direct authenticated Henrik HTTP client and in-memory pacing.
- `src/mcp/strats-client.ts`: open Strats.gg lineups HTTP client (no key) and in-memory pacing.
- `src/mcp/lineups-runtime.ts`: lineup catalog resolution, normalization, and deterministic filters (map, side, ability, level, position query).
- `src/mcp/valorant-runtime.ts`: stateless player/match workflows and deterministic projections.
- `src/mcp/round-renderer.ts`: local Canvas tactical PNG renderer.
- `src/mcp/round-intelligence.ts`: score resolution, round phases, trades, death review, callouts, and dynamic snapshot selection.
- `src/mcp/view-analysis.ts`: geometric facing cones and teammate/crossfire coverage.
- `src/mcp/game-knowledge.ts`: local agent ability, map callout, weapon, and terminology knowledge.
- `src/cache/`: narrow `bun:sqlite` match cache, migrations, secret scrubbing, raw/projection persistence, and normalized player/round/kill/event-position rows.
- `skills/valorant-analyst/SKILL.md`: agent procedure for evidence language and Discord/Telegram navigation buttons.
- `src/services/`: retained normalization and evidence-analysis algorithms.
- `src/domain/`: retained contracts, types, and map transforms.
- `assets/valorant/`: reduced local map/agent/weapon artwork.

Do not reintroduce `src/web`, `src/bot`, the former `src/storage` application stack, workers, Railway files, Docker topology, React, Discord.js, PostgreSQL, Redis, queues, scheduled sync, or automatic profile expansion. SQLite is allowed only inside the bounded `src/cache` demand-driven match cache.

## Implementation rules

- Use Bun and strict TypeScript.
- Register tools with the current MCP TypeScript SDK and Zod v4 schemas.
- Prefix tools with `valorant_`, include read-only annotations, and keep outputs bounded.
- Return structured content plus concise model-facing text. Errors must be actionable and must not expose credentials or raw internal failures.
- Tactical claims must cite match, round, or event evidence and state limitations when data is sparse.
- Default images to killer + victim. Add only explicitly requested players, keep icons small, color outlines/triangles only by Red versus Blue team, tuck solid portrait-width direction triangles beneath each icon, center a large red X across the victim portrait, and keep all prose outside the map image.
- Treat view cones as geometric potential. Never collapse them into proven sight through walls, smoke, flashes, nearsight, or elevation.
- Never write credentials into repository files or agent-specific MCP config. Supply `HENRIK_API_KEY` through a private environment file or client environment injection. Executor users may keep it in their credential-backed connection.
- Keep recent match listing live and non-persistent. Cache provenance must be bounded and visible on detail-dependent results; cache write failure must not silently claim success.
- Position and facing analysis uses discrete kill-event snapshots. Never describe it as continuous movement, POV, actual line of sight, awareness, comms, intent, or crosshair placement.

## Verification

After changes run:

```bash
bun run build
bun run typecheck
bun run test
bun run check
bun run smoke:package
```

For integration changes use an isolated cache path and test the packed stdio server. If an existing Executor connection is affected, refresh its executable path and tool discovery. Prove that listing persists zero matches, selecting one ID persists exactly one, repeat/restart reads perform no second detail request, and a second selected ID raises the count to exactly two. Run one timeline call, one teammate-position review, and one tactical image render; inspect the image rather than assuming Canvas output is correct.

Preserve unrelated user changes. Do not commit or push unless requested.
