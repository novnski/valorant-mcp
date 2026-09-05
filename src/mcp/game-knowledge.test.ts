import { describe, expect, test } from "bun:test";

import {
  abilityCastContext,
  findAgentKnowledge,
  findMapKnowledge,
  findWeaponKnowledge,
  nearestMapCallout,
} from "./game-knowledge";

describe("game knowledge", () => {
  test("provides agent role, abilities, and descriptions", () => {
    const phoenix = findAgentKnowledge("phoenix");
    expect(phoenix).toMatchObject({ name: "Phoenix", role: "Duelist" });
    expect(phoenix?.abilities.map((ability) => ability.name)).toEqual(
      expect.arrayContaining(["Blaze", "Hot Hands", "Curveball", "Run it Back"]),
    );
  });

  test("maps round ability slots to named abilities without inventing timing", () => {
    const context = abilityCastContext("Phoenix", { grenade: 1, ability1: 0, ability2: 2, ultimate: 1, total: 4 });
    expect(context?.casts).toEqual([
      expect.objectContaining({ slot: "grenade", ability: "Blaze", count: 1 }),
      expect.objectContaining({ slot: "ability2", ability: "Curveball", count: 2 }),
      expect.objectContaining({ slot: "ultimate", ability: "Run it Back", count: 1 }),
    ]);
    expect(context?.limitation).toContain("not cast timestamps");
  });

  test("labels exact map anchors and exposes the nearest-anchor method", () => {
    const callout = nearestMapCallout("Split", { x: -2_190.7827, y: -3_848.0293 });
    expect(callout).toEqual({
      name: "B Garage",
      region: "Garage",
      superRegion: "B",
      distanceMeters: 0,
      confidence: "high",
      method: "nearest-callout-anchor",
    });
    expect(findMapKnowledge("Split")?.callouts.length).toBeGreaterThan(20);
  });

  test("includes weapon category and damage context", () => {
    expect(findWeaponKnowledge("Vandal")).toMatchObject({
      name: "Vandal",
      category: "Rifle",
      magazineSize: 25,
      damageRanges: [expect.objectContaining({ startMeters: 0, endMeters: 50, head: 160, body: 40 })],
    });
  });
});
