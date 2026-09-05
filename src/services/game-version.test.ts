import { describe, expect, test } from "bun:test";

import { valorantPatchFromGameVersion } from "./game-version";

describe("valorantPatchFromGameVersion", () => {
  test("extracts the public patch while preserving parsing strictness", () => {
    expect(valorantPatchFromGameVersion("release-13.02-shipping-15-5253245")).toBe("13.02");
    expect(valorantPatchFromGameVersion("13.2")).toBe("13.02");
    expect(valorantPatchFromGameVersion("shipping-build-5253245")).toBeNull();
    expect(valorantPatchFromGameVersion(null)).toBeNull();
  });
});
