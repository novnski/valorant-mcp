import { describe, expect, test } from "bun:test";
import { sanitizedMatchDetail } from "../mcp/test-fixture";
import {
  buildUserMatchFeatureProjectionV1,
  parseUserMatchFeatureProjectionV1,
  userMatchFeatures,
} from "./match-feature-contracts";

describe("user-match-feature-v1", () => {
  test("projects each active feature without operational internals", () => {
    const detail = sanitizedMatchDetail();
    for (const feature of userMatchFeatures) {
      const result = buildUserMatchFeatureProjectionV1(detail, feature, "sanitized-profile-puuid");
      expect(parseUserMatchFeatureProjectionV1(result)).toEqual(result);
      expect(result).toMatchObject({ version: "user-match-feature-v1", matchId: detail.matchId, feature });
      const text = JSON.stringify(result).toLowerCase();
      for (const forbidden of ["source", "provider", "raw", "payload", "job", "hash", "provenance", "cache"])
        expect(text).not.toContain(forbidden);
    }
  });

  test("rejects unknown and oversized nested data", () => {
    const result = buildUserMatchFeatureProjectionV1(sanitizedMatchDetail(), "economy", "sanitized-profile-puuid");
    expect(() => parseUserMatchFeatureProjectionV1({ ...result, provider: "x" })).toThrow();
    expect(() =>
      parseUserMatchFeatureProjectionV1({
        ...result,
        data: { teams: Array.from({ length: 5 }, () => (result.data as { teams: unknown[] }).teams[0]) },
      }),
    ).toThrow("at most 4");
    expect(() => parseUserMatchFeatureProjectionV1({ ...result, available: false })).toThrow("must be null");
  });

  test("owns opponent damage delta and rejects inconsistent or unknown fields", () => {
    const detail = sanitizedMatchDetail();
    detail.performance = {
      modelVersion: "match-performance-v1",
      focusPuuid: "sanitized-profile-puuid",
      topRivalPuuid: "opponent",
      rounds: [],
      sideSplits: [],
      weapons: [],
      impact: {
        firstKills: null,
        firstDeaths: null,
        roundsWonAfterFirstKill: null,
        roundsLostAfterFirstDeath: null,
        firstKillConversionRate: null,
        firstDeathPunishRate: null,
        lastDeaths: null,
        tradeKills: null,
        tradesPerRound: null,
        plants: null,
        defuses: null,
        killsPerMinute: null,
      },
      opponents: [
        {
          puuid: "opponent",
          gameName: "Opponent",
          tagLine: "EU",
          agentName: "Omen",
          kills: 1,
          deaths: 1,
          damageDealt: 180,
          damageReceived: 140,
        },
      ],
      warnings: [],
    };
    const result = buildUserMatchFeatureProjectionV1(detail, "damage", "sanitized-profile-puuid");
    if (!result.available || result.feature !== "damage") throw new Error("damage fixture missing");
    expect(result.data.opponents.every((row) => row.damageDelta === row.damageDealt - row.damageReceived)).toBe(true);
    const [first, ...rest] = result.data.opponents;
    if (!first) return;
    expect(() =>
      parseUserMatchFeatureProjectionV1({
        ...result,
        data: { opponents: [{ ...first, damageDelta: first.damageDelta + 1 }, ...rest] },
      }),
    ).toThrow("must match");
    expect(() =>
      parseUserMatchFeatureProjectionV1({
        ...result,
        data: { opponents: [{ ...first, computedInRenderer: true }, ...rest] },
      }),
    ).toThrow("invalid shape");
  });
});
