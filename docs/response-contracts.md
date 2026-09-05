# Response contract migration

## Timeline v2

`valorant_get_match_timeline` returns `version: match-timeline-v2`. Each round's `opening`, `objective`, `decisiveEvent`, and `keyMoments` now contain event IDs. Resolve them in the match-level `events` dictionary; actor/target keys resolve in `participants`. Full tactical events, utility counts, facts and inference remain in the round/death/position tools.

The default window contains up to 30 rounds within a structured byte budget. Use `round_from`, `round_to`, and `limit`, then follow `pagination.nextRound`. `summary` always covers the whole available match, as disclosed by `summaryScope`. Unknown or incomplete kill coverage produces null focus totals and trade-absence totals. The source scoreboard remains accessible independently.

## Raw v2

`valorant_get_raw_match` returns `version: raw-page-v2`. The selected section is paged at its immediate children. Small values remain exact. Large children return a `$expand` JSON pointer, also listed in `expandable`; open it with `path` relative to the selected section. Pointer escapes follow JSON Pointer (`~1` for slash, `~0` for tilde).

Use `offset`, `limit`, and `pagination.nextOffset`. For arrays, offsets are original array indices; an array page starts at the disclosed offset. String pages use `limit * 100` characters, capped at 4,000, with character offsets. Scalars remain exact. Structured data and JSON text are never cut mid-JSON. `section: all` is a navigation entry point, not an unbounded payload download.

## Coverage and refresh

Matches expose roster, scoreboard, round, kill, economy, objective, position and facing evidence independently. A partial recent result only avoids detail I/O if it satisfies the selected tool's requirements. Compatible saved matches remain usable offline, including partial matches with explicit warnings.

To check a saved partial match for new evidence, call `valorant_get_match` with its exact ID and `refresh: true`. Refresh has a per-process 60-second cooldown and affects only that ID. A refresh cannot replace saved evidence with a payload that loses an evidence dimension. Ordinary reads never repeatedly refresh incomplete provider data.

## Time and dependencies

`generated_at` remains a response-generation timestamp for compatibility. Local knowledge also supplies `response_generated_at`, `knowledge_generated_at`, and `knowledge_version`; unknown provider update times remain null. Rank `updatedAt` is a provider timestamp when supplied and otherwise null; `fetchedAt` is the local retrieval time. Player `platform` is the resolved request platform, and `availablePlatforms` separately describes the account.

Saved projection versions now include a fingerprint of the knowledge data, map transforms, and analysis version. A changed dependency causes local reprojection of saved raw JSON before any provider I/O.

## New content and analysis contracts

- `valorant_list_matches` accepts `map` and `start`. `hasMore=null` means a full provider window with unknown further availability; `false` means a short window. `window` records raw provider rows, unique returned IDs, filters, and `nextStart`. Ordinals restart within each displayed window.
- `valorant_get_rank_history` returns up to 50 dated unique match references. `providerElo` is not hidden MMR; RR=0 is distinct from missing evidence. Refunds and derank protection are provider fields. No referenced match is opened.
- `valorant_compare_matches` returns `selected-comparison-v1`, two to five explicitly selected matches, per-match provenance/coverage, and context groups. Missing scoreboard evidence produces null metrics; group means include observed-match counts. No whole-career or causal claim is supported.
- `valorant_get_game_content` identifies requested/resolved locale, source fetch time, bundled knowledge time, content manifest/version and unknown historical applicability. Fresh lookup failure discloses bundled fallback. Runtime requests never rebuild bundled files.
- `valorant_get_game_asset` returns one native PNG block plus dimensions, source and SHA-256 metadata, without duplicating base64 in structured content. Default is offline artwork; agent ability artwork requires an explicit fresh request.
- `valorant_get_patch_notes` distinguishes `returned-provider-publications` from `known-bundled-publications`. Publication date orders latest selection. Canonical Riot links, platform sections, missing bodies, truncation and possible future announcements remain explicit. Article bodies are bounded to six 1,500-character sections.
