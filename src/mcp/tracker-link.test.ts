import { describe, expect, test } from "bun:test";

import { parseTrackerMatchInput, parseTrackerProfileInput } from "./tracker-link";

const matchUrl = "https://tracker.gg/valorant/match/8aa18f0a-58bc-4f13-ba0b-9afc4be74f95";
const profileUrl =
  "https://tracker.gg/valorant/profile/riot/Sample%20Player%23TEST/overview?platform=pc&playlist=swiftplay&season=8102cd81-43a0-d0d7-bd59-47b8fe9bed1b";

describe("Tracker.gg link parsing", () => {
  test("extracts Henrik's UUID directly from a Tracker match link", () => {
    expect(parseTrackerMatchInput(matchUrl)).toEqual({
      matchId: "8aa18f0a-58bc-4f13-ba0b-9afc4be74f95",
      source: "tracker-match",
    });
  });

  test("extracts Riot ID and useful query hints from a Tracker profile link", () => {
    expect(parseTrackerProfileInput(profileUrl)).toEqual({
      player: "Sample Player#TEST",
      source: "tracker-profile",
      platform: "pc",
      playlist: "swiftplay",
      season: "8102cd81-43a0-d0d7-bd59-47b8fe9bed1b",
    });
  });

  test("keeps ordinary IDs unchanged and accepts Markdown-escaped query separators", () => {
    expect(parseTrackerMatchInput("plain-match-id")).toEqual({ matchId: "plain-match-id", source: "direct" });
    expect(parseTrackerProfileInput("Sample Player#TEST").player).toBe("Sample Player#TEST");
    expect(parseTrackerProfileInput(profileUrl.replaceAll("&", "\\&")).playlist).toBe("swiftplay");
  });

  test("rejects lookalike hosts and wrong Tracker URL kinds", () => {
    expect(() =>
      parseTrackerMatchInput("https://tracker.gg.evil.example/valorant/match/8aa18f0a-58bc-4f13-ba0b-9afc4be74f95"),
    ).toThrow("Only HTTPS tracker.gg");
    expect(() => parseTrackerProfileInput(matchUrl)).toThrow("Tracker profile URL must use");
    expect(() => parseTrackerMatchInput(profileUrl)).toThrow("Tracker match URL must use");
  });
});
