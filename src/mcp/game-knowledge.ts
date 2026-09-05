import { assetRoot } from "./paths";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MatchRoundPlayerStat } from "../domain/types";

export type AgentKnowledge = {
  uuid: string;
  name: string;
  description: string | null;
  role: string | null;
  roleDescription: string | null;
  abilities: Array<{ slot: string; name: string; description: string | null }>;
};

export type MapCallout = { region: string; superRegion: string; x: number; y: number };
export type MapKnowledge = { uuid: string; name: string; coordinates: string | null; callouts: MapCallout[] };
export type WeaponKnowledge = {
  uuid: string;
  name: string;
  category: string | null;
  fireRate: number | null;
  magazineSize: number | null;
  wallPenetration: string | null;
  damageRanges: Array<{ startMeters: number; endMeters: number; head: number; body: number; legs: number }>;
};

export type NearestCallout = {
  name: string;
  region: string;
  superRegion: string;
  distanceMeters: number;
  confidence: "high" | "medium" | "low";
  method: "nearest-callout-anchor";
};

export type AbilityCastContext = {
  agent: string;
  role: string | null;
  casts: Array<{ slot: string; ability: string; count: number; description: string | null }>;
  limitation: string;
};

type KnowledgeFile = {
  version: number;
  generatedAt: string;
  agents: AgentKnowledge[];
  maps: MapKnowledge[];
  weapons: WeaponKnowledge[];
};

export const valorantTerminology: Record<string, string> = {
  "opening duel":
    "The first kill/death interaction of a round. It creates the first recorded man advantage but does not alone prove site access or the round cause.",
  trade:
    "A teammate eliminates the killer shortly after a death. This tool uses a five-second evidence window and reports the exact follow-up event and delay.",
  crossfire:
    "Two teammates hold overlapping geometric coverage on the same threat from different positions. Recorded facing cones can show potential crossfire alignment, but walls, smoke, flash state, and actual visibility remain unknown.",
  entry:
    "An attacker contests defended space to create access. A kill near a site route followed by a plant can support an access inference, but the feed cannot prove the utility or call that enabled it.",
  "site access":
    "The attackers established enough control to enter and, when recorded, plant. The strongest evidence is a site-region kill or displacement followed by a plant at that site.",
  "man advantage":
    "One team has more recorded living players than the other after an event. Revives or incomplete event data can make the reconstructed count uncertain.",
  "post-plant":
    "The phase after the spike is planted. Attackers usually defend the spike while defenders retake; the feed records kills and objectives but not every utility interaction.",
  retake:
    "The defenders attempt to regain a planted site. Defender kills after the plant and a defuse are direct retake evidence.",
  clutch:
    "A last surviving player wins against one or more opponents. Derived only when the kill ledger and winning team support the alive-state reconstruction.",
  lurk: "A player operates away from the main group to pressure rotations or timing. Sparse event snapshots cannot reliably label a lurk without continuous movement context.",
  "default plant":
    "A common spike placement for a site. Henrik may report the site but not the exact named plant spot, so the tool does not assume a default plant from site alone.",
  "line of sight":
    "A geometric ray between observer and target. Facing alignment is not proof of visibility because map collision, elevation, smoke, flashes, and nearsight are absent.",
};

const knowledgePath = join(assetRoot, "knowledge.json");
let knowledgeCache: KnowledgeFile | null = null;

export function gameKnowledge(): KnowledgeFile {
  knowledgeCache ??= JSON.parse(readFileSync(knowledgePath, "utf8")) as KnowledgeFile;
  return knowledgeCache;
}

export function findAgentKnowledge(name: string | null): AgentKnowledge | null {
  if (!name) return null;
  const knowledge = gameKnowledge();
  return knowledge.agents.find((agent) => same(agent.name, name)) ?? null;
}

export function findMapKnowledge(name: string | null): MapKnowledge | null {
  if (!name) return null;
  const knowledge = gameKnowledge();
  return knowledge.maps.find((map) => same(map.name, name)) ?? null;
}

export function findWeaponKnowledge(name: string | null): WeaponKnowledge | null {
  if (!name) return null;
  const knowledge = gameKnowledge();
  return knowledge.weapons.find((weapon) => same(weapon.name, name)) ?? null;
}

export function nearestMapCallout(
  mapName: string | null,
  position: { x: number; y: number } | null,
): NearestCallout | null {
  if (!position) return null;
  const map = findMapKnowledge(mapName);
  if (!map?.callouts.length) return null;
  const nearest = [...map.callouts]
    .map((callout) => ({ callout, distanceMeters: Math.hypot(position.x - callout.x, position.y - callout.y) / 100 }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)[0];
  if (!nearest) return null;
  return {
    name: calloutName(nearest.callout),
    region: nearest.callout.region,
    superRegion: nearest.callout.superRegion,
    distanceMeters: nearest.distanceMeters,
    confidence: nearest.distanceMeters <= 8 ? "high" : nearest.distanceMeters <= 16 ? "medium" : "low",
    method: "nearest-callout-anchor",
  };
}

export function abilityCastContext(
  agentName: string | null,
  casts: MatchRoundPlayerStat["abilityCasts"],
): AbilityCastContext | null {
  const agent = findAgentKnowledge(agentName);
  if (!agent) return null;
  const counts: Record<string, number | null> = {
    grenade: casts.grenade,
    ability1: casts.ability1,
    ability2: casts.ability2,
    ultimate: casts.ultimate,
  };
  const abilities = new Map(agent.abilities.map((ability) => [normalizeSlot(ability.slot), ability]));
  return {
    agent: agent.name,
    role: agent.role,
    casts: Object.entries(counts).flatMap(([slot, count]) => {
      if (count === null || count <= 0) return [];
      const ability = abilities.get(slot);
      return [{ slot, ability: ability?.name ?? slot, count, description: ability?.description ?? null }];
    }),
    limitation:
      "Henrik reports per-round cast counts but not cast timestamps, targets, hit results, or whether a cast caused a kill or site entry.",
  };
}

function calloutName(callout: MapCallout): string {
  const superRegion = callout.superRegion.trim();
  const region = callout.region.trim();
  if (!superRegion) return region;
  if (same(superRegion, region)) return region;
  if (/side$/i.test(superRegion) && same(region, "Spawn")) return superRegion.replace(/ side$/i, " Spawn");
  return `${superRegion} ${region}`;
}

function normalizeSlot(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function same(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
