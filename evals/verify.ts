import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createValorantMcpServer } from "../src/mcp/server";
import { evaluationRuntime } from "./runtime";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createValorantMcpServer(evaluationRuntime());
const client = new Client({ name: "evaluation-verifier", version: "1.0.0" });
await server.connect(serverTransport);
await client.connect(clientTransport);
const base = { match_id: "cache-match-1", region: "eu", platform: "pc" };
const focus = { ...base, focus_player: "focus-puuid" };
const player = { ...base, player: "focus-puuid" };
type Query = { name: string; arguments: Record<string, unknown>; path: string; seconds?: boolean; length?: boolean };
const queries = {
  match: { name: "valorant_get_match", arguments: focus },
  round: { name: "valorant_explain_round", arguments: { ...focus, score: "0-0" } },
  timeline: { name: "valorant_get_match_timeline", arguments: focus },
  death: { name: "valorant_review_deaths", arguments: player },
  position: { name: "valorant_review_position", arguments: player },
  kills: { name: "valorant_list_round_kills", arguments: { ...focus, round_number: 1 } },
};
const cases: Query[][] = [
  [
    { ...queries.match, path: "match.match.map" },
    { ...queries.round, path: "intelligence.map" },
  ],
  [
    { ...queries.timeline, path: "rounds.0.scoreAfter" },
    { ...queries.round, path: "intelligence.score.focusAfterLabel" },
  ],
  [
    { ...queries.death, path: "review.selected.focusTeamOutcome" },
    { ...queries.round, path: "intelligence.focus.outcome" },
  ],
  [
    { ...queries.death, path: "review.selected.killer.agentName" },
    { name: "valorant_get_raw_match", arguments: { ...base, section: "players" }, path: "data.1.agent.name" },
  ],
  [
    { ...queries.death, path: "review.selected.weaponName" },
    { ...queries.kills, path: "kills.0.weaponName" },
  ],
  [
    { ...queries.death, path: "review.selected.timeInRoundMs", seconds: true },
    { ...queries.kills, path: "kills.0.timeInRoundMs", seconds: true },
  ],
  [
    { ...queries.death, path: "review.selected.victimCallout.name" },
    { ...queries.position, path: "death.victimCallout.name" },
  ],
  [
    { ...queries.death, path: "review.selected.attention.assumedHorizontalFovDegrees" },
    { ...queries.position, path: "replay.attention.assumedHorizontalFovDegrees" },
  ],
  [
    { ...queries.death, path: "review.selected.attention.recordedVictimTeammates" },
    { ...queries.position, path: "teammates", length: true },
  ],
  [
    {
      name: "valorant_get_raw_match",
      arguments: { ...base, section: "kills" },
      path: "data.0.player_locations",
      length: true,
    },
    { name: "valorant_render_round", arguments: { ...focus, round_number: 1 }, path: "rendered_samples" },
  ],
];

try {
  const xml = await readFile(new URL("./evaluation.xml", import.meta.url), "utf8");
  const answers = [...xml.matchAll(/<answer>(.*?)<\/answer>/g)].map((match) => match[1]);
  assert.equal(answers.length, 10);
  for (const [index, pair] of cases.entries()) {
    for (const query of pair) {
      const response = await client.callTool({ name: query.name, arguments: query.arguments });
      assert(!response.isError, `${query.name}: ${JSON.stringify(response.content)}`);
      let value: unknown = response.structuredContent;
      for (const key of query.path.split(".")) value = (value as Record<string, unknown>)?.[key];
      if (query.length) {
        assert(Array.isArray(value));
        value = value.length;
      }
      if (query.seconds) {
        assert.equal(typeof value, "number");
        value = Number(value) / 1000;
      }
      assert.equal(String(value), answers[index], `Question ${index + 1}: ${query.name}.${query.path}`);
    }
  }
  console.log("Verified all 10 evaluation answers across 20 MCP tool calls.");
} finally {
  await client.close();
  await server.close();
}
