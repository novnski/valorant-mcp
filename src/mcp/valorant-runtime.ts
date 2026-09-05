import { ValorantInputError } from "./errors";
import { HenrikClient, type HenrikAccount } from "./henrik-client";
import {
  buildUserMatchFeatureProjectionV1,
  type UserMatchFeature,
  type UserMatchFeatureProjectionV1,
} from "../domain/match-feature-contracts";
import {
  buildUserMatchProjectionV1,
  buildUserRoundEvidenceProjectionV1,
  type UserMatchProjectionV1,
  type UserRoundEvidenceProjectionV1,
} from "../domain/match-product-contracts";
import {
  buildUserMatchScoreboardProjectionV1,
  buildUserSpatialEvidenceProjectionV1,
  type UserMatchScoreboardProjectionV1,
  type UserSpatialEvidenceProjectionV1,
} from "../domain/match-scoreboard-spatial-contracts";
import type { MatchDetail, MatchSummary, RankSnapshot } from "../domain/types";
import {
  MatchCacheError,
  emptyCacheProvenance,
  matchFocusProjectionVersion,
  matchTimelineProjectionVersion,
  type MatchCache,
  type MatchCacheProvenance,
} from "../cache/match-cache";
import { baseMatchProjection } from "../cache/match-cache-projector";
import { SqliteMatchCache } from "../cache/sqlite-match-cache";
import { normalizeMatchDetail } from "../services/match-detail-normalizer";
import { MatchDuelService } from "../services/match-duel-service";
import { MatchEconomyService } from "../services/match-economy-service";
import { normalizeMatches } from "../services/match-normalizer";
import { MatchPerformanceService } from "../services/match-performance-service";
import { MatchRoundEvidenceService } from "../services/match-round-evidence-service";
import { RoundAnalysisService } from "../services/round-analysis-service";
import {
  buildDuelReplay,
  buildMatchTimeline,
  buildPositionReview,
  buildRoundKillList,
  buildRoundIntelligence,
  buildTacticalSnapshot,
  resolveMatchPlayer,
  resolveRoundNumber,
  reviewPlayerDeaths,
  type DeathReview,
  type DuelReplay,
  type MatchTimeline,
  type PositionReview,
  type RoundIntelligence,
  type RoundKillList,
  type ScoreTiming,
  type TacticalSnapshot,
} from "./round-intelligence";
import { parseTrackerMatchInput, parseTrackerProfileInput } from "./tracker-link";

export type ValorantRegion = "na" | "eu" | "latam" | "br" | "ap" | "kr";
export type ValorantPlatform = "pc" | "console";

export type PlayerIdentity = {
  puuid: string;
  riotId: string;
  gameName: string;
  tagLine: string;
  region: string;
  platform: string;
  accountLevel: number | null;
  cardId: string | null;
  titleId: string | null;
};

export type PlayerProfile = {
  identity: PlayerIdentity;
  rank: RankSnapshot | null;
};

export type RecentMatchResult = {
  player: PlayerIdentity;
  input: {
    source: "direct" | "tracker-profile";
    appliedPlatform: ValorantPlatform;
    appliedPlaylist: string | null;
    ignoredSeason: string | null;
  };
  matches: Array<MatchSummary & { index: number }>;
  requested: number;
  returned: number;
  hasMore: boolean;
};

export type MatchAnalysisResult = {
  match: UserMatchProjectionV1;
  scoreboard: UserMatchScoreboardProjectionV1;
  analysis: NonNullable<MatchDetail["analysis"]> | null;
  features: Record<UserMatchFeature, UserMatchFeatureProjectionV1>;
  spatialCoverage: UserSpatialEvidenceProjectionV1["coverage"];
  limitations: string[];
  cache: MatchCacheProvenance;
};

