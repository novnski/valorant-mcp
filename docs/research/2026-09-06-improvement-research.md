# Valorant MCP: speed, data quality, and feature research

**Prepared for:** Iulian / Valorant MCP maintainers  
**Research date:** 6 September 2026  
**Code examined:** `1ddc6ad` — clean working tree at the start  
**Scope:** Research and recommendations. Preserve the local Bun/TypeScript MCP server, explicit player selection, post-match analysis, and persistence of explicitly opened matches only.

## Recommendation

Prioritize **smaller tool responses, reliable completeness checks, and quota-aware request handling**. The measurements do not justify a rewrite, a worker pool, or another database. Local match analysis is already fast; large responses and avoidable provider calls are more promising targets.

Add **patch notes, game content/icons, and rank history** after those foundations. Valorant-API is a strong content source, but this project already uses its data in the bundled knowledge and assets. The useful expansion is freshness, provenance, additional fields, and explicit asset retrieval—not simply adding another copy of the same catalog. See the existing [content attribution](/Users/iulian/workspace/code/personal/valorant-mcp/THIRD_PARTY_NOTICES.md:11) and [knowledge generator](/Users/iulian/workspace/code/personal/valorant-mcp/scripts/build-game-knowledge.ts:14).

The highest-value findings are:

| Order | Improvement                                                 | Evidence and likely benefit                                                                                                                                                                    |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Compact timeline and bounded raw results                    | A 15-round match produced **420,112 bytes** of timeline structured content. Nested event objects dominate it. Smaller results should reduce serialization, transport, and model context costs. |
| 2     | Check evidence completeness before reusing a match          | A two-player payload containing one empty round and no kills was accepted from a recent list, without a detail request or base warning.                                                        |
| 3     | Coalesce duplicate reads and respect provider quota headers | Two simultaneous identical list calls made two account calls and two history calls. Henrik quotas also count background Riot requests.                                                         |
| 4     | Correct platform and freshness metadata                     | An explicit console request returned identity platform `pc` when the account listed PC first. Knowledge timestamps describe the response time rather than the bundled source time.             |
| 5     | Patch notes and richer content                              | Current first-party documentation provides suitable read-only sources; preserve an offline path and distinguish current content from the patch of an old match.                                |

The speed implications above are recommendations based on measured payloads and local code behavior, not a measured improvement in an MCP client's or language model's response time.

## What was verified

I inspected the runtime, provider clients, cache, normalizers, tactical analysis, rendering, MCP schemas, packaging, README, architecture guidance, and evaluation harness. I compared live public metadata with the bundled files, made one bounded live lineup search, and ran isolated probes against the current implementation.

Six already-saved Henrik payloads were read through a **read-only SQLite connection**. No new player history was queried, no live match/account request was made, and the normal application cache was not written. The samples cover Competitive and Swiftplay, four maps, 9–22 rounds, and 73–154 kills. Player identities and raw match data are excluded from this report.

### Local measurements

These are exploratory measurements on this Mac using Bun 1.3.8. “Cold” below means a fresh in-process runtime analyzing an already-loaded raw payload, with an injected provider and no persistent cache. It excludes network latency, SQLite persistence, process startup, and model generation. Each cold median used 12 repetitions; warm medians used 20. Measurements use the upper middle observation when the repetition count is even.

| Saved sample        | Rounds / kills | Cold local analysis median | Warm local analysis median |
| ------------------- | -------------- | -------------------------- | -------------------------- |
| Ascent, Competitive | 15 / 106       | 2.89 ms                    | 0.73 ms                    |
| Lotus, Competitive  | 19 / 146       | 2.98 ms                    | 0.87 ms                    |
| Summit, Competitive | 19 / 141       | 2.44 ms                    | 0.84 ms                    |
| Abyss, Competitive  | 22 / 154       | 2.98 ms                    | 0.93 ms                    |
| Lotus, Swiftplay    | 9 / 78         | 1.19 ms                    | 0.40 ms                    |
| Summit, Swiftplay   | 9 / 73         | 1.12 ms                    | 0.39 ms                    |

