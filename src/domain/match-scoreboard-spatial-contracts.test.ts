import { describe, expect, test } from "bun:test";
import { sanitizedMatchDetail } from "../mcp/test-fixture";
import { MatchPerformanceService } from "../services/match-performance-service";
import {
  buildUserMatchScoreboardProjectionV1,
  buildUserSpatialEvidenceProjectionV1,
  parseUserMatchScoreboardProjectionV1,
  parseUserSpatialEvidenceProjectionV1,
} from "./match-scoreboard-spatial-contracts";

describe("selective scoreboard and sparse spatial contracts", () => {
  test("projects only stored advanced player facts and scopes trades to the selected player", () => {
    const detail = sanitizedMatchDetail();
    detail.teams[0]!.players[0]!.abilityCasts = { grenade: 2, ability1: 3, ability2: 4, ultimate: 1, total: 10 };
    detail.teams[0]!.players[0]!.highlights = ["1v2 Clutch", "Three kills"];
    detail.teams[0]!.players[0]!.multiKills = 3;
    detail.teams[0]!.players[0]!.threePlusKillRounds = 2;
    detail.teams[0]!.players[0]!.spentAverage = 3_400;
    detail.teams[0]!.players[0]!.loadoutAverage = 4_100;
    detail.performance = new MatchPerformanceService().analyze(detail, "sanitized-profile-puuid");
    const projection = buildUserMatchScoreboardProjectionV1(detail, "sanitized-profile-puuid");
    expect(parseUserMatchScoreboardProjectionV1(projection)).toEqual(projection);
    expect(projection.teams[0]!.players[0]).toMatchObject({
      utility: { totalCasts: 10 },
      trades: { kills: 0, perRound: 0 },
      clutches: { labels: ["1v2 Clutch"] },
      multikills: { highest: 3, threePlusRounds: 2 },
      economy: { averageSpend: 3_400, averageLoadout: 4_100 },
    });
    expect(projection.teams[1]!.players[0]!.trades).toBeNull();
    expect(() =>
      parseUserMatchScoreboardProjectionV1({
        ...projection,
        teams: [{ ...projection.teams[0], players: [{ ...projection.teams[0]!.players[0], tradeDeaths: 3 }] }],
      }),
    ).toThrow("unknown field tradeDeaths");
  });

  test("normalizes sparse event snapshots once and exposes exact transform coverage", () => {
    const detail = sanitizedMatchDetail();
    detail.mapName = "Lotus";
    detail.killEvents[0]!.victimLocation = { x: 6_103, y: -3_917 };
    detail.killEvents[0]!.playerLocations[0]!.location = { x: 6_103, y: -3_917 };
    const projection = buildUserSpatialEvidenceProjectionV1(detail);
    expect(parseUserSpatialEvidenceProjectionV1(projection)).toEqual(projection);
    expect(projection).toMatchObject({
      map: { name: "Lotus", width: 1, height: 1 },
      coverage: {
        transformAvailable: true,
        totalKillEvents: 1,
        eventsWithPositions: 1,
        validSamples: 2,
        invalidSamples: 0,
        uniquePlayers: 2,
        rounds: 1,
      },
    });
    expect(projection.samples.map((sample) => sample.role)).toEqual(["observed-player", "target"]);
    expect(projection.samples[0]).toMatchObject({ eventKind: "kill", outcome: "round-win" });
    expect(projection.samples[0]!.x).toBeCloseTo(0.172765, 6);
    expect(projection.samples[0]!.y).toBeCloseTo(0.478336, 6);
    expect(projection.limitations.join(" ")).toMatch(/not movement paths/i);
    expect(() =>
      parseUserSpatialEvidenceProjectionV1({
        ...projection,
        samples: [{ ...projection.samples[0], x: 2 }],
        coverage: { ...projection.coverage, validSamples: 1 },
      }),
    ).toThrow("must be a ratio");
  });

  test("fails honestly when the map transform is unavailable", () => {
    const detail = sanitizedMatchDetail();
    detail.mapName = "Unknown Training Map";
    const projection = buildUserSpatialEvidenceProjectionV1(detail);
    expect(projection.map).toBeNull();
    expect(projection.samples).toEqual([]);
    expect(projection.coverage).toMatchObject({ transformAvailable: false, validSamples: 0, invalidSamples: 2 });
    expect(projection.unavailableReason).toMatch(/no documented coordinate transform/i);
  });

  test("accepts only the exact first-party game asset route", () => {
    const projection = buildUserSpatialEvidenceProjectionV1(sanitizedMatchDetail());
    expect(() =>
      parseUserSpatialEvidenceProjectionV1({
        ...projection,
        map: { ...projection.map!, assetUrl: "https://media.valorant-api.com/maps/icon.png" },
      }),
    ).toThrow("first-party game asset route");
    expect(() =>
      parseUserSpatialEvidenceProjectionV1({
        ...projection,
        map: { ...projection.map!, assetUrl: `${projection.map!.assetUrl}?token=private` },
      }),
    ).toThrow("first-party game asset route");
  });
});
