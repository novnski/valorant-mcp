import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { join } from "node:path";

const [player, region = "eu", requestedMatchId, requestedRound = "1"] = process.argv.slice(2);
if (!player) {
  console.error("Usage: bun run scripts/live-smoke.ts <RiotID-or-PUUID> [region] [match-id] [round]");
  process.exit(2);
}
if (!process.env.HENRIK_API_KEY?.trim()) {
  console.error("HENRIK_API_KEY is required");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(import.meta.dir, "..", "dist", "mcp", "server.js")],
  env: process.env as Record<string, string>,
  stderr: "pipe",
});
const client = new Client({ name: "valorant-live-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = new Set(listed.tools.map((tool) => tool.name));
  const requiredTools = [
    "valorant_list_matches",
    "valorant_get_match",
    "valorant_analyze_match",
    "valorant_get_match_timeline",
    "valorant_get_round",
    "valorant_list_round_kills",
    "valorant_review_position",
    "valorant_render_round",
  ];
  const missingTools = requiredTools.filter((name) => !toolNames.has(name));
  if (missingTools.length) throw new Error(`Missing required tools: ${missingTools.join(", ")}`);

  const recent = await client.callTool({
    name: "valorant_list_matches",
    arguments: { player, region, platform: "pc", limit: 1, response_format: "json" },
  });
  if (recent.isError) throw new Error(textOf(recent.content));
  const recentData = object(recent.structuredContent);
  const rows = Array.isArray(recentData.matches) ? recentData.matches.map(object) : [];
  const matchId = requestedMatchId || String(rows[0]?.matchId ?? "");
  if (!matchId) throw new Error("No match ID available for smoke test");

  const match = await client.callTool({
    name: "valorant_get_match",
    arguments: { match_id: matchId, region, platform: "pc", focus_player: player, response_format: "json" },
  });
  if (match.isError) throw new Error(textOf(match.content));

  const analysis = await client.callTool({
    name: "valorant_analyze_match",
    arguments: { match_id: matchId, region, platform: "pc", focus_player: player, response_format: "json" },
  });
  if (analysis.isError) throw new Error(textOf(analysis.content));

  const timeline = await client.callTool({
    name: "valorant_get_match_timeline",
    arguments: { match_id: matchId, region, platform: "pc", focus_player: player, response_format: "json" },
  });
  if (timeline.isError) throw new Error(textOf(timeline.content));
  const repeatedTimeline = await client.callTool({
    name: "valorant_get_match_timeline",
    arguments: { match_id: matchId, region, platform: "pc", focus_player: player, response_format: "json" },
  });
  if (repeatedTimeline.isError) throw new Error(textOf(repeatedTimeline.content));
  const repeatCache = object(object(repeatedTimeline.structuredContent).cache);
  if (repeatCache.source !== "local-projection") {
    throw new Error(`Repeated timeline did not use a local projection (source=${String(repeatCache.source)})`);
  }

  const position = await client.callTool({
    name: "valorant_review_position",
    arguments: { match_id: matchId, player, death_index: 1, region, platform: "pc", response_format: "json" },
  });
  if (position.isError) throw new Error(textOf(position.content));
  const positionImage = position.content.find((block) => block.type === "image");
  if (!positionImage || positionImage.type !== "image") throw new Error("Position review returned no image block");

  const roundNumber = Number(requestedRound);
  const round = await client.callTool({
    name: "valorant_get_round",
    arguments: {
      match_id: matchId,
      round_number: roundNumber,
      region,
      platform: "pc",
      focus_player: player,
      response_format: "json",
    },
  });
  if (round.isError) throw new Error(textOf(round.content));

  const killList = await client.callTool({
    name: "valorant_list_round_kills",
    arguments: { match_id: matchId, round_number: roundNumber, region, platform: "pc", focus_player: player },
  });
  if (killList.isError) throw new Error(textOf(killList.content));

  const image = await client.callTool({
    name: "valorant_render_round",
    arguments: { match_id: matchId, round_number: roundNumber, region, platform: "pc", focus_player: player },
  });
  if (image.isError) throw new Error(textOf(image.content));
  const imageBlock = image.content.find((block) => block.type === "image");
  if (!imageBlock || imageBlock.type !== "image") throw new Error("Tactical render returned no image block");
  const imageBytes = Buffer.from(imageBlock.data, "base64");
  if (!imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("Tactical render is not a PNG");

  const matchData = object(match.structuredContent);
  const matchProjection = object(matchData.match);
  const matchInfo = object(matchProjection.match);
  const analysisData = object(analysis.structuredContent);
  const analysisBody = object(analysisData.analysis);
  const roundData = object(round.structuredContent);
  const roundBody = object(roundData.round);
  const events = Array.isArray(roundBody.events) ? roundBody.events.map(object) : [];
  const turningPoints = Array.isArray(analysisBody.turningPoints) ? analysisBody.turningPoints.map(object) : [];
  const killListData = object(killList.structuredContent);
  const timelineData = object(timeline.structuredContent);
  const timelineSummary = object(timelineData.summary);
  const positionData = object(position.structuredContent);
  const visibleKillText = textOf(killList.content);
  if (/r\d+-kill-\d+/i.test(visibleKillText)) throw new Error("Visible kill list leaked an internal event ID");
  console.log(
    JSON.stringify(
      {
        tools: [...toolNames].sort(),
        recent_matches: rows.map((row) => ({
          index: row.index,
          match_id: row.matchId,
          map: row.mapName,
          result: row.result,
        })),
        selected_match: {
          match_id: matchId,
          map: matchInfo.map,
          mode: matchInfo.mode,
          end_state: object(matchInfo.endState).label,
        },
        analysis: { turning_points: turningPoints.length, top_turning_point: turningPoints[0] ?? null },
        timeline: {
          rounds: timelineSummary.rounds,
          wins: timelineSummary.wins,
          losses: timelineSummary.losses,
          repeat_cache_source: repeatCache.source,
        },
        round: {
          number: roundBody.roundNumber,
          winner: roundBody.winningTeam,
          result: roundBody.result,
          events: events.length,
          first_event: events[0] ?? null,
          last_event: events.at(-1) ?? null,
          focus_outcome: roundData.focusOutcome,
        },
        kill_list: {
          count: Array.isArray(killListData.kills) ? killListData.kills.length : 0,
          visible_text: visibleKillText,
        },
        position_review: {
          teammates: Array.isArray(positionData.teammates) ? positionData.teammates.length : 0,
          image_bytes: Buffer.from(positionImage.data, "base64").byteLength,
        },
        tactical_png_bytes: imageBytes.byteLength,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
}
