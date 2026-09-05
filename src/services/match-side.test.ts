import { describe, expect, test } from "bun:test";
import { normalizeMatchDetail } from "./match-detail-normalizer";
import { sideForRound, summarizeMatchSideRounds } from "./match-side";

describe("match side analysis", () => {
  test("derives regulation attack and defense wins from a planted-spike side anchor", () => {
    const rounds = Array.from({ length: 14 }, (_, index) => {
      const number = index + 1;
      const blueWon = number <= 12 ? number <= 7 : true;
      return {
        round: number,
        winning_team: blueWon ? "Blue" : "Red",
        result: number === 1 ? "Elimination" : "Elimination",
        plant: number === 1 ? { player: { puuid: "focus", name: "Focus", tag: "EU", team: "Blue" } } : undefined,
      };
    });
    const match = normalizeMatchDetail(
      {
        metadata: { match_id: "side-match", map: { name: "Haven" }, queue: { name: "Competitive" } },
        players: [
          { puuid: "focus", name: "Focus", tag: "EU", team_id: "Blue" },
          { puuid: "enemy", name: "Enemy", tag: "EU", team_id: "Red" },
        ],
        teams: [
          { team_id: "Blue", rounds: { won: 9, lost: 5 }, won: true },
          { team_id: "Red", rounds: { won: 5, lost: 9 }, won: false },
        ],
        rounds,
      },
      { region: "eu", platform: "pc", source: "cache" },
    );

    expect(match).not.toBeNull();
    expect(summarizeMatchSideRounds(match!, "focus")).toEqual({
      attackRounds: 12,
      attackRoundsWon: 7,
      defenseRounds: 2,
      defenseRoundsWon: 2,
    });
  });

  test("does not guess sides without a spike or round-result anchor", () => {
    const match = normalizeMatchDetail(
      {
        metadata: { match_id: "unanchored" },
        players: [
          { puuid: "focus", name: "Focus", team_id: "Blue" },
          { puuid: "enemy", name: "Enemy", team_id: "Red" },
        ],
        rounds: [{ round: 1, winning_team: "Blue", result: "Elimination" }],
      },
      { region: "eu", platform: "pc", source: "cache" },
    );

    expect(summarizeMatchSideRounds(match!, "focus")).toBeNull();
  });

  test("alternates overtime sides after the regulation switch", () => {
    const match = normalizeMatchDetail(
      {
        metadata: { match_id: "overtime" },
        players: [
          { puuid: "focus", name: "Focus", team_id: "Blue" },
          { puuid: "enemy", name: "Enemy", team_id: "Red" },
        ],
        rounds: [{ round: 1, winning_team: "Blue", result: "Detonate" }],
      },
      { region: "eu", platform: "pc", source: "cache" },
    );

    expect(sideForRound(match!, "Blue", 12, "Blue")).toBe("attack");
    expect(sideForRound(match!, "Blue", 13, "Blue")).toBe("defense");
    expect(sideForRound(match!, "Blue", 25, "Blue")).toBe("attack");
    expect(sideForRound(match!, "Blue", 26, "Blue")).toBe("defense");
  });
});
