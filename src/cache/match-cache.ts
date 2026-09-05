import { projectionDependencyFingerprint } from "./projection-dependencies";
import type { MatchDetail } from "../domain/types";

export const matchBaseProjectionVersion = `match-base-cache-v2:${projectionDependencyFingerprint}`;
export const matchFocusProjectionVersion = `match-focus-cache-v2:${projectionDependencyFingerprint}`;
export const matchTimelineProjectionVersion = `match-timeline-cache-v2:${projectionDependencyFingerprint}`;

export type MatchCacheSource = "local-projection" | "local-reprojected" | "recent-list" | "henrik-detail" | "memory";

export type MatchCacheProvenance = {
  source: MatchCacheSource;
  matchSaved: boolean;
  savedAt: string | null;
  payloadHash: string | null;
  projectionVersion: string;
  warning: string | null;
};

export type CachedMatchRead = {
  matchId: string;
  platform: string;
  region: string;
  raw: unknown;
  rawJson: string;
  payloadHash: string;
  completenessScore: number;
  savedAt: string;
  sourceEndpoint: "recent-list-v4" | "match-detail-v4";
  baseProjection: MatchDetail | null;
  baseProjectionVersion: string | null;
  baseProjectionInputHash: string | null;
};

export type CachedFocusProjectionRead = {
  detail: MatchDetail;
  savedAt: string;
  payloadHash: string;
};

export type SaveMatchInput = {
  matchId: string;
  platform: string;
  region: string;
  raw: unknown;
  sourceEndpoint: "recent-list-v4" | "match-detail-v4";
  baseProjection: MatchDetail;
};

export type SaveMatchResult = {
  savedAt: string;
  payloadHash: string;
  projected: boolean;
};

export interface MatchCache {
  readMatch(matchId: string, platform: string): CachedMatchRead | null;
  readFocusProjection(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    payloadHash: string,
  ): CachedFocusProjectionRead | null;
  saveMatch(input: SaveMatchInput): SaveMatchResult;
  saveFocusProjection(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    payloadHash: string,
    detail: MatchDetail,
  ): void;
  readDerivedProjection<T>(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    kind: string,
    version: string,
    payloadHash: string,
  ): T | null;
  saveDerivedProjection(
    matchId: string,
    platform: string,
    focusPuuid: string | null,
    kind: string,
    version: string,
    payloadHash: string,
    value: unknown,
  ): void;
  countMatches(): number;
  close(): void;
}

export class MatchCacheError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MatchCacheError";
  }
}

export function emptyCacheProvenance(source: MatchCacheSource, warning: string | null = null): MatchCacheProvenance {
  return {
    source,
    matchSaved: false,
    savedAt: null,
    payloadHash: null,
    projectionVersion: matchFocusProjectionVersion,
    warning,
  };
}