export type RoundResult = {
  match: Pick<UserMatchProjectionV1, "version" | "match" | "focus" | "warnings">;
  round: NonNullable<UserRoundEvidenceProjectionV1>["rounds"][number];
  spatial: UserSpatialEvidenceProjectionV1;
  turningPoints: NonNullable<MatchDetail["analysis"]>["turningPoints"];
  focusOutcome: "win" | "loss" | "unknown";
  explanationFacts: string[];
  limitations: string[];
  intelligence: RoundIntelligence;
  cache: MatchCacheProvenance;
};

export type RoundLookupResult = {
  matchedBy: "round" | "score-before" | "score-after";
  intelligence: RoundIntelligence;
  cache: MatchCacheProvenance;
};

type HenrikReader = Pick<
  HenrikClient,
  "getAccountByPuuid" | "getAccountByRiotId" | "getMatch" | "getMatchesByPuuid" | "getMmrByPuuid"
>;

type CacheEntry<T> = { expiresAt: number; value: T };
type BaseMatchLoad = {
  detail: MatchDetail;
  raw: unknown;
  payloadHash: string | null;
  cache: MatchCacheProvenance;
};
type FullMatchLoad = { detail: MatchDetail; cache: MatchCacheProvenance };

const features: readonly UserMatchFeature[] = ["performance", "economy", "damage", "objectives", "abilities", "duels"];

const accountTtlMs = 5 * 60_000;
const matchListTtlMs = 60_000;
const matchTtlMs = 5 * 60_000;

export class ValorantRuntime {
  private readonly accounts = new Map<string, CacheEntry<HenrikAccount>>();
  private readonly matchLists = new Map<string, CacheEntry<unknown[]>>();
  private readonly listedRawMatches = new Map<string, CacheEntry<unknown>>();
  private readonly matchBases = new Map<string, CacheEntry<BaseMatchLoad>>();
  private readonly matches = new Map<string, CacheEntry<FullMatchLoad>>();
  private readonly pendingMatchBases = new Map<string, Promise<BaseMatchLoad>>();
  private readonly roundAnalysis = new RoundAnalysisService();
  private readonly matchPerformance = new MatchPerformanceService();
  private readonly matchEconomy = new MatchEconomyService();
  private readonly matchDuels = new MatchDuelService();
  private readonly roundEvidence = new MatchRoundEvidenceService();

