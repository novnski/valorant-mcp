# Design

## Runtime

```text
MCP client
    |
    | MCP stdio or local Streamable HTTP
    v
valorant-mcp
    |
    +-- player identity, rank/RR history --> Henrik API
    +-- patch publications ----------------> Henrik / bundled Riot links
    +-- recent match list -----------------> Henrik API
    +-- selected match detail ----------+--> local SQLite cache
    |                                  |
    |                                  +--> Henrik only on cache miss
    +-- lineups ---------------------------> Strats.gg open API
    +-- explicit fresh content/assets -----> Valorant-API / media host
    |
    +-- normalizers and evidence services (local, deterministic)
    +-- tactical Canvas renderer (local bundled assets)
```

The MCP process owns a small in-memory TTL cache for current account/list reads and a demand-driven local SQLite cache for selected match IDs. Recent match lists are never persisted. A detail-dependent tool checks a compatible saved focus projection, then saved raw JSON, then the transient recent-list payload, and only then calls Henrik's match-detail endpoint. Saved raw data can regenerate deterministic projections after process exit or a projection-version change.

The durable cache stores one canonical raw payload per selected match plus normalized players, rounds, round-player rows, kill events, and event-position snapshots. It is deliberately not a crawler, watchlist, scheduled sync, participant-expansion system, or historical backfill service.

## Conversational identity

Every player-facing tool accepts one `player` or `focus_player` string. `Name#TAG` resolves through the Henrik account endpoint; anything without `#` is treated as a PUUID. Tool results return the canonical PUUID so later calls can use an immutable identity.

Recent matches are numbered only for presentation. Follow-up calls always use the exact returned `match_id`, preventing ambiguous references such as "game two" from becoming a guessed identifier.

## Analysis layers

1. Provider-shaped match JSON is normalized into one `MatchDetail` vocabulary.
2. Deterministic services derive round turning points, performance, economy, damage, objectives, ability usage, duel matchups, and round event evidence.
3. Round intelligence resolves human score references, reconstructs alive counts, trade windows, phases, callouts, and geometric attention.
4. Local game knowledge maps agent slots to named abilities and raw positions to nearest callout anchors.
5. Versioned projections bound and validate the model-facing data, with raw Henrik sections available for double-checking.
6. A compact match timeline supplies one fact/inference-separated row per round, while position review relates one death snapshot to recorded living teammates and renders that exact context.
7. The language model explains the evidence conversationally but cannot claim unsupported POV, intent, comms, continuous movement, utility effects, or proven line of sight.

## Images

The renderer uses local assets and documented map coordinate transforms. It produces a square map with no title, score, event ledger, footer, or prose. The default is killer + victim; callers can request arbitrary additional players from that event snapshot. Agent icons are 36 pixels and facing is shown as a solid triangle rather than a line.

The message owns the marker legend, weapon, distance, nearest callouts, trade result, round outcome, and attention interpretation. Images stay composable and readable instead of becoming screenshots of a dashboard.

MCP returns the PNG as an `image` content block. Clients decide how to display or forward the native image content.

## Security

- All tools are read-only and marked accordingly.
- Input schemas bound identifiers, limits, regions, platforms, round numbers, and event IDs.
- The API key is read from the process environment and never returned or logged.
- The stdio server writes protocol messages only to stdout and diagnostics only to stderr.
- No shell execution, arbitrary SQL, public listener, or remote write API exists. The only local write is the permission-restricted match cache for explicitly selected IDs.
- Raw payloads are recursively scrubbed for sensitive key names before persistence, hashed, deduplicated, and never allowed to overwrite richer evidence with poorer evidence.

## Transport modes

One tool factory serves stdio and authenticated localhost Streamable HTTP through the current SDK. The SDK handles modern and legacy protocol negotiation. HTTP uses a fresh protocol server per request, with one shared application runtime for the single local user; the shared runtime owns request pacing and the selected-match cache. No protocol sessions or user accounts are stored.

HTTP binds only to IPv4 loopback, enforces a separate Bearer token, validates Host and Origin, and caps request bodies at 1 MiB. It does not enable cross-origin browser access. The Henrik credential is never accepted from an HTTP request. Stdio remains the default and reserves stdout for protocol messages. EOF and termination signals close the runtime; HTTP termination also closes the listener.

## Bounded provider and content reads

`ProviderTransport` serializes request starts, observes safe quota/cache headers, applies shared cooldowns, and bounds queue/fetch/body time. Requests share pending reads; cancelling one waiter does not cancel others, while the final cancelled waiter aborts upstream work. Transient TTL/LRU caches have entry and byte budgets, including lineup catalogs and selected public content. HTTP tool factories share these runtimes. These caches add no durable state.

Capability coverage independently describes roster, scoreboard, rounds, kills, economy, objectives, positions and facing. Missing evidence yields partial/unknown values rather than invented zeros or complete tactical claims. Saved projection keys include the analysis version plus knowledge and transform hashes, so content changes trigger local reprojection without Henrik I/O.

Public content is a narrow metadata/artwork exception to the Henrik match-data boundary. Runtime lookups request a single UUID and selected fields, verify image-host URLs, and return at most one 512px/256KiB PNG. Maintainer fetch/build scripts produce reproducible, hashed source/content/asset manifests. Current builds and bundled roles do not prove historical patch applicability or competitive map rotation.

RR history lists references without opening matches. Recent-list windows retain provider offsets while removing duplicate IDs; a full window leaves further availability unknown. Comparisons load only two to five explicit IDs and group descriptive metrics by map, mode, patch and role with coverage denominators. They do not discover history or claim skill trends.
