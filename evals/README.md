# Evaluation tasks

`evaluation.xml` contains ten independent multi-tool tasks against the synthetic Henrik-shaped match `cache-match-1`, player `Focus#EU`, region `eu`, platform `pc`. No real match IDs, player identities, or credentials are required. The fixture is intentionally small so expected answers are stable and inspectable; it is a baseline for evidence retrieval, not a claim of comprehensive coaching quality.

Run `bun run eval:verify` to solve and verify the reference answers through the real MCP protocol. It compares results across tools and fails on answer drift. This is deterministic reference verification, not an LLM evaluation score.

For an LLM evaluation, connect a separate test MCP client to `bun /absolute/path/to/valorant-mcp/evals/serve.ts` and ask each XML question independently. Compare its final answer to the corresponding exact string. Match/account tools use only the fixture in this harness; lineup tools retain their normal Strats.gg behavior and are not part of these questions. Never configure the fixture server as your regular player-analysis server.