For the 15-round Ascent sample, real MCP calls over the SDK's in-memory transport returned:

| Tool                                    | Structured JSON bytes | Text characters | Total serialized response bytes |
| --------------------------------------- | --------------------- | --------------- | ------------------------------- |
| `valorant_analyze_match`                | 35,065                | 849             | 36,003                          |
| `valorant_get_match_timeline`           | 420,112               | 6,286           | 426,665                         |
| `valorant_get_raw_match`, section `all` | 281,754               | 58,126          | 347,312                         |

The timeline's local construction took a median **19.66 ms** over ten repetitions without the derived SQLite projection. A two-marker tactical image took **42.19 ms** initially and **39.37 ms** median for eleven repeat renders; the PNG was **50,461 bytes**. The rendered image was visually inspected: map, two team-colored markers, facing indicators, and victim X were present. This was one sampled render, not an exhaustive visual audit.

Across the six payloads, recorded player locations all passed the existing map transform bounds. In the Ascent sample, all ten scoreboard kill totals matched the kill ledger. These checks support the basic path; they do not prove that every metric, event, game mode, or tactical inference is correct.

### Existing verification

- `bun run check` passed: build, strict typecheck, formatting, **139 tests / 510 expectations**, and **10 evaluation answers across 20 MCP calls**.
- `bun run smoke:package` passed: isolated install, all **15 tool schemas**, local knowledge, cached timeline, position review, PNG rendering, CLI/input checks, and authenticated localhost HTTP.
- The current evaluation fixture is deliberately small and synthetic. Its own [README](/Users/iulian/workspace/code/personal/valorant-mcp/evals/README.md:3) distinguishes deterministic answer verification from an LLM quality score.

There was no `HENRIK_API_KEY` in this process and no repository `.env`. Authenticated Henrik latency, quota headers for the user's plan, and newly proposed Henrik routes were therefore not live-tested. Existing saved payloads are representative historical inputs, not proof of current endpoint availability.

## Speed improvements

### 1. Shrink the timeline before optimizing calculation

The purportedly compact timeline embeds complete `RoundTimelineEvent` objects for opening, decisive, objective, and key events. A single event can appear in multiple fields, carrying detailed tactical context repeatedly. In the measured response, `keyMoments` contributed about **278 KB**, `opening` **91 KB**, and `decisiveEvent` **32 KB**. See [timeline construction](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/round-intelligence.ts:673).

Return a compact event reference containing event ID, round, time, actor/target identifiers, and a short fact. Keep full snapshots and attention analysis behind the existing round/death/position tools. Put shared limitations and participant identity dictionaries at match level where practical. Add bounded round selection for unusually long matches.

The raw tool has a related issue: [text truncation](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/server.ts:1327) limits its Markdown presentation, while structured content still contains the complete selected section. Introduce explicit round ranges or offsets/limits and pagination metadata. Do not silently cut arbitrary JSON in half. Preserve a deliberate verification route for exact raw fields.

**Acceptance target, not a measured result:** a default timeline below 50 KB for a normal 30-round test match, while preserving score transitions, event references, and fact/inference separation. Validate the bound on structured content as well as text. Record bytes alongside elapsed time in performance checks.

### 2. Share concurrent requests and improve quota handling

Only selected-match base loads currently share an in-flight promise. Account and recent-list reads populate their caches after awaiting the provider, allowing concurrent identical requests to duplicate work. The isolated duplicate-list probe made **four provider calls**, where two would suffice. See [account/list caching](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/valorant-runtime.ts:176) and the existing [match request coalescing](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/valorant-runtime.ts:582).