  constructor(
    private readonly henrik: HenrikReader,
    private readonly matchCache: MatchCache | null = null,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ValorantRuntime {
    return new ValorantRuntime(HenrikClient.fromEnv(env), SqliteMatchCache.fromEnv(env));
  }

  close(): void {
    this.matchCache?.close();
  }

  async getPlayer(player: string, region: ValorantRegion, platform: ValorantPlatform): Promise<PlayerProfile> {
    const context = await this.resolvePlayerContext(player, region, platform);
    const rawMmr = await this.henrik.getMmrByPuuid(context.region, context.platform, context.account.puuid);
    return {
      identity: playerIdentity(context.account, context.region, context.platform),
      rank: normalizeRank(rawMmr),
    };
  }

  async listMatches(input: {
    player: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    limit: number;
    mode?: string;
  }): Promise<RecentMatchResult> {
    const context = await this.resolvePlayerContext(input.player, input.region, input.platform);
    const mode = input.mode ?? context.playlist ?? undefined;
    const key = [context.account.puuid, context.region, context.platform, mode ?? "all", input.limit].join(":");
    let rawMatches = readCache(this.matchLists, key);
    if (!rawMatches) {
      rawMatches = await this.henrik.getMatchesByPuuid(
        context.region,
        context.platform,
        context.account.puuid,
        input.limit,
        mode,
      );
      writeCache(this.matchLists, key, rawMatches, matchListTtlMs);
    }
    const normalizedMatches = normalizeMatches(rawMatches, context.account.puuid);
    for (const [matchId, raw] of normalizedMatches.rawByMatchId) {
      writeCache(this.listedRawMatches, rawMatchKey(context.region, context.platform, matchId), raw, matchListTtlMs);
    }
    const normalized = normalizedMatches.summaries.sort(
      (left, right) => timestamp(right.startedAt) - timestamp(left.startedAt),
    );
    return {
      player: playerIdentity(context.account, context.region, context.platform),
      input: {
        source: context.source,
        appliedPlatform: context.platform,
        appliedPlaylist: mode ?? null,
        ignoredSeason: context.season,
      },
      matches: normalized.slice(0, input.limit).map((match, index) => ({ ...match, index: index + 1 })),
      requested: input.limit,
      returned: Math.min(normalized.length, input.limit),
      hasMore: normalized.length >= input.limit,
    };
  }

  async getMatch(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
  }): Promise<{ detail: MatchDetail; focusPuuid: string | null; cache: MatchCacheProvenance }> {
    const matchId = parseTrackerMatchInput(input.matchId).matchId;
    const base = await this.loadBaseMatch(matchId, input.region, input.platform);
    const focusPuuid = await this.resolveFocusPuuid(base.detail, input.focusPlayer, input.region, input.platform);
    const cacheKey = `${input.region}:${input.platform}:${matchId}:${focusPuuid ?? "none"}`;
    const cached = readCache(this.matches, cacheKey);
    if (cached) return { ...cached, focusPuuid };

    if (this.matchCache && base.payloadHash) {
      try {
        const saved = this.matchCache.readFocusProjection(matchId, input.platform, focusPuuid, base.payloadHash);
        if (saved) {
          const result = {
            detail: saved.detail,
            cache: {
              source: "local-projection" as const,
              matchSaved: true,
              savedAt: base.cache.savedAt ?? saved.savedAt,
              payloadHash: saved.payloadHash,
              projectionVersion: matchFocusProjectionVersion,
              warning: base.cache.warning,
            },
          };
          writeCache(this.matches, cacheKey, result, matchTtlMs);
          return { ...result, focusPuuid };
        }
      } catch (error) {
        if (!(error instanceof MatchCacheError)) throw error;
        base.cache = {
          ...base.cache,
          warning: "Could not read the local focus projection; check cache permissions and disk space.",
        };
      }
    }

    const detail = this.materializeMatch(base.detail, focusPuuid);
    let provenance = base.cache;
    if (this.matchCache && base.payloadHash) {
      try {
        this.matchCache.saveFocusProjection(matchId, input.platform, focusPuuid, base.payloadHash, detail);
      } catch (error) {
        const warning = "Could not save the local focus projection; check cache permissions and disk space.";
        provenance = { ...provenance, warning };
      }
    }
    const result = { detail, cache: provenance };
    writeCache(this.matches, cacheKey, result, matchTtlMs);
    return { ...result, focusPuuid };
  }

