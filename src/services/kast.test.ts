import { describe, expect, test } from "bun:test";
import { derivePlayerKast } from "./kast";

describe("derivePlayerKast", () => {
  test("keeps Henrik v4 zero-based round ids aligned with zero-based kill events", () => {
    const raw = match({
      rounds: [{ id: 0 }, { id: 1 }],
      kills: [death(0, 10_000)],
    });

    expect(derivePlayerKast(raw, "target")).toBe(0.5);
  });

  test("counts an assist-only round from kill-event assistants", () => {
    const raw = match({
      rounds: [{ id: 0 }],
      kills: [
        {
          round: 0,
          time_in_round_in_ms: 8_000,
          killer: { puuid: "enemy-two", team: "Red" },
          victim: { puuid: "target", team: "Blue" },
          assistants: [{ puuid: "target" }],
        },
      ],
    });

    expect(derivePlayerKast(raw, "target")).toBe(1);
  });

  test("counts a death traded by a teammate within five seconds", () => {
    const raw = match({
      rounds: [{ id: 0 }],
      kills: [
        death(0, 10_000),
        {
          round: 0,
          time_in_round_in_ms: 14_500,
          killer: { puuid: "teammate", team: "Blue" },
          victim: { puuid: "enemy", team: "Red" },
        },
      ],
    });

    expect(derivePlayerKast(raw, "target")).toBe(1);
  });

  test("does not widen the documented trade window to match opaque competitor values", () => {
    const raw = match({
      rounds: [{ id: 0 }],
      kills: [
        death(0, 10_000),
        {
          round: 0,
          time_in_round_in_ms: 20_408,
          killer: { puuid: "teammate", team: "Blue" },
          victim: { puuid: "enemy", team: "Red" },
        },
      ],
    });

    expect(derivePlayerKast(raw, "target")).toBe(0);
  });

  test("excludes trailing placeholder rounds when the scored round count is known", () => {
    const raw = match({
      rounds: [{ id: 0 }, { id: 1 }, { id: 2 }],
      kills: [death(2, 10_000)],
    });

    expect(derivePlayerKast(raw, "target", 2)).toBe(1);
  });
});

function match(overrides: { rounds: unknown[]; kills: unknown[] }) {
  return {
    players: [
      { puuid: "target", team_id: "Blue" },
      { puuid: "teammate", team_id: "Blue" },
      { puuid: "enemy", team_id: "Red" },
      { puuid: "enemy-two", team_id: "Red" },
    ],
    ...overrides,
  };
}

function death(round: number, time: number) {
  return {
    round,
    time_in_round_in_ms: time,
    killer: { puuid: "enemy", team: "Red" },
    victim: { puuid: "target", team: "Blue" },
  };
}
