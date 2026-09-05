# Optional Executor integration

The server runs directly with any compatible local stdio MCP client. Executor can provide a shared gateway when multiple assistants should use the same credential-backed connection.

Register it as `valorant_mcp` with the absolute Bun executable and `dist/mcp/server.js` path from this checkout. Declare `HENRIK_API_KEY` as a required environment credential and store the value in Executor's credential provider. An existing deployment can retain its `org/default` connection and `valorant_*` tool names when changing the executable path.

Never copy an existing credential into repository files. Set `VALORANT_MATCH_CACHE_PATH` to an isolated file when validating an integration change. Refresh the connection's discovered tools after a rebuild and verify a harmless knowledge read, then a selected match timeline and image.

If a client already connects through Executor, choose that route for this server to avoid duplicate tools. This is an integration choice, not a requirement for other users.

For dynamic Executor calls, load its execution documentation, search for the exact tool path, describe its schema, and call the returned path. Return bounded `structuredContent` rather than serializing the entire result envelope. Image blocks should be forwarded natively.