  async getRawMatch(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    section: "metadata" | "players" | "teams" | "rounds" | "kills" | "all";
  }): Promise<{ matchId: string; section: string; data: unknown; source: "henrik-raw"; cache: MatchCacheProvenance }> {
    const matchId = parseTrackerMatchInput(input.matchId).matchId;
    const loaded = await this.loadBaseMatch(matchId, input.region, input.platform);
    const raw = loaded.raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new ValorantInputError(`Henrik returned no raw match object for ${matchId}`);
    const row = raw as Record<string, unknown>;
    return {
      matchId,
      section: input.section,
      data: input.section === "all" ? raw : (row[input.section] ?? null),
      source: "henrik-raw",
      cache: loaded.cache,
    };
  }

  async getMatchProjection(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
  }): Promise<{
    match: UserMatchProjectionV1;
    scoreboard: UserMatchScoreboardProjectionV1;
    cache: MatchCacheProvenance;
  }> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    return {
      match: buildUserMatchProjectionV1(detail, focusPuuid),
      scoreboard: buildUserMatchScoreboardProjectionV1(detail, focusPuuid),
      cache,
    };
  }

  async analyzeMatch(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
  }): Promise<MatchAnalysisResult> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    const featureRows = Object.fromEntries(
      features.map((feature) => [feature, buildUserMatchFeatureProjectionV1(detail, feature, focusPuuid)]),
    ) as Record<UserMatchFeature, UserMatchFeatureProjectionV1>;
    const spatial = buildUserSpatialEvidenceProjectionV1(detail);
    return {
      match: buildUserMatchProjectionV1(detail, focusPuuid),
      scoreboard: buildUserMatchScoreboardProjectionV1(detail, focusPuuid),
      analysis: detail.analysis ?? null,
      features: featureRows,
      spatialCoverage: spatial.coverage,
      limitations: unique([...detail.warnings, ...spatial.limitations, ...(detail.analysis?.warnings ?? [])]),
      cache,
    };
  }

  async getMatchTimeline(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
  }): Promise<MatchTimeline & { cache: MatchCacheProvenance }> {
    const { detail, focusPuuid, cache: loadedCache } = await this.getMatch(input);
    let cache = loadedCache;
    if (this.matchCache && cache.payloadHash) {
      try {
        const saved = this.matchCache.readDerivedProjection<MatchTimeline>(
          detail.matchId,
          detail.platform,
          focusPuuid,
          "match-timeline",
          matchTimelineProjectionVersion,
          cache.payloadHash,
        );
        if (saved) return { ...saved, cache: { ...cache, source: "local-projection" } };
      } catch (error) {
        cache = {
          ...cache,
          warning: "Could not read the cached match timeline; check cache permissions and disk space.",
        };
      }
    }
    const timeline = buildMatchTimeline(detail, focusPuuid);
    if (this.matchCache && cache.payloadHash) {
      try {
        this.matchCache.saveDerivedProjection(
          detail.matchId,
          detail.platform,
          focusPuuid,
          "match-timeline",
          matchTimelineProjectionVersion,
          cache.payloadHash,
          timeline,
        );
      } catch (error) {
        cache = {
          ...cache,
          warning: "Could not save the cached match timeline; check cache permissions and disk space.",
        };
      }
    }
    return { ...timeline, cache };
  }

  async getRound(input: {
    matchId: string;
    roundNumber: number;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
  }): Promise<RoundResult> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    const projection = buildUserMatchProjectionV1(detail, focusPuuid);
    const roundEvidence = buildUserRoundEvidenceProjectionV1(detail);
    const round = roundEvidence?.rounds.find((candidate) => candidate.roundNumber === input.roundNumber);
    if (!round) {
      const available = roundEvidence?.rounds.map((candidate) => candidate.roundNumber).join(", ") || "none";
      throw new ValorantInputError(`Round ${input.roundNumber} is unavailable. Available rounds: ${available}`);
    }
    const spatial = buildUserSpatialEvidenceProjectionV1(detail);
    const focusTeam = focusPuuid ? teamForPlayer(detail, focusPuuid) : null;
    const focusOutcome =
      !focusTeam || !round.winningTeam ? "unknown" : sameTeam(focusTeam, round.winningTeam) ? "win" : "loss";
    const turningPoints = (detail.analysis?.turningPoints ?? []).filter(
      (point) => point.roundNumber === input.roundNumber,
    );
    const intelligence = buildRoundIntelligence(detail, input.roundNumber, focusPuuid);
    return {
      match: {
        version: projection.version,
        match: projection.match,
        focus: projection.focus,
        warnings: projection.warnings,
      },
      round,
      spatial: {
        ...spatial,
        samples: spatial.samples.filter((sample) => sample.roundNumber === input.roundNumber),
      },
      turningPoints,
      focusOutcome,
      explanationFacts: roundFacts(round, focusPuuid, focusTeam, focusOutcome, turningPoints),
      limitations: unique([...(roundEvidence?.limitations ?? []), ...spatial.limitations]),
      intelligence,
      cache,
    };
  }

  async explainRound(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
    roundNumber?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
  }): Promise<RoundLookupResult> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    const resolved = resolveRoundNumber(detail, {
      roundNumber: input.roundNumber,
      score: input.score,
      scoreTiming: input.scoreTiming,
      focusPuuid,
    });
    return {
      matchedBy: resolved.matchedBy,
      intelligence: buildRoundIntelligence(detail, resolved.roundNumber, focusPuuid),
      cache,
    };
  }

  async listRoundKills(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
    roundNumber?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
  }): Promise<RoundKillList & { cache: MatchCacheProvenance }> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    const resolved = resolveRoundNumber(detail, {
      roundNumber: input.roundNumber,
      score: input.score,
      scoreTiming: input.scoreTiming,
      focusPuuid,
    });
    return { ...buildRoundKillList(detail, resolved.roundNumber, focusPuuid), cache };
  }

  async reviewDeaths(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
    player?: string;
    roundFrom?: number;
    roundTo?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
    deathIndex?: number;
  }): Promise<DeathReview & { cache: MatchCacheProvenance }> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    const player = input.player ? parseTrackerProfileInput(input.player).player : focusPuuid;
    if (!player) throw new ValorantInputError("Provide player or focus_player to review deaths");
    return {
      ...reviewPlayerDeaths(detail, {
        player,
        roundFrom: input.roundFrom,
        roundTo: input.roundTo,
        score: input.score,
        scoreTiming: input.scoreTiming,
        deathIndex: input.deathIndex,
      }),
      cache,
    };
  }

  async reviewPosition(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    player: string;
    roundFrom?: number;
    roundTo?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
    deathIndex?: number;
  }): Promise<PositionReview & { cache: MatchCacheProvenance }> {
    const { detail, cache } = await this.getMatch({ ...input, focusPlayer: input.player });
    return {
      ...buildPositionReview(detail, {
        player: parseTrackerProfileInput(input.player).player,
        roundFrom: input.roundFrom,
        roundTo: input.roundTo,
        score: input.score,
        scoreTiming: input.scoreTiming,
        deathIndex: input.deathIndex,
      }),
      cache,
    };
  }

  async getDuelReplay(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
    roundNumber?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
    eventId?: string;
  }): Promise<DuelReplay & { cache: MatchCacheProvenance }> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    const resolved = resolveRoundNumber(detail, {
      roundNumber: input.roundNumber,
      score: input.score,
      scoreTiming: input.scoreTiming,
      focusPuuid,
    });
    return {
      ...buildDuelReplay(detail, {
        roundNumber: resolved.roundNumber,
        eventId: input.eventId,
        focusPuuid,
      }),
      cache,
    };
  }

  async getTacticalSnapshot(input: {
    matchId: string;
    region: ValorantRegion;
    platform: ValorantPlatform;
    focusPlayer?: string;
    roundNumber?: number;
    score?: string;
    scoreTiming?: ScoreTiming;
    eventId?: string;
    players?: string[];
    includeKiller?: boolean;
    includeVictim?: boolean;
  }): Promise<TacticalSnapshot & { cache: MatchCacheProvenance }> {
    const { detail, focusPuuid, cache } = await this.getMatch(input);
    const resolved = resolveRoundNumber(detail, {
      roundNumber: input.roundNumber,
      score: input.score,
      scoreTiming: input.scoreTiming,
      focusPuuid,
    });
    return {
      ...buildTacticalSnapshot(detail, {
        roundNumber: resolved.roundNumber,
        eventId: input.eventId,
        focusPuuid,
        players: input.players?.map((player) => parseTrackerProfileInput(player).player),
        includeKiller: input.includeKiller,
        includeVictim: input.includeVictim,
      }),
      cache,
    };
  }

  private async loadBaseMatch(
    matchId: string,
    region: ValorantRegion,
    platform: ValorantPlatform,
  ): Promise<BaseMatchLoad> {
    const key = rawMatchKey(region, platform, matchId);
    const inMemory = readCache(this.matchBases, key);
    if (inMemory) return inMemory;
    const pending = this.pendingMatchBases.get(key);
    if (pending) return await pending;
    const load = this.loadBaseMatchUncached(matchId, region, platform)
      .then((result) => {
        writeCache(this.matchBases, key, result, matchTtlMs);
        return result;
      })
      .finally(() => this.pendingMatchBases.delete(key));
    this.pendingMatchBases.set(key, load);
    return await load;
  }

  private async loadBaseMatchUncached(
    matchId: string,
    region: ValorantRegion,
    platform: ValorantPlatform,
  ): Promise<BaseMatchLoad> {
    let cacheWarning: string | null = null;
    if (this.matchCache) {
      try {
        const saved = this.matchCache.readMatch(matchId, platform);
        if (saved) {
          if (saved.baseProjection) {
            return {
              detail: { ...saved.baseProjection, source: "cache" },
              raw: saved.raw,
              payloadHash: saved.payloadHash,
              cache: {
                source: "local-projection",
                matchSaved: true,
                savedAt: saved.savedAt,
                payloadHash: saved.payloadHash,
                projectionVersion: matchFocusProjectionVersion,
                warning: null,
              },
            };
          }
          const reprojected = this.normalizeBase(saved.raw, region, platform, matchId);
          const persisted = this.persistBase(
            reprojected,
            saved.raw,
            "local-reprojected",
            saved.sourceEndpoint,
            cacheWarning,
          );
          return { ...persisted, raw: saved.raw };
        }
      } catch (error) {
        cacheWarning = "Could not read the local match cache; check cache permissions and disk space.";
      }
    }

    const recentRaw = readCache(this.listedRawMatches, rawMatchKey(region, platform, matchId));
    if (recentRaw !== null) {
      const recent = this.normalizeBase(recentRaw, region, platform, matchId);
      if (isDetailCompleteEnough(recent)) {
        return this.persistBase(recent, recentRaw, "recent-list", "recent-list-v4", cacheWarning);
      }
    }

    const raw = await this.henrik.getMatch(region, platform, matchId);
    const detail = this.normalizeBase(raw, region, platform, matchId);
    return this.persistBase(detail, raw, "henrik-detail", "match-detail-v4", cacheWarning);
  }

  private normalizeBase(
    raw: unknown,
    region: ValorantRegion,
    platform: ValorantPlatform,
    matchId: string,
  ): MatchDetail {
    const normalized = normalizeMatchDetail(raw, { region, platform, source: "live" });
    if (!normalized || normalized.matchId !== matchId) {
      throw new ValorantInputError(`Henrik returned no usable match detail for ${matchId}`);
    }
    return baseMatchProjection(normalized);
  }

  private persistBase(
    detail: MatchDetail,
    raw: unknown,
    source: "local-reprojected" | "recent-list" | "henrik-detail",
    sourceEndpoint: "recent-list-v4" | "match-detail-v4",
    priorWarning: string | null,
  ): BaseMatchLoad {
    if (!this.matchCache) {
      return {
        detail,
        raw,
        payloadHash: null,
        cache: emptyCacheProvenance(source, priorWarning),
      };
    }
    try {
      const saved = this.matchCache.saveMatch({
        matchId: detail.matchId,
        platform: detail.platform,
        region: detail.region,
        raw,
        sourceEndpoint,
        baseProjection: detail,
      });
      if (!saved.projected) {
        const richer = this.matchCache.readMatch(detail.matchId, detail.platform);
        if (richer?.baseProjection) {
          return {
            detail: richer.baseProjection,
            raw: richer.raw,
            payloadHash: richer.payloadHash,
            cache: {
              source: "local-projection",
              matchSaved: true,
              savedAt: richer.savedAt,
              payloadHash: richer.payloadHash,
              projectionVersion: matchFocusProjectionVersion,
              warning: priorWarning,
            },
          };
        }
      }
      return {
        detail,
        raw,
        payloadHash: saved.payloadHash,
        cache: {
          source,
          matchSaved: true,
          savedAt: saved.savedAt,
          payloadHash: saved.payloadHash,
          projectionVersion: matchFocusProjectionVersion,
          warning: priorWarning,
        },
      };
    } catch (error) {
      const warning = "Could not save the local match cache; check cache permissions and disk space.";
      return {
        detail,
        raw,
        payloadHash: null,
        cache: emptyCacheProvenance(source, unique([priorWarning ?? "", warning]).join("; ")),
      };
    }
  }

  private materializeMatch(base: MatchDetail, focusPuuid: string | null): MatchDetail {
    return {
      ...base,
      analysis: this.roundAnalysis.analyze(base, focusPuuid),
      performance: this.matchPerformance.analyze(base, focusPuuid),
      economy: this.matchEconomy.analyze(base),
      duels: this.matchDuels.analyze(base),
      roundEvidence: this.roundEvidence.analyze(base),
    };
  }

  private async resolveFocusPuuid(
    detail: MatchDetail,
    focusPlayer: string | undefined,
    region: ValorantRegion,
    platform: ValorantPlatform,
  ): Promise<string | null> {
    if (!focusPlayer) return null;
    const selector = parseTrackerProfileInput(focusPlayer).player;
    try {
      const local = resolveMatchPlayer(detail, selector);
      if (local.puuid) return local.puuid;
    } catch {
      // Fall through for a valid account that is not a participant in this match.
    }
    return (await this.resolvePlayerContext(focusPlayer, region, platform)).account.puuid;
  }

  private async resolveAccount(
    player: string,
    region: ValorantRegion,
    platform: ValorantPlatform,
  ): Promise<HenrikAccount> {
    const normalized = player.trim();
    if (!normalized) throw new ValorantInputError("Player identifier is required");
    const cacheKey = `${region}:${platform}:${normalized.toLowerCase()}`;
    const cached = readCache(this.accounts, cacheKey);
    if (cached) return cached;

    const riotId = splitRiotId(normalized);
    const account = riotId
      ? await this.henrik.getAccountByRiotId(riotId.name, riotId.tag)
      : await this.henrik.getAccountByPuuid(normalized);
    writeCache(this.accounts, cacheKey, account, accountTtlMs);
    writeCache(this.accounts, `${region}:${platform}:${account.puuid.toLowerCase()}`, account, accountTtlMs);
    writeCache(
      this.accounts,
      `${region}:${platform}:${account.name.toLowerCase()}#${account.tag.toLowerCase()}`,
      account,
      accountTtlMs,
    );
    return account;
  }

  private async resolvePlayerContext(
    player: string,
    fallbackRegion: ValorantRegion,
    fallbackPlatform: ValorantPlatform,
  ): Promise<{
    account: HenrikAccount;
    region: ValorantRegion;
    platform: ValorantPlatform;
    playlist: string | null;
    season: string | null;
    source: "direct" | "tracker-profile";
  }> {
    const parsed = parseTrackerProfileInput(player);
    const platform = parsed.platform ?? fallbackPlatform;
    const account = await this.resolveAccount(parsed.player, fallbackRegion, platform);
    return {
      account,
      region: valorantRegion(account.region) ?? fallbackRegion,
      platform,
      playlist: parsed.playlist,
      season: parsed.season,
      source: parsed.source,
    };
  }
}