Use the same promise-sharing pattern for accounts, identical history requests, and current rank requests. Clear failed promises reliably. Allow a cached larger history result to satisfy a smaller request only when player, region, platform, filters, and freshness match. Keep history data transient.

The client currently spaces starts by `60,000 / requestsPerMinute`; the default is one start every two seconds. Three fast upstream calls therefore require approximately four seconds between the first and third start. Its 12-second fetch timeout starts **after** the throttle wait, leaving total queue time outside that deadline. See [Henrik pacing and timeout](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/henrik-client.ts:125).

Henrik documents global per-key charging that includes background Riot requests. It also provides rate-limit window, remaining/reset, cache-status, cache-TTL, and request-ID headers. A fixed outbound request rate cannot fully model that cost. Retain conservative pacing, add header-aware cooldowns, and propagate cancellation through both queueing and fetch. Retry only a bounded number of transient failures within a total deadline; do not repeatedly retry authentication or missing-data errors. [Henrik rate limiting](https://docs.henrikdev.xyz/general/rate-limiting)

A local cooldown should govern later requests after a 429, not merely appear in the error returned to the model. Multiple stdio processes still share the key's quota; the existing shared HTTP runtime can coordinate local clients without introducing a new service or durable state.

**Acceptance:** identical concurrent calls issue one request per distinct operation; no new request starts before a provider cooldown expires; cancellation ends queued work; endpoint latency, queue wait, and safe quota/cache metadata are distinguishable.

### 3. Bound transient memory and lineup work

The runtime's TTL maps remove expired entries when those exact keys are read again. Entries that are never revisited can remain resident for the process lifetime. Add lazy expiry sweeps and an entry/byte budget, with least-recently-used eviction. Keep pending work separate from reusable completed results. This is a retention risk found in [cache helpers](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/valorant-runtime.ts:946), not a measured out-of-memory incident.

Lineup catalogs currently never expire during the process, while grouped lineup results are not reused. A search without a map scans every map sequentially and only applies the result limit afterward. See [lineup search and caches](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/lineups-runtime.ts:56).

Use bounded in-memory TTLs and shared promises for catalogs/groups; reuse the same group when only filters change. Prefer explicit map searches. For cross-map searches, make the map/request budget visible and report which maps succeeded or failed. Limit concurrency while respecting provider pacing; one failed map should not masquerade as no matching lineups.

A live Sova/Haven attack search returned three results in **2.77 seconds**. This is one observation, not a latency percentile or service guarantee.

### 4. Defer larger CPU and storage changes

The renderer caches its catalog, but [loads/decodes local images again](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/round-renderer.ts:259) for each render. A bounded decoded-image cache is reasonable; a small render cache keyed by match payload hash, event, selected markers, renderer version, and asset version can help repeated navigation. Keep images as native MCP image blocks.

The observed render cost was tens of milliseconds, so prioritize it below provider calls and timeline size. Similarly, consider lazy raw-JSON loading on projection hits only after measuring actual SQLite read costs. The latest commit deliberately finalizes statements to release resources; do not undo that [lifecycle fix](/Users/iulian/workspace/code/personal/valorant-mcp/src/cache/query.ts:3) for speculative query-cache gains.

## Data quality improvements

### 1. Make cache reuse depend on the evidence the tool needs

The [recent-list completeness gate](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/valorant-runtime.ts:935) accepts most modes when there are at least two players and any round. The normalizer's base warning similarly treats more than one player as sufficient scoreboard coverage. An isolated fixture containing one empty round and zero kills passed this gate with no detail call and an empty base-warning list. Other analysis layers have their own warnings, but they do not repair that selection decision. See [base normalization warnings](/Users/iulian/workspace/code/personal/valorant-mcp/src/services/match-detail-normalizer.ts:51).

Represent completeness by capability: roster, round ledger, scoreboard, kills, economy, objectives, and positioned/facing samples. Compare against available match totals using mode-specific expectations. A remake, Deathmatch, Swiftplay, and standard Competitive match cannot use identical completeness rules. Missing must remain distinct from a verified zero.

A scoreboard may be usable when a tactical review is not. On a recent-list selection, fetch detail once only if required evidence is missing. For an already-persisted partial match, expose an **explicit refresh of that exact match ID**, with cooldown and visible provenance. Avoid repeatedly re-fetching a payload whose provider evidence is genuinely unavailable.

Compatible saved projections currently win before provider I/O. This is a good speed guarantee, but also means an incomplete selected match can remain incomplete across restarts. The scalar [completeness score](/Users/iulian/workspace/code/personal/valorant-mcp/src/cache/match-cache-projector.ts:29) is useful for rough richness ordering; it does not establish correctness or prevent every tradeoff between evidence dimensions.

**Acceptance:** a partial round ledger cannot silently become “complete”; unavailable kills cannot imply zero deaths or prove no trade; richer valid evidence is preserved; an explicit refresh affects only the selected ID; repeated ordinary reads of a compatible complete match stay offline.

### 2. Separate response time, source freshness, and match patch

The knowledge tool emits `generated_at: now()` but does not expose the bundled catalog's `generatedAt`. Rank normalization likewise sets `updatedAt` to the local request time. These timestamps can be mistaken for provider freshness. See [knowledge output](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/server.ts:645) and [rank normalization](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/valorant-runtime.ts:831).

Return distinct fields such as `response_generated_at`, `source_fetched_at`, `source_updated_at` when supplied, provider cache status/TTL, `knowledge_generated_at`, content manifest/build, and `match_patch`. Leave unknown source times null.

Current game knowledge must not silently become historical truth for an older match. Include the relevant knowledge/transform versions in derived projection invalidation, alongside the raw payload hash and analysis version. The current [projection constants](/Users/iulian/workspace/code/personal/valorant-mcp/src/cache/match-cache.ts:3) require deliberate bumps. A composite dependency fingerprint would make this harder to forget.

Do not infer competitive map rotation from the presence of a map in the asset catalog. Riot's 13.04 article explicitly changes the rotation; asset catalogs include maps outside that queue. [Riot patch 13.04](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-13-04/)

### 3. Fix platform labeling and validate provider boundaries

`playerIdentity()` currently prefers `account.platforms[0]` over the resolved request platform. In the probe, a console request with `platforms: ["pc", "console"]` returned `pc`. The MMR request itself used console; the demonstrated bug is misleading output metadata. Preserve the resolved platform and expose available platforms separately. [Identity construction](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/valorant-runtime.ts:814)

The provider clients cast JSON to TypeScript types; many MCP output schemas leave important nested structures as `z.unknown()`. Add focused validation for envelopes, identity, metadata, and the evidence fields on which analysis relies. Validate critical outputs without creating a large duplicate schema framework. [Henrik response handling](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/henrik-client.ts:125), [MCP match schemas](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/server.ts:184)

A robustness probe also showed that an HTTP 200 response carrying an envelope status of 429 becomes a non-retryable `invalid-payload` error because classification uses the HTTP status. This is **not evidence Henrik currently sends that combination**. Treat it as a boundary test, alongside malformed JSON, missing fields, and error envelopes. Strats 429s also currently fall through to `invalid-payload`; give them explicit cooldown handling. [Strats classification](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/strats-client.ts:164)

### 4. Broaden evidence tests and qualify lineup quality

Add sanitized, representative provider fixtures for overtime, surrender/remake, console, nonstandard modes, missing economy/objectives, partial snapshots, and resurrection/respawn cases. Validate round indexing, score continuity, duplicate events, numeric units, metric denominators, and unknown-vs-zero behavior. Avoid assuming scoreboard and event totals must always agree when the provider's coverage is partial.

Lineup searches sort by views. The live top-three sample contained posts from **2022–2023**; one title described very low execution reliability. Neither views nor age proves present-patch validity. Preserve creation date, source, and an explicit “patch validation unknown” state; offer relevance/recent/views sorting and avoid implying a lineup was tested in-game. The current [search ordering](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/lineups-runtime.ts:88) and [provider timestamps](/Users/iulian/workspace/code/personal/valorant-mcp/src/mcp/lineups-runtime.ts:153) supply a starting point.

Continue the existing geometric evidence limits. More icons or current ability descriptions cannot add walls, smoke state, POV, awareness, or continuous movement to old kill-event snapshots.

## Feature expansion

### Patch notes: highest-priority new tool

Propose `valorant_get_patch_notes`, with an optional patch selector, locale, bounded section selection, and a small result limit. “Latest” should be resolved from returned publication dates and patch identity, not guessed from a URL or asset build date.

Henrik documents both `GET /valorant/v1/website/{country_code}` with an optional category filter and `GET /valorant/v1/website/{country_code}/{db_id}`. The detail schema includes nullable article content, so the implementation must support a link/metadata-only result. Verify actual category values and authenticated payloads before hardcoding filters. [Website list](https://docs.henrikdev.xyz/api-reference/valorant/get-website-content-v1), [website detail](https://docs.henrikdev.xyz/api-reference/valorant/get-website-entry-by-id-v1)

At research time, Riot's newest listed patch article was **13.05, published 1 September 2026**. Valorant-API reported `release-13.05`, but its build date was **20 August**. Build date and patch publication date are different clocks. [Riot patch 13.05](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-13-05/), [live content version](https://valorant-api.com/v1/version)

Return title, patch, publication time, locale, canonical Riot URL, source/fetch time, and bounded sections. Preserve distinctions between all-platform and PC/console changes, announcements of future changes, and changes already released. Any agent/weapon relevance summary is derived analysis and should retain its source links.

Use Henrik for discovery first. A targeted Riot article fetch can be a documented fallback if desired; do not introduce a crawler. Keep only bounded in-memory reuse at runtime. The inspected Valorant-API dashboard documents game-file content endpoints, not a patch-news feed. [Valorant-API dashboard](https://dash.valorant-api.com/)

### Game information and icons: expand what is already here

Live, unauthenticated requests succeeded for Valorant-API version, playable agents, maps, and weapons. The source identifies itself as unofficial. [Provider overview](https://valorant-api.com/), [provider attribution](https://dash.valorant-api.com/about)

The comparison found:

- **29 playable agents and 20 weapons**, all already represented in the local knowledge and artwork catalogs.
- No substantive differences in compared ability descriptions after trimming whitespace, weapon fire rate/magazine/damage ranges, or callouts for maps represented locally.
- All **13 hardcoded map transforms** matched the live API fields.
- **26 maps** in the live catalog versus **16 maps with callouts** in knowledge and **18 map artworks**. The difference includes training, Skirmish, and other maps; it is not proof competitive maps are missing.
- The local knowledge snapshot was generated **24 August 2026**. Its existing generation pipeline is useful and should remain reproducible.

These checks compare selected fields, not every catalog property or image file. Sources: [agents](https://valorant-api.com/v1/agents?isPlayableCharacter=true), [maps](https://valorant-api.com/v1/maps), [weapons](https://valorant-api.com/v1/weapons), [local knowledge](/Users/iulian/workspace/code/personal/valorant-mcp/assets/valorant/knowledge.json:1), [map transforms](/Users/iulian/workspace/code/personal/valorant-mcp/src/domain/map-spatial-resources.ts:11).

Useful additions are ability icons, agent portraits/roles, weapon prices and richer stats, rank badges, season/act metadata, and explicitly requested cosmetic assets. Add a `valorant_get_game_asset` tool returning one bounded asset result, with optional native MCP image output. Use UUIDs internally; names are localized aliases. Keep the existing local knowledge tool fast and offline. If live knowledge lookup is exposed, make its network/freshness semantics explicit in the tool contract and annotations.

**Avoid downloading the complete weapons catalog for a single lookup:** the observed `/v1/weapons` JSON was **3,575,209 bytes**, largely because it includes skins. The dashboard documents per-UUID weapon and skin routes. Filter to the necessary fields before returning data; use bounded in-memory caching and respect observed cache headers. The four public JSON responses advertised a four-hour `max-age`; this is an observed caching directive, not an availability guarantee. [Weapon endpoint documentation](https://dash.valorant-api.com/endpoints/weapons)

Use a versioned, maintainer-driven content build for bundled assets and an explicit runtime lookup for fresh content. Record manifest, locale, retrieval time, selected fields, and asset hashes. Keep tactical map artwork and transforms versioned together. Do not silently rewrite repository assets while serving an MCP request.

Riot also publishes an official downloadable content catalog with images and text. Its documentation says updates are manual and can lag patches. It is a useful build-time fallback or validation source, rather than a reason to add game-account authentication. [Riot public content catalog](https://developer.riotgames.com/docs/valorant#assets)

### Other Henrik features, ranked by usefulness

| Feature                             | Recommendation                                                                                                   | Source and implementation boundary                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rank/RR history                     | **Build next.** Show recent rank changes with match references, dates, season and provider-reported adjustments. | [MMR history v2](https://docs.henrikdev.xyz/api-reference/valorant/get-mmr-history-by-puuid-v2). Explicit player and platform; bounded output; no persistence or automatic detail expansion. Do not present an `elo` field as access to Riot's hidden matchmaking rating.                                                                                     |
| Match map filter and pagination     | **Improve the existing list tool.** Useful without adding another tool.                                          | Current [v4 history schema](https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-puuid-v4) includes map, mode, size and start. Deduplicate IDs; expose the returned window honestly. The inspected schema does not establish a maximum page size, so do not assume the current 10-row paging can safely become one 20-row request.                |
| Regional status/version             | **Small useful addition**, e.g. `valorant_get_service_status`.                                                   | [Status](https://docs.henrikdev.xyz/api-reference/valorant/get-status-v1), [queue status](https://docs.henrikdev.xyz/api-reference/valorant/get-queue-status-v1), [version](https://docs.henrikdev.xyz/api-reference/valorant/get-game-version-v1). Return fetched time, source, region and bounded incidents; availability is separate from incident status. |
| Compare explicitly selected matches | **High product value after quality work.** Compare a small supplied ID set using existing analysis.              | Primarily local functionality. Separate mode, role, patch and coverage; report sample size. Never load all participants' histories or label a small sample as a reliable population trend.                                                                                                                                                                    |
| Stored history                      | **Optional bounded historical search**, not a replacement for recent history.                                    | [Stored-match guide](https://docs.henrikdev.xyz/valorant/guides/stored-matches). Results can contain holes and changing pages; `total` is the stored subset. Provider-side work can occur even on a stored-history request. Keep local listing non-persistent.                                                                                                |
| Premier lookup and results          | **Later, if useful to the user.** Read an explicitly named team or ID.                                           | [Premier team lookup](https://docs.henrikdev.xyz/api-reference/valorant/get-premier-team-by-id-v1), [lookup changes](https://docs.henrikdev.xyz/valorant/changes/v4.9.0). Preserve ambiguity and historical-team limitations; do not infer a linked team.                                                                                                     |
| Official leaderboard context        | **Optional**, bounded to a requested region/season/window.                                                       | [Leaderboard v3](https://docs.henrikdev.xyz/api-reference/valorant/get-leaderboard-v3). Useful for rank context, lower priority than the user's own post-match evidence.                                                                                                                                                                                      |
| Crosshair-code preview              | **Small convenience feature**, with one MCP image.                                                               | [Crosshair image](https://docs.henrikdev.xyz/api-reference/valorant/generate-crosshair-image-v1). User supplies a code; it cannot recover crosshair placement from a match.                                                                                                                                                                                   |
| Esports schedule / cosmetic catalog | **Low priority** for this analysis-focused project.                                                              | [Esports schedule](https://docs.henrikdev.xyz/api-reference/valorant/get-esports-schedule-v1), [weapon/skin catalog](https://dash.valorant-api.com/endpoints/weapons). Keep separate from tactical claims. Personal store/session integrations would not fit the current boundary.                                                                            |

Henrik's content endpoint can supply additional content identifiers/localization through the existing provider, but Valorant-API is the more direct fit for the requested detailed artwork and item metadata. Avoid building two overlapping catalogs without a specific fallback need. [Henrik content](https://docs.henrikdev.xyz/api-reference/valorant/get-content-v1)

### Provider cost and access

Henrik currently documents paid plans at **$10.99, $15.99 and $25.99 per month**, with published limits up to **130, 200 and 300 requests/minute**, respectively, and shorter provider caching. Actual entitlement and weighted consumption need verification against the user's key. Buying a higher tier does not repair duplicate requests, incomplete evidence, or oversized results. [Henrik premium plans](https://docs.henrikdev.xyz/general/premium)

Valorant-API's tested public metadata required no key. I did not establish a contractual rate limit or SLA from the inspected pages; do not equate unauthenticated access with unlimited capacity. Preserve existing attribution. The current task does not require purchases, subscriptions, Riot session handling, or new background ingestion.

## Suggested delivery sequence and acceptance gates

| Stage                          | Concrete scope                                                                                                                               | Done when                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Quality and output budgets | Compact timeline references; raw pagination; capability-based completeness; console label fix; source timestamps.                            | Reproductions are covered; full structured payload bounds pass; partial data yields explicit unknowns; complete saved matches still work offline.                 |
| 2 — Provider efficiency        | In-flight deduplication, safe quota/cache metadata, cooldowns, total deadlines/cancellation, bounded transient caches; bounded lineup reuse. | Concurrent duplicates collapse; cancellation/cooldown tests pass; normal and failure-path request counts are recorded; no extra durable state.                    |
| 3 — Content foundation         | Reproducible content manifest/build; bounded icon tool; explicit fresh-content lookup; patch notes with canonical links.                     | API payload contracts and missing content are tested; offline fallback works; current knowledge is distinguishable from match patch; native images are inspected. |
| 4 — Useful analysis extensions | RR history, list map/pagination support, selected-match comparison, then status or Premier based on demand.                                  | Explicit input and bounded results hold; comparisons disclose sample/coverage; no history expansion or automatic persistence.                                     |

Keep the source-boundary change narrow when implementation begins: allow Valorant-API for public game metadata/assets and optionally Riot's public news/content for the documented purpose. Retain Henrik as the only live match provider and Strats for lineups. This report does not change `AGENTS.md` or authorize a broader product redesign.

For each implementation stage, run the repository's required build, typecheck, tests, checks and package smoke. Integration validation must use an isolated cache and the packed stdio server, proving the **0 → 1 → 1 after repeat/restart → 2 selected-match** sequence and request counts. Exercise a timeline, teammate-position review, and tactical image, then inspect the image. Refresh Executor executable/tool discovery only if that installed integration is actually affected.

Use versioned response contracts or a short compatibility migration for structural changes. Add payload-byte budgets and a small representative corpus to CI; measure live provider latency separately from deterministic local tests. Proposed time/size thresholds are engineering targets to validate, not promised improvements.

## Remaining uncertainty

The authenticated Henrik feature routes need integration probes with a configured key and explicitly supplied player/match inputs where applicable. Website category values, partial history behavior, key-specific quota windows, and cancellation under real client traffic remain unmeasured. The six saved matches do not cover console, overtime, remakes or every mode. Public metadata timings and the lineup timing are single observations, and the lineup results were not tested in-game.
