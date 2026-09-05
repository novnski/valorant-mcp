# Representative provider corpus

Two historical Henrik v4 payloads from explicitly opened, saved matches (Lotus Swiftplay and Ascent Competitive), exported through a read-only SQLite connection on 6 September 2026. Match IDs, player names/tags/PUUIDs, and party identifiers were replaced or removed; credential-like fields were scrubbed. No live history query was made. These snapshots validate normalization and byte budgets; they do not prove current endpoint availability.

`complete-provider.ts` supplies synthetic ten-player, overtime, missing-field, and respawn variants separately. The existing tiny `provider.ts` answer fixture remains deliberately partial. Run `bun test src/mcp/improvement-quality.test.ts` for coverage, exact raw navigation, and structured-content budgets through MCP.
