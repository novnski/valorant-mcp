import { SharedReads, requestSignal } from "./request-context";
import { TransientCache } from "./transient-cache";
import { ValorantInputError } from "./errors";
// Lineup search runtime over the Strats.gg open lineups API.
// Stateless apart from short-lived in-memory map/character catalogs.

import {
  StratsClient,
  StratsApiError,
  type StratsCharacter,
  type StratsGroup,
  type StratsLineup,
  type StratsMap,
} from "./strats-client";

export type LineupSide = "attacker" | "defender";

export type LineupLevelFilter = "easy" | "medium" | "hard" | "essential" | "useful" | "niche";

export type LineupSearchInput = {
  agent: string;
  map?: string;
  side?: LineupSide;
  ability?: string;
  level?: LineupLevelFilter;
  query?: string;
  limit: number;
  mapBudget?: number;
  sort?: "views" | "recent" | "relevance";
};

export type NormalizedLineup = {
  source: "strats.gg";
  patch_validation: "unknown";
  id: string;
  agent: string;
  map: string;
  map_id: string;
  side: LineupSide;
  title: string;
  description: string | null;
  level: string | null;
  level_label: string | null;
  ability: string | null;
  ability_id: string | null;
  views: number;
  standing_point: { left: number; top: number } | null;
  trajectory: { left: number; top: number }[];
  video_url: string | null;
  image_url: string | null;
  map_image_url: string | null;
  posted_at: string | null;
};

const LEVEL_LABELS: Record<string, string> = { easy: "Essential", medium: "Useful", hard: "Niche" };
const LEVEL_ALIASES: Record<string, string> = {
  essential: "easy",
  useful: "medium",
  niche: "hard",
};

export class LineupsRuntime {
  private readonly reads = new SharedReads();
  private readonly mapsCache = new TransientCache<StratsMap[]>(2, 1024 * 1024);
  private readonly charactersCache = new TransientCache<StratsCharacter[]>(2, 1024 * 1024);
  private readonly groupsCache = new TransientCache<StratsGroup[]>(32, 12 * 1024 * 1024);
  private readonly detailsCache = new TransientCache<NormalizedLineup>(64, 4 * 1024 * 1024);

  constructor(private readonly client: StratsClient = new StratsClient()) {}

