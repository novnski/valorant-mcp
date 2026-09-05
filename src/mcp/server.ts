#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { startHttpServer } from "./http";
import { actionableError } from "./errors";
import { handleCliArgs, serverInfo, httpPort } from "./cli";
import { LineupsRuntime, type LineupSide } from "./lineups-runtime";
import { findAgentKnowledge, findMapKnowledge, findWeaponKnowledge, valorantTerminology } from "./game-knowledge";
import { renderTacticalSnapshotImage } from "./round-renderer";
import type { DuelReplay, ScoreTiming } from "./round-intelligence";
import { ValorantRuntime, type ValorantPlatform, type ValorantRegion } from "./valorant-runtime";

export type ValorantToolRuntime = Pick<
  ValorantRuntime,
  | "getPlayer"
  | "listMatches"
  | "getMatch"
  | "getMatchProjection"
  | "analyzeMatch"
  | "getMatchTimeline"
  | "getRound"
  | "explainRound"
  | "listRoundKills"
  | "reviewDeaths"
  | "reviewPosition"
  | "getDuelReplay"
  | "getTacticalSnapshot"
  | "getRawMatch"
>;

const regionSchema = z
  .enum(["na", "eu", "latam", "br", "ap", "kr"])
  .default("eu")
  .describe("Valorant shard. Use the player's real shard; default is eu.");
const platformSchema = z
  .enum(["pc", "console"])
  .default("pc")
  .describe("Valorant platform. PC and console histories are isolated.");
const playerSchema = z
  .string()
  .trim()
  .min(3)
  .max(1_024)
  .describe(
    "A Riot ID such as Name#TAG, exact PUUID, or full tracker.gg/valorant/profile/riot/... URL. Tracker profile URLs are decoded locally and never fetched at runtime.",
  );
const matchIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(1_024)
  .describe(
    "An exact Henrik match_id or full tracker.gg/valorant/match/... URL. Tracker match URLs contain the same match UUID Henrik uses.",
  );
const focusPlayerSchema = playerSchema
  .optional()
  .describe("Optional Riot ID, PUUID, or Tracker.gg profile URL for the perspective to highlight.");
const matchPlayerSelectorSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .describe("A player Riot ID, PUUID, game name, agent name, or full Tracker.gg Valorant profile URL.");
const responseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("markdown is compact for conversation; json mirrors the complete structured result.");
const scoreSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}\s*[-:–]\s*\d{1,2}$/, "Score must use A-B format, for example 6-7")
  .optional()
  .describe("Optional score selector from the focus player's perspective, for example 6-7.");
const scoreTimingSchema = z
  .enum(["before", "after", "either"])
  .default("before")
  .describe(
    "Whether the score identifies the state before or after the round. Natural 'at 6-7' questions usually mean before.",
  );

const toolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createValorantMcpServer(
  runtime: ValorantToolRuntime,
  lineupsRuntime: LineupsRuntime = new LineupsRuntime(),
): McpServer {
  const server = new McpServer(serverInfo, {
    instructions:
      "Read-only post-match analysis. Use explicit player IDs and exact returned match IDs. Listing stays live; opening a match saves it locally. Treat kill positions as discrete snapshots, never continuous movement or proven visibility. Cite round evidence and distinguish observed facts from inferences.",
  });

  server.registerTool(
    "valorant_get_player",
    {
      title: "Get Valorant player",
      description: `Resolve any Riot ID, PUUID, or Tracker.gg Valorant profile link through Henrik and return identity plus current and peak rank.

Use this before match tools when you need the canonical PUUID. It is never tied to a configured profile and stores nothing in a database.

Examples:
- "Who is Name#TAG?" -> player="Name#TAG", region="eu"
- "Resolve this PUUID" -> player="<puuid>"

For recent games use valorant_list_matches instead.`,
      inputSchema: z
        .object({
          player: playerSchema,
          region: regionSchema,
          platform: platformSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_player"),
        generated_at: z.string(),
        identity: z.object({ puuid: z.string(), riotId: z.string() }).passthrough(),
      }),
      annotations: toolAnnotations,
    },
    async ({ player, region, platform, response_format }) =>
      withToolErrors(async () => {
        const profile = await runtime.getPlayer(player, region as ValorantRegion, platform as ValorantPlatform);
        const output = { kind: "valorant_player" as const, generated_at: now(), ...profile };
        return result(output, formatPlayer(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_list_matches",
    {
      title: "List recent Valorant matches",
      description: `List recent Henrik matches for any Riot ID, PUUID, or Tracker.gg Valorant profile link, numbered newest-first for conversational selection.

Each row contains an index and exact match_id. When the user says "open the second game", take match_id from index 2 and pass it to valorant_get_match, valorant_analyze_match, or valorant_get_round. Never treat the ordinal itself as a match ID.

Args include an optional Henrik queue/mode filter such as competitive, unrated, swiftplay, or deathmatch. Default limit is 5, maximum 20.

Listing stays live and does not persist any returned match. Only a later detail-dependent call for one exact match_id may save that selected match.`,
      inputSchema: z
        .object({
          player: playerSchema,
          region: regionSchema,
          platform: platformSchema,
          limit: z.number().int().min(1).max(20).default(5).describe("Number of newest matches to return."),
          mode: z
            .string()
            .trim()
            .min(1)
            .max(48)
            .optional()
            .describe("Optional Henrik mode/queue filter, usually competitive."),
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_match_list"),
        generated_at: z.string(),
        matches: z.array(z.looseObject({ index: z.number().int(), matchId: z.string() })),
      }),
      annotations: toolAnnotations,
    },
    async ({ player, region, platform, limit, mode, response_format }) =>
      withToolErrors(async () => {
        const matches = await runtime.listMatches({
          player,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          limit,
          mode,
        });
        const output = { kind: "valorant_match_list" as const, generated_at: now(), ...matches };
        return result(output, formatMatches(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_get_match",
    {
      title: "Get Valorant match",
      description: `Load one exact match ID or Tracker.gg Valorant match link from a compatible local projection/raw payload first, falling back to Henrik match detail only on cache miss, then return its teams, score, players, combat scoreboard, coverage, and deterministic scoreboard supplements.

Use the exact match_id from valorant_list_matches. Set focus_player to the Riot ID or PUUID being discussed so the response identifies that player's perspective. Use valorant_analyze_match for deeper performance/economy/duel analysis and valorant_get_round for event-level evidence.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          region: regionSchema,
          platform: platformSchema,
          focus_player: focusPlayerSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_match"),
        generated_at: z.string(),
        match: z.unknown(),
        scoreboard: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({ match_id, region, platform, focus_player, response_format }) =>
      withToolErrors(async () => {
        const projection = await runtime.getMatchProjection({
          matchId: match_id,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        });
        const output = { kind: "valorant_match" as const, generated_at: now(), ...projection };
        return result(output, formatMatch(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_analyze_match",
    {
      title: "Analyze Valorant match",
      description: `Build evidence-grounded post-match analysis from demand-cached match detail, using Henrik only when the selected match is not available locally.

Returns deterministic turning points plus performance, economy, opponent damage, objectives, abilities, duel matchups, scoreboard supplements, and spatial coverage. Use this to answer why a match was won/lost, then drill into cited round numbers with valorant_get_round. Claims are limited to recorded evidence; no POV, comms, intent, continuous movement, or crosshair placement is inferred.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          region: regionSchema,
          platform: platformSchema,
          focus_player: focusPlayerSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_match_analysis"),
        generated_at: z.string(),
        match: z.unknown(),
        analysis: z.unknown(),
        features: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({ match_id, region, platform, focus_player, response_format }) =>
      withToolErrors(async () => {
        const analysis = await runtime.analyzeMatch({
          matchId: match_id,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        });
        const output = { kind: "valorant_match_analysis" as const, generated_at: now(), ...analysis };
        return result(output, formatAnalysis(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_get_match_timeline",
    {
      title: "Get objective Valorant match timeline",
      description: `Return one compact evidence row per round for objective whole-match analysis.

Use this after selecting an exact match when the user asks what they did wrong across the game. Each row separates observed facts from supported inference and includes score, side, outcome, opening duel, focus kills/deaths, objectives, decisive events, utility counts, and evidence limits. This is the preferred one-call input for blunt round-by-round review; drill into a cited death with valorant_review_position.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          region: regionSchema,
          platform: platformSchema,
          focus_player: focusPlayerSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_match_timeline"),
        generated_at: z.string(),
        rounds: z.array(z.unknown()),
        summary: z.unknown(),
        cache: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({ match_id, region, platform, focus_player, response_format }) =>
      withToolErrors(async () => {
        const timeline = await runtime.getMatchTimeline({
          matchId: match_id,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        });
        const output = { kind: "valorant_match_timeline" as const, generated_at: now(), ...timeline };
        return result(output, formatMatchTimeline(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_get_round",
    {
      title: "Get Valorant round evidence",
      description: `Return the exact event ledger, player round stats, sparse positions, objective events, turning points, and evidence-backed explanation facts for one round.

Use this after valorant_get_match or valorant_analyze_match when the user names a round, for example "how did we lose round 7?" Round numbers are one-based. The returned kill event IDs can be passed to valorant_render_round to render a specific moment.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          round_number: z.number().int().min(1).max(100).describe("One-based round number."),
          region: regionSchema,
          platform: platformSchema,
          focus_player: focusPlayerSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_round"),
        generated_at: z.string(),
        round: z.unknown(),
        spatial: z.unknown(),
        explanationFacts: z.array(z.string()),
      }),
      annotations: toolAnnotations,
    },
    async ({ match_id, round_number, region, platform, focus_player, response_format }) =>
      withToolErrors(async () => {
        const round = await runtime.getRound({
          matchId: match_id,
          roundNumber: round_number,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        });
        const output = { kind: "valorant_round" as const, generated_at: now(), ...round };
        return result(output, formatRound(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_explain_round",
    {
      title: "Explain a Valorant round",
      description: `Resolve a round by one-based round number or by score state and return a compact, Valorant-aware timeline.

Use this for questions such as "what happened at 6-7?", "why did we lose this round?", or "how did they get B?". The result separates observed facts from supported tactical inferences and includes sides, score before/after, opening duel, man-advantage swings, trades, plant/post-plant/retake phases, decisive event, nearest map callouts, and named ability-cast context.

Map callouts use the nearest documented anchor rather than invented polygons. Site-access inferences require a site-region event followed by a matching plant. Visibility claims remain geometric and disclose missing walls, smoke, flash, and occlusion evidence. Provide focus_player whenever the score is from a user's perspective.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          round_number: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("One-based round number. Omit when using score."),
          score: scoreSchema,
          score_timing: scoreTimingSchema,
          region: regionSchema,
          platform: platformSchema,
          focus_player: focusPlayerSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_round_explanation"),
        generated_at: z.string(),
        matched_by: z.string(),
        intelligence: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({ match_id, round_number, score, score_timing, region, platform, focus_player, response_format }) =>
      withToolErrors(async () => {
        const explanation = await runtime.explainRound({
          matchId: match_id,
          roundNumber: round_number,
          score,
          scoreTiming: score_timing as ScoreTiming,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        });
        const output = {
          kind: "valorant_round_explanation" as const,
          generated_at: now(),
          matched_by: explanation.matchedBy,
          intelligence: explanation.intelligence,
          cache: explanation.cache,
        };
        return result(output, formatRoundExplanation(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_list_round_kills",
    {
      title: "List a Valorant round's kills",
      description: `List every kill in a round as a short, numbered, human-readable sequence.

Use this before rendering when the user asks what kills are available or describes a kill naturally. The visible list says who killed whom, with agent names, weapon, time, distance, callouts, and trade state. Internal event IDs remain only in structured action arguments; never show them to the user.

Examples:
- "What kills happened in round 7?" -> list the numbered kills
- "Show me Kill 2" -> match number 2 and call valorant_render_round with its internal event_id
- "Show Raze killing Phoenix" -> find the matching row and render its internal event_id

The round may be selected by one-based round_number or a focus-perspective score such as 6-7. Provide focus_player for score lookup.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          round_number: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("One-based round number. Omit when using score."),
          score: scoreSchema,
          score_timing: scoreTimingSchema,
          region: regionSchema,
          platform: platformSchema,
          focus_player: focusPlayerSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_round_kill_list"),
        generated_at: z.string(),
        round_number: z.number().int(),
        kills: z.array(z.unknown()),
        actions: z.array(z.unknown()),
      }),
      annotations: toolAnnotations,
    },
    async ({ match_id, round_number, score, score_timing, region, platform, focus_player, response_format }) =>
      withToolErrors(async () => {
        const killList = await runtime.listRoundKills({
          matchId: match_id,
          roundNumber: round_number,
          score,
          scoreTiming: score_timing as ScoreTiming,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        });
        const actions = killList.kills.map((kill) => ({
          label: kill.label,
          tool: "valorant_render_round",
          arguments: {
            match_id,
            round_number: killList.roundNumber,
            event_id: kill.eventId,
            region,
            platform,
            focus_player,
          },
        }));
        const output = {
          kind: "valorant_round_kill_list" as const,
          generated_at: now(),
          match_id,
          round_number: killList.roundNumber,
          map: killList.map,
          score: killList.score,
          kills: killList.kills,
          actions,
          cache: killList.cache,
        };
        return result(output, formatRoundKillList(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_review_deaths",
    {
      title: "Review player deaths",
      description: `Find and explain a player's deaths in one match, optionally limited by round range or score state, and render the selected killer-victim duel.

The player selector accepts a Riot ID, PUUID, game name, or agent name such as Phoenix. Examples: "How did Phoenix die from rounds 3 to 6?" and "How did I die when it was 1-11?". Each death reports killer, victim, weapon, distance, nearest callouts, phase, alive-state impact, five-second trade result, geometric facing/coverage, and round outcome.

When the user asks to browse deaths, show the returned image and offer navigation.buttonChoices using the client’s supported choice UI. Map "Previous death" or "Next death" to another valorant_review_deaths call with the returned death index. Map "Explain this round" to valorant_explain_round and "Show this duel" to valorant_render_round.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          player: matchPlayerSelectorSchema.optional().describe("Player or agent to review. Defaults to focus_player."),
          focus_player: focusPlayerSchema,
          round_from: z.number().int().min(1).max(100).optional(),
          round_to: z.number().int().min(1).max(100).optional(),
          score: scoreSchema,
          score_timing: scoreTimingSchema,
          death_index: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(1)
            .describe("One-based death within the filtered results."),
          region: regionSchema,
          platform: platformSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_death_review"),
        generated_at: z.string(),
        review: z.unknown(),
        navigation: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({
      match_id,
      player,
      focus_player,
      round_from,
      round_to,
      score,
      score_timing,
      death_index,
      region,
      platform,
      response_format,
    }) =>
      withToolErrors(async () => {
        const common = {
          matchId: match_id,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        };
        const review = await runtime.reviewDeaths({
          ...common,
          player,
          roundFrom: round_from,
          roundTo: round_to,
          score,
          scoreTiming: score_timing as ScoreTiming,
          deathIndex: death_index,
        });
        const snapshot = review.selected
          ? await runtime.getTacticalSnapshot({
              ...common,
              roundNumber: review.selected.roundNumber,
              eventId: review.selected.eventId,
            })
          : null;
        const replay = snapshot?.replay ?? null;
        const navigation = replay
          ? navigationForReplay(replay, { match_id, region, platform, focus_player })
          : review.navigation;
        const output = { kind: "valorant_death_review" as const, generated_at: now(), review, navigation };
        if (!replay) return result(output, formatDeathReview(output), response_format);
        const rendered = await renderTacticalSnapshotImage(snapshot!);
        return {
          content: [
            {
              type: "text" as const,
              text:
                response_format === "json"
                  ? JSON.stringify(output, null, 2)
                  : `${formatDeathReview(output)}${cacheWarningText(output)}`,
            },
            { type: "image" as const, data: rendered.buffer.toString("base64"), mimeType: "image/png" },
          ],
          structuredContent: output,
        };
      }),
  );

  server.registerTool(
    "valorant_review_position",
    {
      title: "Review death position relative to teammates",
      description: `Review one recorded death relative to living teammates at the exact kill-event snapshot and return a team-context tactical PNG.

Use this for questions such as "When I died here, where were my teammates?", "Was I too far away?", or "Could anyone trade me?". The result includes teammate distance to the victim and killer, nearest callouts, facing alignment, assumed-cone coverage, actual five-second trade evidence, and separate observed/inference text. It never claims walls, smoke, elevation, visibility, comms, awareness, intent, or continuous movement.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          player: matchPlayerSelectorSchema.describe("Player or agent whose death should be reviewed."),
          round_from: z.number().int().min(1).max(100).optional(),
          round_to: z.number().int().min(1).max(100).optional(),
          score: scoreSchema,
          score_timing: scoreTimingSchema,
          death_index: z.number().int().min(1).max(100).default(1),
          region: regionSchema,
          platform: platformSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_position_review"),
        generated_at: z.string(),
        death: z.unknown(),
        teammates: z.array(z.unknown()),
        observedFacts: z.array(z.string()),
        supportedInferences: z.array(z.string()),
        cache: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({
      match_id,
      player,
      round_from,
      round_to,
      score,
      score_timing,
      death_index,
      region,
      platform,
      response_format,
    }) =>
      withToolErrors(async () => {
        const review = await runtime.reviewPosition({
          matchId: match_id,
          player,
          roundFrom: round_from,
          roundTo: round_to,
          score,
          scoreTiming: score_timing as ScoreTiming,
          deathIndex: death_index,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
        });
        const rendered = await renderTacticalSnapshotImage(review.snapshot);
        const { snapshot: _snapshot, ...structuredReview } = review;
        const output = { kind: "valorant_position_review" as const, generated_at: now(), ...structuredReview };
        return {
          content: [
            {
              type: "text" as const,
              text:
                response_format === "json"
                  ? JSON.stringify(output, null, 2)
                  : `${formatPositionReview(output)}${cacheWarningText(output)}`,
            },
            { type: "image" as const, data: rendered.buffer.toString("base64"), mimeType: "image/png" },
          ],
          structuredContent: output,
        };
      }),
  );

  server.registerTool(
    "valorant_get_game_knowledge",
    {
      title: "Get Valorant game knowledge",
      description: `Return local normalized game knowledge for an agent, map, weapon, or tactical term.

Use this when a match explanation needs ability names/roles, map callout anchors, weapon damage/category, or terminology such as trade, crossfire, site access, post-plant, retake, clutch, or line of sight. The knowledge is static and local; it does not make another network request. Callout locations are anchors, not region polygons.`,
      inputSchema: z
        .object({
          agent: z.string().trim().min(1).max(80).optional(),
          map: z.string().trim().min(1).max(80).optional(),
          weapon: z.string().trim().min(1).max(80).optional(),
          term: z.string().trim().min(1).max(80).optional(),
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({ kind: z.literal("valorant_game_knowledge"), generated_at: z.string() }),
      annotations: { ...toolAnnotations, openWorldHint: false },
    },
    async ({ agent, map, weapon, term, response_format }) =>
      withToolErrors(async () => {
        if (!agent && !map && !weapon && !term) throw new Error("Provide at least one of agent, map, weapon, or term");
        const normalizedTerm = term?.trim().toLocaleLowerCase();
        const output = {
          kind: "valorant_game_knowledge" as const,
          generated_at: now(),
          agent: agent ? findAgentKnowledge(agent) : null,
          map: map ? findMapKnowledge(map) : null,
          weapon: weapon ? findWeaponKnowledge(weapon) : null,
          term: normalizedTerm
            ? { name: normalizedTerm, definition: valorantTerminology[normalizedTerm] ?? null }
            : null,
        };
        return result(output, formatGameKnowledge(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_get_raw_match",
    {
      title: "Get raw Henrik match data",
      description: `Return an exact raw section of one saved-or-live Henrik match payload for verification and edge-case investigation.

Use this only when normalized evidence needs to be double-checked. Select metadata, players, teams, rounds, or kills before requesting all. Raw data can be large and uses provider field names and zero/one-based conventions; prefer normalized tools for ordinary answers. The payload contains match participants but never the Henrik API key.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          section: z.enum(["metadata", "players", "teams", "rounds", "kills", "all"]).default("metadata"),
          region: regionSchema,
          platform: platformSchema,
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_raw_match"),
        generated_at: z.string(),
        match_id: z.string(),
        section: z.string(),
        data: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({ match_id, section, region, platform, response_format }) =>
      withToolErrors(async () => {
        const raw = await runtime.getRawMatch({
          matchId: match_id,
          section,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
        });
        const output = { kind: "valorant_raw_match" as const, generated_at: now(), match_id, ...raw };
        return result(output, formatRawMatch(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_render_round",
    {
      title: "Render one Valorant duel",
      description: `Render a compact tactical PNG for one kill/death event, never a whole-round player scatter.

The PNG contains only the square map, small agent markers, and solid direction triangles tucked beneath the portraits and pointing along recorded facing. All text, score, weapon, callout, and event details stay in the message. Provide event_id for an exact kill. If event_id is omitted, the tool selects the focus player's first death in the resolved round, otherwise the round-closing kill.

Use players to add any explicit Riot IDs, PUUIDs, game names, or agent names from that exact event snapshot. Killer and victim are included by default but can be disabled. This supports arbitrary views such as the user + three enemies, or killer + victim + one teammate. Missing positions are reported rather than guessed.

The round can be selected by round_number or score. Use valorant_list_round_kills when the user names a kill naturally or asks which kills are available. The result includes human-readable previous/next labels and exact internal navigation actions. Clients can offer navigation.buttonChoices and re-call this tool with the chosen action's arguments. Never display raw event IDs.`,
      inputSchema: z
        .object({
          match_id: matchIdSchema,
          round_number: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("One-based round number. Omit when using score."),
          score: scoreSchema,
          score_timing: scoreTimingSchema,
          event_id: z
            .string()
            .trim()
            .min(4)
            .max(160)
            .optional()
            .describe("Internal kill event ID returned by valorant_list_round_kills. Do not show it to the user."),
          players: z
            .array(matchPlayerSelectorSchema)
            .max(10)
            .default([])
            .describe("Additional players/agents to draw from the selected event snapshot."),
          include_killer: z.boolean().default(true),
          include_victim: z.boolean().default(true),
          region: regionSchema,
          platform: platformSchema,
          focus_player: focusPlayerSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_round_image"),
        generated_at: z.string(),
        filename: z.string(),
        round_number: z.number().int(),
        event_id: z.string(),
        rendered_samples: z.number().int(),
        navigation: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({
      match_id,
      round_number,
      score,
      score_timing,
      event_id,
      players,
      include_killer,
      include_victim,
      region,
      platform,
      focus_player,
    }) =>
      withToolErrors(async () => {
        const snapshot = await runtime.getTacticalSnapshot({
          matchId: match_id,
          roundNumber: round_number,
          score,
          scoreTiming: score_timing as ScoreTiming,
          eventId: event_id,
          players,
          includeKiller: include_killer,
          includeVictim: include_victim,
          region: region as ValorantRegion,
          platform: platform as ValorantPlatform,
          focusPlayer: focus_player,
        });
        const replay = snapshot.replay;
        const rendered = await renderTacticalSnapshotImage(snapshot);
        const navigation = navigationForReplay(replay, { match_id, region, platform, focus_player });
        const output = {
          kind: "valorant_round_image" as const,
          generated_at: now(),
          match_id,
          round_number: rendered.roundNumber,
          event_id: rendered.eventId,
          filename: rendered.filename,
          map: rendered.map,
          rendered_samples: rendered.renderedSamples,
          event_index: rendered.eventIndex,
          event_count: rendered.eventCount,
          summary: rendered.summary,
          replay,
          markers: rendered.markers,
          available_players: snapshot.availablePlayers,
          warnings: snapshot.warnings,
          navigation,
          limitations: rendered.limitations,
          cache: snapshot.cache,
        };
        return {
          content: [
            { type: "text" as const, text: `${formatRender(output)}${cacheWarningText(output)}` },
            { type: "image" as const, data: rendered.buffer.toString("base64"), mimeType: "image/png" },
          ],
          structuredContent: output,
        };
      }),
  );

  server.registerTool(
    "valorant_search_lineups",
    {
      title: "Search Valorant lineups",
      description: `Search community lineups on Strats.gg for one agent, optionally limited to one map and side, and filtered by ability, difficulty tier, or a position phrase such as "b main".

The agent is required so searches stay bounded; omit the map to search every map for that agent. The side is the team you execute from, default attacker. Each result reports the standing position as map percentages, the ability, difficulty label (Essential/Useful/Niche mapping to easy/medium/hard), community views, a YouTube video, and screenshot and map image URLs.

Examples:
- "Give me a Sova lineup on Ascent from B Main while attacking" -> agent="Sova", map="Ascent", side="attacker", query="b main"
- "Viper molly lineups on Bind" -> agent="Viper", map="Bind", ability="snake bite"
- "Easy Yoru lineups for Pearl" -> agent="Yoru", map="Pearl", level="easy"

Lineups are community-submitted; titles and standing positions are the position signal, so prefer an explicit position phrase like "b main" over map jargon. Verify any lineup in a custom game before using it in ranked. Read-only, no API key required.`,
      inputSchema: z
        .object({
          agent: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .describe(
              "Agent to find lineups for, for example Sova, Viper, or Yoru. Required to keep searches bounded.",
            ),
          map: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .optional()
            .describe("Map to search, for example Ascent. Omit to search every map for the agent."),
          side: z
            .enum(["attacker", "defender"])
            .default("attacker")
            .describe("Team side the lineup is executed from, default attacker."),
          ability: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .optional()
            .describe("Ability filter, for example shock, recon, or snake bite."),
          level: z
            .enum(["easy", "medium", "hard", "essential", "useful", "niche"])
            .optional()
            .describe("Difficulty tier filter; essential/useful/niche are the displayed labels for easy/medium/hard."),
          query: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .optional()
            .describe(
              "Free-text position keywords matched against the lineup title, for example b main or default plant.",
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(10)
            .describe("Maximum number of lineups to return, sorted by community views."),
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_lineup_search"),
        generated_at: z.string(),
        agent: z.string(),
        map: z.string(),
        side: z.string(),
        matches: z.array(z.looseObject({ id: z.string(), title: z.string() })),
      }),
      annotations: toolAnnotations,
    },
    async ({ agent, map, side, ability, level, query, limit, response_format }) =>
      withToolErrors(async () => {
        const search = await lineupsRuntime.searchLineups({
          agent,
          map,
          side: side as LineupSide,
          ability,
          level,
          query,
          limit,
        });
        const output = {
          kind: "valorant_lineup_search" as const,
          generated_at: now(),
          agent: search.matches[0]?.agent ?? agent,
          map: map?.trim() || "all maps",
          side,
          maps_searched: search.maps_searched,
          matches: search.matches,
        };
        return result(output, formatLineupSearch(output), response_format);
      }),
  );

  server.registerTool(
    "valorant_get_lineup",
    {
      title: "Get one Valorant lineup",
      description: `Return the full detail for one community lineup by its id from valorant_search_lineups: standing position, trajectory points, ability, difficulty, views, video, screenshots, and posting date.

Use this when the search result was not detailed enough or when the agent wants to inspect the exact trajectory before executing the lineup.`,
      inputSchema: z
        .object({
          lineup_id: z.string().trim().min(1).max(160).describe("Lineup id returned by valorant_search_lineups."),
          response_format: responseFormatSchema,
        })
        .strict(),
      outputSchema: z.looseObject({
        kind: z.literal("valorant_lineup"),
        generated_at: z.string(),
        lineup: z.unknown(),
      }),
      annotations: toolAnnotations,
    },
    async ({ lineup_id, response_format }) =>
      withToolErrors(async () => {
        const lineup = await lineupsRuntime.getLineup(lineup_id);
        const output = { kind: "valorant_lineup" as const, generated_at: now(), lineup };
        return result(output, formatLineup(output), response_format);
      }),
  );

  return server;
}

type JsonObject = Record<string, unknown>;

function result<T extends JsonObject>(output: T, markdown: string, format: "markdown" | "json") {
  const text = format === "json" ? JSON.stringify(output, null, 2) : `${markdown}${cacheWarningText(output)}`;
  return {
    content: [
      {
        type: "text" as const,
        text:
          text.length <= 60_000
            ? text
            : `${text.slice(0, 59_000)}\n\n[Output truncated. Request a narrower match or round view.]`,
      },
    ],
    structuredContent: output,
  };
}

function cacheWarningText(output: JsonObject): string {
  const direct = output.cache as JsonObject | undefined;
  const nested = (output.review as JsonObject | undefined)?.cache as JsonObject | undefined;
  const warning = direct?.warning ?? nested?.warning;
  return typeof warning === "string" && warning.trim() ? `\n\n*Local cache warning: ${warning.trim()}*` : "";
}

async function withToolErrors<T>(
  operation: () => Promise<T>,
): Promise<T | { content: Array<{ type: "text"; text: string }>; isError: true }> {
  try {
    return await operation();
  } catch (error) {
    return {
      content: [{ type: "text", text: actionableError(error) }],
      isError: true,
    };
  }
}

function formatPlayer(output: JsonObject): string {
  const identity = output.identity as JsonObject;
  const rank = output.rank as JsonObject | null;
  return [
    `## ${identity.riotId}`,
    `- PUUID: ${identity.puuid}`,
    `- Region/platform: ${String(identity.region).toUpperCase()} / ${String(identity.platform).toUpperCase()}`,
    `- Account level: ${identity.accountLevel ?? "unavailable"}`,
    `- Current rank: ${rank?.tierName ?? "unavailable"}${rank?.rr !== null && rank?.rr !== undefined ? ` · ${rank.rr} RR` : ""}`,
    `- Peak rank: ${rank?.peakTierName ?? "unavailable"}`,
  ].join("\n");
}

function formatMatches(output: JsonObject): string {
  const player = output.player as JsonObject;
  const input = output.input as JsonObject;
  const matches = output.matches as JsonObject[];
  const lines = [`## Recent matches for ${player.riotId}`, ""];
  if (input.source === "tracker-profile") {
    lines.push(
      `Tracker hints applied: platform=${input.appliedPlatform}${input.appliedPlaylist ? `, playlist=${input.appliedPlaylist}` : ""}.`,
    );
    if (input.ignoredSeason)
      lines.push(
        `Tracker season=${input.ignoredSeason} was not applied; these are Henrik's latest matches for the selected queue.`,
      );
    lines.push("");
  }
  for (const match of matches) {
    lines.push(`${match.index}. **${String(match.result).toUpperCase()} · ${match.mapName ?? "Unknown map"}**`);
    lines.push(
      `   ${match.roundsWon ?? "-"}-${match.roundsLost ?? "-"} · ${match.agentName ?? "Unknown agent"} · ${match.kills ?? "-"}/${match.deaths ?? "-"}/${match.assists ?? "-"} · ACS ${number(match.acs)}`,
    );
    lines.push(`   match_id: ${match.matchId}`);
  }
  return lines.join("\n");
}

function formatMatch(output: JsonObject): string {
  const projection = output.match as JsonObject;
  const match = projection.match as JsonObject;
  const teams = projection.teams as JsonObject[];
  const lines = [
    `## ${match.map ?? "Unknown map"} · ${match.mode}`,
    `${teams.map((team) => `${team.label} ${team.score ?? "-"}`).join(" vs ")} · ${match.endState ? (match.endState as JsonObject).label : "Unknown result"}`,
    "",
  ];
  for (const team of teams) {
    lines.push(`### ${team.label}`);
    for (const player of team.players as JsonObject[]) {
      const combat = player.combat as JsonObject;
      lines.push(
        `- ${player.riotId} · ${player.agent ?? "agent n/a"} · ${combat.kills ?? "-"}/${combat.deaths ?? "-"}/${combat.assists ?? "-"} · ACS ${number(combat.acs)} · ADR ${number(combat.adr)}`,
      );
    }
  }
  return lines.join("\n");
}

function formatAnalysis(output: JsonObject): string {
  const matchProjection = output.match as JsonObject;
  const match = matchProjection.match as JsonObject;
  const analysis = output.analysis as JsonObject | null;
  const turningPoints = (analysis?.turningPoints ?? []) as JsonObject[];
  const lines = [`## Match analysis · ${match.map ?? "Unknown map"}`, ""];
  if (turningPoints.length) {
    lines.push("### Strongest turning points");
    turningPoints
      .slice(0, 8)
      .forEach((point) => lines.push(`- Round ${point.roundNumber}: **${point.title}** · ${point.detail}`));
  } else lines.push("No turning points could be supported by the available round evidence.");
  const recommendation = analysis?.recommendation as JsonObject | null;
  if (recommendation) {
    lines.push("", `### ${recommendation.title}`, String(recommendation.inference));
    for (const fact of (recommendation.observedFacts ?? []) as string[]) lines.push(`- ${fact}`);
  }
  const limitations = output.limitations as string[];
  if (limitations.length) lines.push("", "### Evidence limits", ...limitations.map((item) => `- ${item}`));
  return lines.join("\n");
}

function formatMatchTimeline(output: JsonObject): string {
  const focus = output.focus as JsonObject | null;
  const summary = output.summary as JsonObject;
  const rounds = output.rounds as JsonObject[];
  const lines = [
    `## Objective match timeline · ${output.map ?? "Unknown map"}`,
    `${focus?.riotId ?? "No focus player"} · ${summary.rounds} rounds · ${summary.wins} won / ${summary.losses} lost · ${summary.focusKills}K / ${summary.focusDeaths}D`,
    `Opening deaths: ${summary.openingDeaths} · Untraded deaths: ${summary.untradedDeaths}`,
  ];
  for (const round of rounds) {
    const opening = round.opening as JsonObject | null;
    const objective = round.objective as JsonObject | null;
    const winner = round.winner as JsonObject;
    const observed = round.observedFacts as string[];
    const inferences = round.supportedInferences as string[];
    let event = "no recorded opening kill";
    if (opening?.target) {
      const actor = opening.actor as JsonObject;
      const target = opening.target as JsonObject;
      event = `${actor.agentName ?? actor.gameName} killed ${target.agentName ?? target.gameName} at ${time(opening.timeInRoundMs)}`;
    }
    lines.push(
      "",
      `### R${round.roundNumber} · ${round.scoreBefore} → ${round.scoreAfter} · ${String(round.outcome).toUpperCase()}${round.side ? ` (${round.side})` : ""}`,
      `- Winner: ${winner.teamId ?? "unknown"}${winner.result ? ` by ${winner.result}` : ""}`,
      `- Focus: ${round.focusKills}K / ${round.focusDeaths}D`,
      `- Opening: ${event}`,
    );
    if (objective)
      lines.push(
        `- Objective: ${objective.kind}${objective.site ? ` at ${objective.site}` : ""} at ${time(objective.timeInRoundMs)}`,
      );
    observed.slice(0, 2).forEach((fact) => lines.push(`- Observed: ${fact}`));
    inferences.slice(0, 2).forEach((inference) => lines.push(`- Supported read: ${inference}`));
  }
  lines.push(
    "",
    "*Facts and supported reads are separated. Position evidence is kill-event snapshots, not continuous POV, movement, comms, intent, or line of sight.*",
  );
  return lines.join("\n");
}

function formatRound(output: JsonObject): string {
  if (output.intelligence && typeof output.intelligence === "object") {
    return formatRoundExplanation({ intelligence: output.intelligence, matched_by: "round" });
  }
  const round = output.round as JsonObject;
  const lines = [`## Round ${round.roundNumber} · ${round.winningTeam ?? "Unknown winner"}`, ""];
  for (const fact of output.explanationFacts as string[]) lines.push(`- ${fact}`);
  const events = round.events as JsonObject[];
  lines.push("", "### Event log");
  for (const event of events) {
    const actor = event.actor as JsonObject;
    const target = event.target as JsonObject | null;
    lines.push(
      `- ${time(event.timeInRoundMs)} · ${actor.gameName} ${event.kind}${target ? ` → ${target.gameName}` : ""}${event.weaponName ? ` · ${event.weaponName}` : ""}`,
    );
  }
  const spatial = output.spatial as JsonObject;
  lines.push(
    "",
    `${(spatial.samples as unknown[]).length} valid position samples are available for tactical rendering.`,
  );
  return lines.join("\n");
}

function formatRoundKillList(output: JsonObject): string {
  const score = output.score as JsonObject;
  const kills = output.kills as JsonObject[];
  const lines = [
    `## Round ${output.round_number} kills · ${score.focusBeforeLabel ?? score.beforeLabel} → ${score.focusAfterLabel ?? score.afterLabel}`,
    kills.length
      ? "Tell me **Show Kill 2** or name the duel, such as **Show Raze killing Phoenix**."
      : "No recorded kills were found in this round.",
  ];
  for (const kill of kills) {
    const killer = kill.killer as JsonObject;
    const victim = kill.victim as JsonObject;
    const killerCallout = kill.killerCallout as JsonObject | null;
    const victimCallout = kill.victimCallout as JsonObject | null;
    const route =
      killerCallout?.name || victimCallout?.name
        ? ` · ${killerCallout?.name ?? "unknown"} → ${victimCallout?.name ?? "unknown"}`
        : "";
    const trade = kill.traded ? ` · traded in ${(Number(kill.tradeDelayMs) / 1_000).toFixed(1)}s` : " · untraded (5s)";
    lines.push(
      `- **Kill ${kill.number}** · ${time(kill.timeInRoundMs)} · **${killer.agentName ?? killer.gameName}** killed **${victim.agentName ?? victim.gameName}** · ${kill.weaponName ?? "unknown weapon"}${kill.distanceMeters !== null ? ` · ${Math.round(Number(kill.distanceMeters))}m` : ""}${route}${trade}`,
    );
  }
  return lines.join("\n");
}

function formatRoundExplanation(output: JsonObject): string {
  const intelligence = output.intelligence as JsonObject;
  const score = intelligence.score as JsonObject;
  const winner = intelligence.winner as JsonObject;
  const focus = intelligence.focus as JsonObject | null;
  const lines = [
    `## Round ${intelligence.roundNumber} · ${score.focusBeforeLabel ?? score.beforeLabel} → ${score.focusAfterLabel ?? score.afterLabel}`,
    `**${winner.teamId ?? "Unknown team"} won${winner.side ? ` on ${winner.side}` : ""}${winner.result ? ` by ${winner.result}` : ""}.**`,
  ];
  if (focus) {
    const player = focus.player as JsonObject;
    lines.push(`${player.agentName ?? player.gameName}: ${focus.kills}K / ${focus.deaths}D · ${focus.outcome}`);
  }
  const facts = intelligence.observedFacts as string[];
  if (facts.length) lines.push("", "### Observed", ...facts.slice(0, 6).map((fact) => `- ${fact}`));
  const inferences = intelligence.supportedInferences as string[];
  if (inferences.length) lines.push("", "### Supported read", ...inferences.slice(0, 5).map((item) => `- ${item}`));
  const moments = intelligence.keyMoments as JsonObject[];
  if (moments.length) {
    lines.push("", "### Key moments");
    for (const event of moments.slice(0, 6)) {
      const actor = event.actor as JsonObject;
      const target = event.target as JsonObject | null;
      const actorCallout = event.actorCallout as JsonObject | null;
      const targetCallout = event.targetCallout as JsonObject | null;
      lines.push(
        `- ${time(event.timeInRoundMs)} · ${actor.gameName}${actorCallout?.name ? ` (${actorCallout.name})` : ""} ${event.kind}${target ? ` → ${target.gameName}${targetCallout?.name ? ` (${targetCallout.name})` : ""}` : ""}${event.weaponName ? ` · ${event.weaponName}` : ""}${(event.tags as string[]).includes("traded") ? " · traded" : ""}`,
      );
    }
  }
  const abilities = intelligence.abilityContext as JsonObject[];
  if (abilities.length) {
    lines.push("", "### Recorded utility counts");
    for (const row of abilities.slice(0, 6)) {
      const player = row.player as JsonObject;
      const context = row.context as JsonObject;
      const casts = context.casts as JsonObject[];
      lines.push(
        `- ${player.agentName ?? player.gameName}: ${casts.map((cast) => `${cast.ability} ×${cast.count}`).join(", ")}`,
      );
    }
    lines.push(
      "- Cast timing and effect are not present in Henrik, so utility is not assigned as a kill/access cause.",
    );
  }
  const limitations = intelligence.limitations as string[];
  if (limitations.length) lines.push("", `*Evidence limit: ${limitations[0]}*`);
  return lines.join("\n");
}

function formatDeathReview(output: JsonObject): string {
  const review = output.review as JsonObject;
  const player = review.player as JsonObject;
  const selected = review.selected as JsonObject | null;
  if (!selected) return `No recorded deaths matched the requested filters for ${player.agentName ?? player.riotId}.`;
  const killer = selected.killer as JsonObject;
  const victim = selected.victim as JsonObject;
  const trade = selected.trade as JsonObject | null;
  const killerCallout = selected.killerCallout as JsonObject | null;
  const victimCallout = selected.victimCallout as JsonObject | null;
  const attention = selected.attention as JsonObject | null;
  const lines = [
    `## ${victim.agentName ?? victim.gameName} death ${review.selectedIndex}/${review.totalDeaths} · Round ${selected.roundNumber}`,
    `**${selected.scoreBefore} → ${selected.scoreAfter} · ${String(selected.phase).replace(/-/g, " ")}**`,
    "",
    `**${killer.agentName ?? killer.gameName}** killed **${victim.agentName ?? victim.gameName}** with **${selected.weaponName ?? "an unknown weapon"}** at ${time(selected.timeInRoundMs)}${selected.distanceMeters !== null ? ` from ${Math.round(Number(selected.distanceMeters))}m` : ""}.`,
    `Position: ${killerCallout?.name ? `${killer.agentName ?? killer.gameName} near ${killerCallout.name}` : "killer callout unavailable"}; ${victimCallout?.name ? `${victim.agentName ?? victim.gameName} near ${victimCallout.name}` : "victim callout unavailable"}.`,
    `Trade: ${trade ? `${(trade.by as JsonObject).riotId} answered after ${(Number(trade.delayMs) / 1_000).toFixed(1)}s` : "not traded within 5.0s"}.`,
    `Impact: ${(selected.impact as string[]).join("; ")}.`,
  ];
  if (attention) {
    lines.push(`Geometric attention: ${attention.geometricSummary}`);
    const victimToKiller = attention.victimToKiller as JsonObject | null;
    if (victimToKiller?.angleDeltaDegrees !== null && victimToKiller?.angleDeltaDegrees !== undefined)
      lines.push(
        `${victim.agentName ?? victim.gameName} was ${Math.round(Number(victimToKiller.angleDeltaDegrees))}° off the killer bearing (${victimToKiller.alignment}).`,
      );
  }
  lines.push(
    `Round result: their team ${selected.focusTeamOutcome === "win" ? "still won" : selected.focusTeamOutcome === "loss" ? "lost" : "has an unknown outcome"}.`,
  );
  const navigation = output.navigation as JsonObject;
  const choices = navigation.buttonChoices as string[];
  if (choices?.length) lines.push("", `Controls: ${choices.join(" · ")}`);
  lines.push(
    "",
    "*Direction triangles show recorded facing. The 103° attention analysis is geometric potential, not proof of visibility through walls, smokes, flashes, or elevation.*",
  );
  return lines.join("\n");
}

function formatPositionReview(output: JsonObject): string {
  const death = output.death as JsonObject;
  const killer = death.killer as JsonObject;
  const victim = death.victim as JsonObject;
  const teammates = output.teammates as JsonObject[];
  const lines = [
    `## Position review · Round ${death.roundNumber} · ${death.scoreBefore} → ${death.scoreAfter}`,
    `**${killer.agentName ?? killer.gameName}** killed **${victim.agentName ?? victim.gameName}** with **${death.weaponName ?? "an unknown weapon"}** at ${time(death.timeInRoundMs)}.`,
    "",
    "### Recorded living teammates",
  ];
  if (!teammates.length)
    lines.push("- No living victim-team teammate had a usable position and facing snapshot at this event.");
  for (const teammate of teammates) {
    const player = teammate.player as JsonObject;
    const callout = teammate.callout as JsonObject | null;
    lines.push(
      `- **${player.agentName ?? player.gameName}**${callout?.name ? ` near ${callout.name}` : ""}` +
        ` · ${number(teammate.distanceToVictimMeters)}m from victim` +
        ` · ${number(teammate.distanceToKillerMeters)}m from killer` +
        ` · ${teammate.killerAlignment}${teammate.killerAngleDeltaDegrees !== null ? ` (${Math.round(Number(teammate.killerAngleDeltaDegrees))}°)` : ""}`,
    );
  }
  const observed = output.observedFacts as string[];
  const inferences = output.supportedInferences as string[];
  if (observed.length) lines.push("", "### Observed", ...observed.map((fact) => `- ${fact}`));
  if (inferences.length) lines.push("", "### Supported read", ...inferences.map((fact) => `- ${fact}`));
  const limitations = output.limitations as string[];
  if (limitations.length) lines.push("", `*Evidence limit: ${limitations.at(-1)}*`);
  return lines.join("\n");
}

function formatGameKnowledge(output: JsonObject): string {
  const lines = ["## Valorant knowledge"];
  const agent = output.agent as JsonObject | null;
  if (agent) {
    lines.push("", `### ${agent.name} · ${agent.role ?? "role unavailable"}`, String(agent.description ?? ""));
    for (const ability of agent.abilities as JsonObject[])
      lines.push(`- **${ability.name}** (${ability.slot}): ${ability.description ?? "Description unavailable"}`);
  }
  const map = output.map as JsonObject | null;
  if (map) {
    const callouts = map.callouts as JsonObject[];
    lines.push(
      "",
      `### ${map.name} callouts`,
      callouts.map((callout) => `${callout.superRegion} ${callout.region}`).join(" · "),
    );
    lines.push("Callouts are nearest anchors, not polygons or wall geometry.");
  }
  const weapon = output.weapon as JsonObject | null;
  if (weapon)
    lines.push(
      "",
      `### ${weapon.name}`,
      `${weapon.category ?? "category unavailable"} · ${weapon.magazineSize ?? "?"} rounds · ${weapon.wallPenetration ?? "?"} penetration`,
    );
  const term = output.term as JsonObject | null;
  if (term) lines.push("", `### ${term.name}`, String(term.definition ?? "No normalized definition is available."));
  return lines.join("\n");
}

function formatRawMatch(output: JsonObject): string {
  const serialized = JSON.stringify(output.data, null, 2);
  const clipped =
    serialized.length > 58_000
      ? `${serialized.slice(0, 58_000)}\n... [raw section truncated; request a narrower section]`
      : serialized;
  return `## Raw Henrik ${output.section} · ${output.match_id}\n\n\u0060\u0060\u0060json\n${clipped}\n\u0060\u0060\u0060`;
}

function formatLineupSearch(output: JsonObject): string {
  const matches = output.matches as JsonObject[];
  const lines = [`## ${output.agent} lineups · ${output.map} (${output.side})`, ""];
  if (!matches.length) {
    lines.push(
      "No community lineups matched the filters. Try removing the ability, level, or position query, or search the other side.",
    );
    return lines.join("\n");
  }
  lines.push(`${matches.length} match${matches.length === 1 ? "" : "es"} sorted by community views.`);
  matches.forEach((match, index) => {
    const point = match.standing_point as JsonObject | null;
    const position = point ? ` · stand ${Number(point.left).toFixed(1)}% / ${Number(point.top).toFixed(1)}%` : "";
    lines.push(
      `\n${index + 1}. **${match.title}**${match.level_label ? ` · ${match.level_label}` : ""} · ${match.ability ?? "unknown ability"} · ${count(match.views)} views · ${match.map} (${match.side})${position}`,
      `   ${match.video_url ?? "No video attached"}${match.image_url ? ` · screenshot: ${match.image_url}` : ""}`,
    );
  });
  lines.push(
    "",
    "*Community lineups from Strats.gg; standing positions are map percentages. Verify in a custom game before using one in ranked.*",
  );
  return lines.join("\n");
}

function formatLineup(output: JsonObject): string {
  const lineup = output.lineup as JsonObject;
  const point = lineup.standing_point as JsonObject | null;
  const trajectory = lineup.trajectory as JsonObject[];
  const lines = [
    `## ${lineup.title}`,
    `${lineup.agent} · ${lineup.map} (${lineup.side})${lineup.level_label ? ` · ${lineup.level_label}` : ""} · ${count(lineup.views)} views`,
    `Ability: ${lineup.ability ?? "unknown"}`,
  ];
  if (point)
    lines.push(
      `Standing position: ${Number(point.left).toFixed(1)}% / ${Number(point.top).toFixed(1)}% of the map (${lineup.side} view).`,
    );
  if (trajectory.length)
    lines.push(
      `Trajectory: ${trajectory.map((p) => `${Number(p.left).toFixed(1)}%/${Number(p.top).toFixed(1)}%`).join(" → ")}`,
    );
  if (lineup.description) lines.push("", String(lineup.description));
  lines.push("", `Video: ${lineup.video_url ?? "none"}`);
  if (lineup.image_url) lines.push(`Screenshot: ${lineup.image_url}`);
  if (lineup.map_image_url) lines.push(`Map image: ${lineup.map_image_url}`);
  if (lineup.posted_at) lines.push(`Posted: ${String(lineup.posted_at).slice(0, 10)}`);
  lines.push("", "*Community lineup from Strats.gg; verify in a custom game before using it in ranked.*");
  return lines.join("\n");
}

function formatRender(output: JsonObject): string {
  const replay = output.replay as JsonObject;
  const killer = replay.killer as JsonObject;
  const victim = replay.victim as JsonObject;
  const attention = replay.attention as JsonObject | null;
  const lines = [
    `## Round ${output.round_number} · Event ${output.event_index}/${output.event_count}`,
    `**${killer.agentName ?? killer.gameName}** killed **${victim.agentName ?? victim.gameName}** with **${replay.weaponName ?? "an unknown weapon"}** at ${time(replay.timeInRoundMs)}${replay.distanceMeters !== null ? ` from ${Math.round(Number(replay.distanceMeters))}m` : ""}.`,
    String(output.summary),
  ];
  const markers = output.markers as JsonObject[];
  if (markers.length) {
    lines.push("", "Markers:");
    for (const marker of markers) {
      const player = marker.player as JsonObject;
      const callout = marker.callout as JsonObject | null;
      lines.push(
        `- ${player.agentName ?? player.gameName}: ${marker.role}${marker.relation !== "neutral" ? ` / ${marker.relation}` : ""}${callout?.name ? ` · near ${callout.name}` : ""}`,
      );
    }
  }
  if (attention) lines.push(`Geometric attention: ${attention.geometricSummary}`);
  const navigation = output.navigation as JsonObject;
  const choices = navigation.buttonChoices as string[];
  if (choices?.length) lines.push("", `Controls: ${choices.join(" · ")}`);
  lines.push(
    "",
    "*The image contains only the square map and selected markers. Solid triangles beneath the portraits point along recorded facing; visibility through walls, smokes, flashes, nearsight, or elevation is not proven.*",
  );
  return lines.join("\n");
}

function navigationForReplay(
  replay: DuelReplay,
  base: { match_id: string; region: string; platform: string; focus_player?: string },
) {
  const actions: Array<{ label: string; tool: string; arguments: JsonObject }> = [];
  if (replay.previousEventId)
    actions.push({
      label: `◀ ${replay.previousEventLabel ?? "Previous kill"}`,
      tool: "valorant_render_round",
      arguments: { ...base, round_number: replay.roundNumber, event_id: replay.previousEventId },
    });
  if (replay.nextEventId)
    actions.push({
      label: `${replay.nextEventLabel ?? "Next kill"} ▶`,
      tool: "valorant_render_round",
      arguments: { ...base, round_number: replay.roundNumber, event_id: replay.nextEventId },
    });
  actions.push({
    label: "Explain this round",
    tool: "valorant_explain_round",
    arguments: { ...base, round_number: replay.roundNumber },
  });
  return { buttonChoices: actions.map((action) => action.label), actions };
}

function number(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "-";
}
function count(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "-";
}
function time(value: unknown): string {
  return typeof value === "number"
    ? `${Math.floor(value / 60_000)}:${String(Math.floor((value % 60_000) / 1_000)).padStart(2, "0")}`
    : "--:--";
}
function now(): string {
  return new Date().toISOString();
}

if (import.meta.main && !handleCliArgs()) {
  try {
    const runtime = ValorantRuntime.fromEnv();
    const lineupsRuntime = new LineupsRuntime();
    const port = httpPort();
    const http =
      port === null
        ? null
        : startHttpServer(
            () => createValorantMcpServer(runtime, lineupsRuntime),
            port,
            process.env.VALORANT_MCP_TOKEN?.trim() ?? "",
          );
    const handle = http
      ? null
      : serveStdio(() => createValorantMcpServer(runtime, lineupsRuntime), {
          onerror: () => console.error("MCP transport error. Check the client connection and retry."),
        });
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      try {
        await handle?.close();
        await http?.stop(true);
      } finally {
        runtime.close();
      }
    };
    if (!http)
      process.stdin.once("end", () => {
        void shutdown();
      });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void shutdown().finally(() => process.exit(0));
      });
    }
    console.error(
      `${serverInfo.name} ${serverInfo.version} running ${http ? `at http://127.0.0.1:${http.port}/mcp (Bearer authentication required)` : "via stdio"}`,
    );
  } catch (error) {
    console.error(actionableError(error));
    process.exitCode = 1;
  }
}
