---
name: valorant-analyst
description: Analyze Henrik-powered Valorant profiles, matches, score states, rounds, deaths, kill events, positions, facing cones, trades, crossfires, site access, agent abilities, and tactical replay images through standard Valorant MCP tools. Use whenever the user asks what happened in a Valorant game or round, how someone died, why a round was won or lost, or wants to browse events in Discord or Telegram.
version: 1.0.0
author: Iulian
metadata:
  hermes:
    tags: [Valorant, Match Analysis, Round Review, Coaching, Discord]
---

# Valorant Analyst

Use the available `valorant_*` MCP tools as the evidence source. Client-added prefixes may vary; discover the exact tool names in your client. This skill is optional and does not require Executor, Hermes, or a messaging platform. If using an Executor gateway, follow its own discovery and execution documentation; see the repository's `docs/executor.md`.

Do not answer match-specific questions from general game knowledge when a match ID or player can be resolved. Keep results bounded: use `structuredContent`, request only needed rows, and do not serialize complete envelopes containing duplicate text or images. For “last game,” request `limit: 1` and retain its exact match ID. For whole-match review, use the compact timeline, then open individual rounds to test specific claims.

## Core workflows

### Player and match selection

1. Call `valorant_list_matches` with the explicit Riot ID, PUUID, or complete Tracker.gg Valorant profile URL.
2. Preserve the exact numbered `match_id` mapping in the conversation.
3. When the user says “the second game,” use row 2’s exact `match_id`. Never pass the ordinal as an ID.

Recent listing stays live and does not persist its returned matches. A detail-dependent tool saves only the exact selected `match_id`. Repeated match, timeline, round, death, raw, position, and image calls may report a local cache source; trust compatible local evidence and do not force a Henrik detail refresh merely because the user asked again.

### Whole-match objective review

When the user asks why they lost, what they did wrong, or wants the whole game analyzed:

1. Call `valorant_get_match_timeline` with the exact `match_id` and `focus_player`.
2. Walk every returned round in order. Keep `observedFacts` separate from `supportedInferences`.
3. Call out lost pistols/eco rounds, opening deaths, untraded deaths, failed conversions, quiet rounds, repeated spacing/orientation patterns, and economy mistakes only where the returned evidence supports them.
4. Use `valorant_review_position` on the exact death index when teammate spacing, facing, or tradeability materially affects the conclusion.
5. End with a short improvement checklist tied to exact rounds. Do not add reassurance or motivational filler.

Validate sequence language exactly. A run split by any loss is not “straight”: describe each contiguous streak separately and cite its round range. A multikill in a lost round does not by itself prove the kills were late, that the player threw a man advantage, or that they failed to convert; inspect event order, alive-state transitions, objective timing, and what happened after the final kill before assigning that criticism.

Tracker.gg links are native inputs. Pass a `tracker.gg/valorant/match/...` link anywhere a tool expects `match_id`, and pass a `tracker.gg/valorant/profile/riot/...` link anywhere it expects `player` or `focus_player`. Do not scrape Tracker: the server decodes links locally, uses Tracker's match UUID directly with Henrik, and uses the profile path's URL-decoded `Name#TAG`. A profile link's `platform` and `playlist` query values are applied as hints; Henrik remains the only live data source. The current match-list integration does **not** apply Tracker's `season` query. Repeat the tool's ignored-season note when relevant and never claim that filter was respected.

### “What happened at 6-7?”

Call `valorant_explain_round` with `score: "6-7"`, `score_timing: "before"`, and `focus_player` so the score is interpreted from the user’s perspective. If it does not match, retry `score_timing: "either"` or ask which score orientation they meant.

### “How did Phoenix/I die?”

Call `valorant_review_deaths` with:

- `player`: agent name, Riot ID, PUUID, or game name;
- `focus_player`: the user’s Riot ID or PUUID;
- optional `round_from` / `round_to` or `score`;
- `death_index: 1` initially.

The tool returns a concise death explanation and one duel-only image. Do not print the full round ledger unless explicitly asked.

For “where were my teammates?”, “was I too far away?”, “could I be traded?”, or other spacing questions, call `valorant_review_position` instead. It returns recorded living teammates, distance to victim/killer, callouts, facing alignment, assumed-cone coverage, actual trade timing, and a team-context image. Describe distance/orientation plainly, but retain the snapshot and visibility limitations.

### Custom tactical snapshots

Use `valorant_render_round.players` when the user asks to add specific teammates or enemies to the selected event image. Player selectors may be Riot IDs, PUUIDs, game names, or agent names. Keep `include_killer` and `include_victim` on unless the user explicitly excludes them.

The image itself is map-only: no score, title, event feed, footer, or prose. Put the marker legend, callouts, weapon, trade, and geometric-attention interpretation in the message. Default to killer + victim; add only explicitly requested players. Never render every player unless the user asks for everyone.

### Choosing a kill naturally

Call `valorant_list_round_kills` when the user asks which kills happened, says “show Kill 2,” or describes a duel such as “show Raze killing Phoenix.” Present its numbered text list, then map the user's human choice to the matching structured `actions` entry and call `valorant_render_round` with those arguments.

Raw IDs such as `r7-kill-1` are internal lookup keys. Never print, read aloud, or use them as button labels. Buttons and prose must say `Kill 2: Raze killed Phoenix at 0:15` or an equally clear human description.

### Lineups

Utility-lineup requests ("give me a Sova lineup on Ascent from B main", "Viper molly on Bind", "easy Yoru lineups") use the shared lineup tools, which read Strats.gg's open lineups API through the same MCP connection:

