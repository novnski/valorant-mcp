# Improvement implementation results

Goal: implement the four delivery stages in `2026-09-06-improvement-research.md`. Optional Premier/status/stored-history/leaderboard/crosshair/esports features remain deferred. All four stages are complete. No commits, pushes, or live player-history requests were made. The existing Executor connection was refreshed to discover the rebuilt server's 20 tools; its credential was not read or changed.

## Stage 1 — implemented and verified

- Versioned compact timeline event/participant dictionaries, bounded round windows and structured byte budgets.
- Versioned exact raw pages with expandable JSON pointers and explicit string/array pagination.
- Capability coverage, conservative missing-vs-zero behavior, exact-ID refresh/cooldown and preservation of evidence dimensions.
- Resolved console platform, separate account platforms, provider-vs-response timestamps, bundled knowledge timestamps and projection dependency fingerprint.
- Anonymized saved Competitive/Swiftplay corpus plus synthetic complete roster/overtime/missing-field/respawn fixtures.
- Corrected zero-based kill indexing even when the first round has no kills; raw snapshot lookup now binds round as well as time/participants.
- Partial evidence no longer produces complete combat metrics or unsupported combat recommendations.

Verification on 6 September 2026: `bun run check` passed (build, strict typecheck, formatting, **149 tests / 621 expectations**, 10 evaluation answers / 20 calls). `bun run smoke:package` passed with packed stdio **0 → 1 → 1 after repeat/restart → 2** persisted matches and exactly **two** selected detail requests, plus timeline/position/PNG/HTTP checks. Tactical PNG was visually inspected (two team-colored markers, facing indicators, victim X).

Logs: `/tmp/valorant-stage1-check.log`, `/tmp/valorant-stage1-package.log`. Response migration: `docs/response-contracts.md`.

A real Swiftplay fixture has 78 ledger eliminations vs 77 scoreboard kills, including a self-elimination absent from scoreboard totals. This remains an explicit coverage mismatch, not a forced equality. Saved fixtures do not establish current authenticated endpoint availability.

## Stage 2 — implemented and verified

Shared account/history/rank reads, larger-window memory reuse, bounded TTL/LRU caches, shared cancellation with independent waiters, safe provider boundary validation, quota/cache/timing metadata, cooldowns, and queue/fetch/body deadlines are implemented. Lineup catalogs/groups/details now have bounded reuse, cross-map budgets and explicit failures/skips, sorting, source dates and unknown patch validation.

`bun run check` passed (**156 tests / 658 expectations**, 10 evaluation answers); package smoke passed the same selected-ID persistence/request-count sequence. A live public Sova/Haven search made **3** requests; changing its position filter made **0** requests. Both searches returned results. Logs: `/tmp/valorant-stage2-check.log`, `/tmp/valorant-stage2-package.log`, `/tmp/valorant-stage2-live-lineups.log`.

No Henrik key is configured in the current process. A no-key website discovery probe returned HTTP 401; authenticated routes remain to be verified with an authorized connection. No account or match identifiers were sent in that probe.

## Stage 3 — implemented and verified

The deliberate content fetch/build pipeline now records source URLs/hashes, locale, fetch time, content build, selected fields, map-transform hash and bundled asset hashes. Rebuilding the same downloaded snapshot into a separate directory produced byte-identical knowledge and manifests. The snapshot contains 29 playable agents, 26 maps and 20 weapons. Runtime reads never update repository assets.

Three new tools expose one public content item, one bounded native PNG, and canonical patch publications. Metadata uses per-UUID endpoints; images allow only the public media host, honor cache control, and carry dimensions/hash without duplicate base64. Patch selection uses publication dates, keeps platform/future wording, and discloses missing bodies and fallback scope.