function playerIdentity(account: HenrikAccount, region: string, platform: string): PlayerIdentity {
  return {
    puuid: account.puuid,
    riotId: `${account.name}#${account.tag}`,
    gameName: account.name,
    tagLine: account.tag,
    region: account.region ?? region,
    platform: account.platforms?.[0]?.toLowerCase() ?? platform,
    accountLevel: account.account_level ?? null,
    cardId: account.card ?? null,
    titleId: account.title ?? null,
  };
}

function normalizeRank(raw: unknown): RankSnapshot | null {
  const root = record(raw);
  const current = record(root.current);
  const tier = record(current.tier);
  const peak = record(root.peak);
  const peakTier = record(peak.tier);
  if (!Object.keys(current).length && !Object.keys(peak).length) return null;
  return {
    tierId: finiteNumber(tier.id),
    tierName: text(tier.name),
    rr: finiteNumber(current.rr),
    elo: finiteNumber(current.elo),
    peakTierName: text(peakTier.name),
    peakTierId: finiteNumber(peakTier.id),
    peakSeasonId: text(record(peak.season).id),
    peakSeasonShort: text(record(peak.season).short),
    leaderboardPlacement: finiteNumber(current.leaderboard_placement),
    updatedAt: new Date().toISOString(),
  };
}