  async searchLineups(input: LineupSearchInput) {
    const agentName = input.agent.trim();
    if (!agentName) throw new ValorantInputError("Provide an agent such as Sova to search lineups.");
    const character = await this.resolveCharacter(agentName);
    const side = input.side ?? "attacker";

    const requestedMaps = input.map?.trim() ? [await this.resolveMap(input.map.trim())] : await this.allMaps();
    const mapBudget = input.map ? 1 : Math.min(10, Math.max(1, input.mapBudget ?? 4));
    const maps = requestedMaps.slice(0, mapBudget);
    const coverage = {
      mapBudget,
      mapsAvailable: requestedMaps.length,
      succeeded: [] as string[],
      failed: [] as Array<{ map: string; code: string }>,
      skipped: requestedMaps.slice(mapBudget).map((m) => m.name),
      noSource: [] as string[],
    };
    const mapsSearched = new Set<string>();

    const collected: Array<{ group: StratsGroup; lineup: StratsLineup; map: StratsMap }> = [];
    for (const map of maps) {
      const source = map.map_sources?.find((candidate) => candidate.overview === side) ?? null;
      requestSignal()?.throwIfAborted();
      if (!source) {
        coverage.noSource.push(map.name);
        continue;
      }
      const key = JSON.stringify([source.id, character.id]);
      let groups: StratsGroup[];
      try {
        groups = await this.reads.run(`groups:${key}`, async () => {
          const cached = this.groupsCache.get(key);
          if (cached) return cached;
          const fresh = await this.client.listGroupedLineups(source.id, character.id);
          this.groupsCache.set(key, fresh, 5 * 60_000);
          return fresh;
        });
      } catch (error) {
        requestSignal()?.throwIfAborted();
        if (error instanceof StratsApiError && error.code === "cancelled") throw error;
        coverage.failed.push({ map: map.name, code: error instanceof StratsApiError ? error.code : "unavailable" });
        continue;
      }
      mapsSearched.add(map.id);
      coverage.succeeded.push(map.name);
      for (const group of groups ?? []) {
        for (const lineup of group.lineups ?? []) {
          if (lineup.status !== "approved") continue;
          collected.push({ group, lineup, map });
        }
      }
    }

    const normalized = collected
      .map(({ group, lineup, map }) => this.normalize(lineup, character.name, map, side, group.point))
      .filter((lineup) => this.matchesFilters(lineup, input));

    const relevance = (lineup: NormalizedLineup) =>
      (
        input.query
          ?.toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean) ?? []
      ).reduce(
        (sum, word) =>
          sum +
          (lineup.title.toLowerCase().includes(word) ? 2 : 0) +
          (lineup.description?.toLowerCase().includes(word) ? 1 : 0),
        0,
      );
    const posted = (lineup: NormalizedLineup) => Date.parse(lineup.posted_at ?? "") || 0;
    const sorted = [...normalized].sort(
      (a, b) =>
        (input.sort === "recent"
          ? posted(b) - posted(a)
          : input.sort === "relevance"
            ? relevance(b) - relevance(a)
            : 0) ||
        b.views - a.views ||
        a.id.localeCompare(b.id),
    );
    return {
      maps_searched: [...mapsSearched],
      matches: sorted.slice(0, input.limit),
      coverage,
      sort: input.sort ?? "views",
      patch_validation: "unknown" as const,
      limitations: [
        "Community lineups have not been tested in-game or validated against the current patch. Views and age do not establish validity.",
      ],
    };
  }

  async getLineup(lineupId: string): Promise<NormalizedLineup> {
    return this.reads.run(`lineup:${lineupId}`, async () => {
      const cached = this.detailsCache.get(lineupId);
      if (cached) return cached;
      const raw = await this.client.getLineup(lineupId);
      const side = raw.map_source?.overview === "defender" ? "defender" : "attacker";
      const result = this.normalize(
        raw,
        raw.character?.name ?? "Unknown agent",
        { id: raw.map_id ?? "unknown", name: raw.map_name ?? raw.map_id ?? "Unknown map" },
        side,
        null,
      );
      this.detailsCache.set(lineupId, result, 5 * 60_000);
      return result;
    });
  }

  private async allMaps(): Promise<StratsMap[]> {
    return this.reads.run("maps", async () => {
      const cached = this.mapsCache.get("all");
      if (cached) return cached;
      const fresh = await this.client.listMaps();
      this.mapsCache.set("all", fresh, 10 * 60_000);
      return fresh;
    });
  }

  private async allCharacters(): Promise<StratsCharacter[]> {
    return this.reads.run("characters", async () => {
      const cached = this.charactersCache.get("all");
      if (cached) return cached;
      const fresh = await this.client.listCharacters();
      this.charactersCache.set("all", fresh, 10 * 60_000);
      return fresh;
    });
  }

  private async resolveCharacter(name: string): Promise<StratsCharacter> {
    const characters = await this.allCharacters();
    const target = norm(name);
    const match = characters.find((character) => norm(character.name) === target || norm(character.id) === target);
    if (!match) {
      const known = characters
        .slice(0, 24)
        .map((character) => character.name)
        .join(", ");
      throw new ValorantInputError(
        `Unknown Valorant agent "${name}". Known agents: ${known}${characters.length > 24 ? ", ..." : ""}`,
      );
    }
    return match;
  }

  private async resolveMap(name: string): Promise<StratsMap> {
    const maps = await this.allMaps();
    const target = norm(name);
    const match = maps.find((map) => norm(map.name) === target || norm(map.id) === target);
    if (!match) {
      const known = maps
        .slice(0, 20)
        .map((map) => map.name)
        .join(", ");
      throw new ValorantInputError(`Unknown Valorant map "${name}". Known maps: ${known}`);
    }
    return match;
  }

  private normalize(
    lineup: StratsLineup,
    agentName: string,
    map: Pick<StratsMap, "id" | "name">,
    side: LineupSide,
    groupPoint: { left: number; top: number } | null,
  ): NormalizedLineup {
    const rawLevel = lineup.level?.trim().toLocaleLowerCase() ?? null;
    return {
      source: "strats.gg",
      patch_validation: "unknown",
      id: lineup.id,
      agent: agentName,
      map: map.name,
      map_id: map.id,
      side,
      title: lineup.title?.trim() || `Untitled lineup ${lineup.id}`,
      description: lineup.description?.trim() || null,
      level: rawLevel,
      level_label: rawLevel ? (LEVEL_LABELS[rawLevel] ?? null) : null,
      ability: lineup.utility?.name ?? null,
      ability_id: lineup.utility?.id ?? null,
      views: Number.isFinite(lineup.views) ? lineup.views : 0,
      standing_point:
        groupPoint ?? (lineup.left !== null && lineup.top !== null ? { left: lineup.left, top: lineup.top } : null),
      trajectory: (lineup.points ?? []).filter((point) => Number.isFinite(point.left) && Number.isFinite(point.top)),
      video_url: lineup.video_url ?? null,
      image_url: lineup.image_url ?? null,
      map_image_url: lineup.map_source?.source_url ?? null,
      posted_at: lineup.posted_at ?? null,
    };
  }

  private matchesFilters(lineup: NormalizedLineup, input: LineupSearchInput): boolean {
    if (input.ability?.trim()) {
      const target = norm(input.ability);
      const abilityText = norm(`${lineup.ability ?? ""} ${lineup.ability_id ?? ""}`);
      if (!abilityText.includes(target)) return false;
    }
    if (input.level) {
      const requested = LEVEL_ALIASES[input.level] ?? input.level;
      if (norm(lineup.level ?? "") !== requested) return false;
    }
    if (input.query?.trim()) {
      const haystack = norm(`${lineup.title} ${lineup.description ?? ""}`);
      const tokens = input.query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  }
}

function norm(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}
