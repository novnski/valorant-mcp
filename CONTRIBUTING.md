# Contributing

Use Bun 1.3.8 or newer and strict TypeScript. Install with `bun install --frozen-lockfile`.

## Before submitting

1. Run `bun run check` (build, typecheck, formatting, offline tests).
2. Run `bun run smoke:package` to validate an isolated package install and real stdio session.
3. For provider changes, run `bun run smoke:live -- 'Name#TAG' eu MATCH_ID ROUND` with your own `HENRIK_API_KEY` and an isolated `VALORANT_MATCH_CACHE_PATH`. This makes live read requests and saves only explicitly selected matches.
4. Inspect a returned PNG when changing tactical rendering.

Use `bun run format` to format changes. CI repeats the offline checks and packaged stdio smoke test on Linux, macOS, and Windows; it requires no real API credentials.

## Design rules

Keep the server usable directly from standard MCP clients. Integration-specific guidance belongs in `docs/`. Preserve explicit player selection, bounded tools, read-only remote access, safe errors, and standard text/structured/image content.

Do not add game-client authentication, live scouting, hidden-player identification, background ingestion, participant expansion, hosted databases, or messaging bots. Selected-match SQLite caching is the only durable runtime state.

Tools require strict schemas, descriptive fields, accurate annotations, and useful output schemas. Validate external response changes against representative provider payloads. Do not infer vision, intent, or continuous movement from sparse recorded positions.

## Package and release

`bun run build` produces `dist/mcp/server.js`; `bun pm pack` also builds automatically. The `files` allowlist in `package.json` defines the runtime distribution. Tests, local environment files, historical plans, and caches are excluded. The packed smoke test confirms those boundaries and starts the installed package from an unrelated working directory.

For a release, update `package.json` and the lockfile, run all checks, and publish a Git tag/release with the verified package. The CLI and MCP identity use the package version. npm publication is a separate maintainer action; do not assume the package name is available or published.

## Reports

Open an issue with the tool name, redacted arguments, expected behavior, runtime/OS version, and safe error text. Never include API keys, cookies, environment files, cache databases, or other people's private match data.