function splitRiotId(value: string): { name: string; tag: string } | null {
  const marker = value.lastIndexOf("#");
  if (marker <= 0 || marker === value.length - 1) return null;
  return { name: value.slice(0, marker).trim(), tag: value.slice(marker + 1).trim() };
}

function valorantRegion(value: string | undefined): ValorantRegion | null {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized === "na" ||
    normalized === "eu" ||
    normalized === "latam" ||
    normalized === "br" ||
    normalized === "ap" ||
    normalized === "kr"
    ? normalized
    : null;
}

function roundFacts(
  round: UserRoundEvidenceProjectionV1["rounds"][number],
  focusPuuid: string | null,
  focusTeam: string | null,
  focusOutcome: "win" | "loss" | "unknown",
  turningPoints: NonNullable<MatchDetail["analysis"]>["turningPoints"],
): string[] {
  const kills = round.events.filter((event) => event.kind === "kill");
  const firstKill = kills[0];
  const focusKills = focusPuuid ? kills.filter((event) => event.actor.puuid === focusPuuid).length : 0;
  const focusDeaths = focusPuuid ? kills.filter((event) => event.target?.puuid === focusPuuid).length : 0;
  const facts = [
    `Round ${round.roundNumber}: ${round.winningTeam ?? "unknown team"} won${round.result ? ` by ${round.result}` : ""}.`,
    `Recorded ${kills.length} kills${focusPuuid ? `; focus player had ${focusKills} kills and ${focusDeaths} deaths` : ""}.`,
  ];
  if (firstKill?.target) {
    facts.push(
      `Opening kill: ${firstKill.actor.gameName} eliminated ${firstKill.target.gameName} at ${formatRoundTime(firstKill.timeInRoundMs)}.`,
    );
  }
  const objective = round.events.find((event) => event.kind === "plant" || event.kind === "defuse");
  if (objective)
    facts.push(
      `${objective.kind === "plant" ? "Spike planted" : "Spike defused"}${objective.site ? ` at ${objective.site}` : ""} at ${formatRoundTime(objective.timeInRoundMs)}.`,
    );
  if (focusTeam)
    facts.push(
      `Focus team ${focusOutcome === "win" ? "won" : focusOutcome === "loss" ? "lost" : "has an unknown result for"} the round.`,
    );
  turningPoints.slice(0, 3).forEach((point) => facts.push(`${point.title}: ${point.detail}`));
  return facts;
}

function formatRoundTime(value: number | null): string {
  if (value === null) return "an unknown time";
  return `${Math.floor(value / 60_000)}:${String(Math.floor((value % 60_000) / 1_000)).padStart(2, "0")}`;
}

function teamForPlayer(detail: MatchDetail, puuid: string): string | null {
  return detail.teams.flatMap((team) => team.players).find((player) => player.puuid === puuid)?.teamId ?? null;
}

function sameTeam(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawMatchKey(region: string, platform: string, matchId: string): string {
  return `${region}:${platform}:${matchId}`;
}

function isDetailCompleteEnough(detail: MatchDetail): boolean {
  const playerCount = detail.teams.reduce((count, team) => count + team.players.length, 0);
  if (playerCount < 2) return false;
  const mode = detail.mode
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z]/g, "");
  if (mode === "deathmatch" || mode === "teamdeathmatch") return detail.killEvents.length > 0;
  return detail.rounds.length > 0;
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