Stage check passed **162 tests / 690 expectations**, 10 evaluation answers, and an 18-tool packed smoke. A fresh Vandal lookup returned **955 bytes**, source `valorant-api.com`, manifest `3A0EBC92259BF798`, price 2900. Sova ability (24,422 bytes) and portrait (77,136 bytes) PNGs were visually inspected. Logs: `/tmp/valorant-stage3-check.log`, `/tmp/valorant-stage3-package.log`, `/tmp/valorant-stage3-live-content-fixed.log`.

## Stage 4 — implemented and verified

`valorant_get_rank_history` returns at most 50 unique dated references, preserves RR=0/refunds/derank protection, identifies provider Elo correctly and opens no matches. The existing list tool accepts map/start, deduplicates IDs, preserves provider offsets, and makes unknown further availability explicit. `valorant_compare_matches` opens two to five distinct supplied IDs for one explicit player, reports per-match coverage/provenance and descriptive groups by map/mode/patch/role, and never expands history.

Focused tests prove filter cache separation, ten-row provider pagination, zero persistence for RR/list reads, selected-only comparison persistence and offline restart reuse. Saved real Competitive/Swiftplay data exercises mixed comparison contexts and sparse evidence. Provider identity/schema failures and MCP bounds are tested.

## Final verification — 6 September 2026

- `bun run check` passed: build, strict typecheck, configured formatting, **168 tests / 726 expectations**, and **10 evaluation answers across 20 MCP calls**.
- `bun run smoke:package` passed: isolated packed install, all **20 schemas**, offline knowledge/content/icon/patch fallback, RR/list zero-write proof, timeline/position/tactical PNG, repeat/restart reuse, selected comparison, CLI and authenticated loopback HTTP.
- Packed persistence/request proof: **0 → 1 → 1 after repeat/restart → 2**, exactly **two** selected detail requests. Comparing both saved IDs leaves the count at two and performs no additional detail request.
- `git diff --check` passed. Tactical map and public content images were visually inspected. The original research document is unchanged; response-contract migration is documented separately.

Final logs: `/tmp/valorant-stage4-check.log`, `/tmp/valorant-stage4-package.log`, `/tmp/valorant-final-response-bench.json`.

| Timeline fixture              | Rounds returned | Structured bytes | Full MCP result bytes | Local single-run time |
| ----------------------------- | --------------: | ---------------: | --------------------: | --------------------: |
| Saved real Lotus Swiftplay    |               9 |           15,276 |                17,746 |                 42 ms |
| Saved real Ascent Competitive |              15 |           20,612 |                25,586 |                 33 ms |
| Synthetic complete overtime   |              30 |           20,947 |                29,974 |                 35 ms |

These are local fixture observations with one mocked detail request each, not live endpoint latency percentiles. The structured limit is also asserted in protocol tests, including exact raw pagination. JSON presentation intentionally mirrors the structured result and therefore has additional wire overhead.

## Integration and live limitations

The existing `valorant_mcp.org.default` Executor connection launched the rebuilt code and now discovers all **20 tools**, including RR and comparison schemas. A local Sova asset read returned one 128px image with no provider requests. No executable path change was necessary, and no credential was handled.

Authenticated Henrik patch discovery succeeded through that connection: two HTTP 200 requests returned Riot's **13.05 publication dated 1 September 2026**. The article body was null; the tool returned `metadata-only` with the canonical Riot link. The observed provider quota limit was 30, remaining 29 then 28; queue/upstream timings were separate. This supersedes the earlier unauthenticated 401 limitation for news discovery only.

RR and live match-history filters were verified against the documented endpoint contracts and isolated fixtures, not a live personal account: the task supplied no explicit player to query. Saved anonymized real match fixtures validate data behavior, not current provider availability for every mode/platform. Optional status/Premier/stored-history/leaderboard/crosshair/esports and speculative renderer/storage optimizations remain deferred as the research recommends.

Henrik rate-limit documentation was retrieved to `/tmp/valorant-henrik-rate-doc.html`: `X-RateLimit-Reset` is seconds until reset (not an epoch); only bounded safe quota/cache/timing/request-ID metadata is surfaced.