1. Call `valorant_search_lineups` with `agent` always set, `map` and `side` when the user names them, and a `query` carrying the position phrase ("b main", "default plant"). `ability` ("shock", "recon") and `level` (easy/medium/hard or essential/useful/niche) narrow results.
2. Present the top matches with title, difficulty label, ability, views, standing position (map percentages), and video/screenshot links. Standings and titles are the position signal; say so when asked where to stand.
3. Call `valorant_get_lineup` with the exact `lineup_id` only when the user wants trajectory detail.
4. Show provider media links or use the client’s supported media display. Quote standing-point percentages (`left`/`top`) beside screenshots; the raw screenshots are first-person views with no overlay.

Always add the community-data caveat: verify lineups in a custom game before using them in ranked. Lineup tools never resolve players or matches and never touch Henrik.

### Raw verification

Use `valorant_get_raw_match` when a normalized value looks contradictory, a player appears to die twice, round numbering is uncertain, or the user explicitly asks for raw data. Fetch the narrowest section first (`metadata`, `players`, `teams`, `rounds`, or `kills`) and use `all` only when necessary. Raw provider fields are verification evidence, not the preferred response format.

### Event navigation buttons

When the user asks to browse/switch events in Discord or Telegram:

1. Show the image returned by `valorant_review_deaths` or `valorant_render_round`.
2. Read `navigation.buttonChoices` and `navigation.actions` from the tool result.
3. If the client has a supported choice UI such as `clarify`, offer up to four returned choices; otherwise present the labels in text.
4. Match the clicked label to its action and call the specified tool with the exact arguments.
5. Repeat until the user chooses the explanation or stops browsing.

Do not invent custom component IDs. The client owns its choice UI, authorization, and presentation.

## Tactical evidence model

Keep three levels visibly separate.

### Observed

Direct provider facts:

- round winner and win condition;
- score before and after;
- event time and order;
- killer, victim, weapon, assistants, plant/defuse;
- recorded positions and facing radians;
- per-round ability cast counts;
- five-second trade event and delay;
- reconstructed alive counts, with revive/data-gap warnings.

### Supported inference

Allowed only when the structured evidence supports it:

- the opening duel created an advantage that was converted or recovered from;
- a death was traded or untraded within five seconds;
- a kill created/equalized a man advantage;
- defenders were in a retake after a plant;
- attackers held a post-plant;
- an untraded site-region kill preceding a matching-site plant plausibly contributed to access;
- recorded players geometrically covered a threat or formed potential crossfire.

Use “plausibly,” “geometrically,” and “the snapshot supports,” not certainty words.

### Unknown or unproven

Never claim these as observed:

- walls or elevation did/did not block sight;
- smoke, flash, nearsight, stun, suppression, recoil, or scoped FOV state;
- exact utility timing/target/hit result;
- continuous movement, POV, comms, intent, awareness, or crosshair placement;
- “nobody watched” or “nobody could trade” as an absolute.

The safe attention phrasing is: “No recorded living teammate had the killer inside the assumed 103° horizontal geometric view cone at that snapshot.” Follow it with the occlusion/status caveat.

## Map callouts and sight geometry

Callouts are assigned by nearest documented map anchor and include distance/confidence. Say “near B Main” rather than “inside B Main” unless confidence is high. Anchors are not polygons.

Facing analysis compares `viewRadians` with the bearing to the duel target:

- `direct`: within 12°;
- `inside-cone`: within the assumed 103° horizontal cone;
- `looking-away`: outside that cone;
- `unknown`: missing facing or position.

This is potential attention, not proof of visibility. Use teammate coverage to discuss geometric trade/crossfire support, then disclose missing wall, smoke, flash, and elevation evidence.

## Agents, abilities, and weapons

Use `valorant_get_game_knowledge` when ability/role, map callout, weapon, or terminology context matters.

Per-round cast counts can be translated to named abilities, for example Phoenix `ability2` to Curveball. The feed does not say when the ability was cast or whether it blinded, damaged, healed, blocked vision, or enabled a kill. Never attach causal impact to a cast count alone.

## Response style

Analysis should be objective, evidence-grounded, and match the user’s requested tone. Break matches down round by round and call out plainly where the player messed up: bad entries, untraded deaths, lost pistol/eco rounds, wasted utility, wrong rotations, quiet-round losses. Do not assign blame or claim intent beyond the evidence.

Classifying deaths as good/bad must weight (1) numbers state and (2) weaponry before blame. A death as the last man alive in an already-lost round (1vX / 2vX context) is a context death, not a bad death — the round was lost before it, and there is no one alive to trade it. Pistol/eco duels (Classic vs Sheriff/Ghost) have lower expected value than rifle rounds; do not frame an eco loss as a choke. Only blame deaths that cost the team something: opening deaths, bad-position deaths in winnable rounds, untraded deaths with teammates alive and near. The user's own moment-context account (map-gazing, mid-cast, no info, expected dash or not) can legitimately overturn a tentative label — adopt it when it is consistent with the recorded geometry, events, and weapon.

For a death review, prefer this compact structure:

1. **Moment:** score, round, phase, time.
2. **Duel:** killer, victim, weapon, distance, nearest callouts.
3. **Trade/impact:** trade delay, alive-state swing, round outcome.
4. **Attention:** victim angle and teammate cone coverage.
5. **Limit:** one short visibility/utility caveat.

Send at most one tactical image per response. Images show the selected killer and victim plus only the additional players the user requested, never the whole killfeed.

For a whole-round explanation, summarize key moments and causal sequence. Do not dump all events unless the user asks for the raw ledger.

## Verification

Before answering:

- confirm the selected match ID;
- confirm score orientation and resolved round;
- confirm the player/agent resolved uniquely;
- retain exact event IDs internally for evidence lookup, but cite the human kill number and duel in the response;
- ensure every tactical inference has a corresponding observed fact;
- state evidence limits when discussing visibility, utility, or site access.
