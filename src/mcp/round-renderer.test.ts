import { describe, expect, test } from "bun:test";

import { facingTriangleVertices, teamMarkerColor, victimXSegments } from "./round-renderer";

describe("tactical facing triangle", () => {
  test("uses a portrait-width base under the icon and a short outward point", () => {
    const triangle = facingTriangleVertices({ x: 100, y: 100 }, 0);

    expect(triangle).toEqual({
      tip: { x: 132, y: 100 },
      baseLeft: { x: 104, y: 118 },
      baseRight: { x: 104, y: 82 },
    });
    expect(Math.hypot(triangle.baseLeft.x - triangle.baseRight.x, triangle.baseLeft.y - triangle.baseRight.y)).toBe(36);
  });

  test("rotates the point, not the base, into the recorded facing direction", () => {
    const triangle = facingTriangleVertices({ x: 100, y: 100 }, Math.PI / 2);

    expect(triangle.tip.x).toBeCloseTo(100, 8);
    expect(triangle.tip.y).toBe(132);
    expect((triangle.baseLeft.y + triangle.baseRight.y) / 2).toBe(104);
  });

  test("uses only provider red and blue team colors for outlines and triangles", () => {
    expect(teamMarkerColor("Red")).toBe("#ff655f");
    expect(teamMarkerColor("Blue")).toBe("#55b8ff");
    expect(teamMarkerColor(null)).toBe("#a6b1c3");
  });

  test("centers a large victim X across the portrait", () => {
    const segments = victimXSegments({ x: 100, y: 200 });

    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      expect((segment.from.x + segment.to.x) / 2).toBe(100);
      expect((segment.from.y + segment.to.y) / 2).toBe(200);
      expect(Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)).toBeCloseTo(36.66, 2);
    }
  });
});
