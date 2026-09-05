import { expect, test } from "bun:test";
import { actionableError, ValorantInputError } from "./errors";
import { HenrikApiError, HenrikClient } from "./henrik-client";

test("unexpected errors never disclose internal messages or credentials", () => {
  const response = actionableError(new Error("Authorization: Bearer secret-value /Users/private/cache.db"));
  expect(response).not.toContain("secret-value");
  expect(response).not.toContain("/Users/private");
  expect(response).toContain("report the tool name");
});

test("selection errors remain actionable and bounded", () => {
  expect(actionableError(new ValorantInputError("Round 9 is unavailable. Available rounds: 1, 2"))).toContain(
    "Available rounds",
  );
  expect(actionableError(new ValorantInputError("a".repeat(5000))).length).toBe(4000);
});

test("authentication errors describe standard MCP setup", () => {
  const response = actionableError(new HenrikApiError("internal", null, "missing-config"));
  expect(response).toContain("HENRIK_API_KEY");
  expect(response).not.toContain("hermes");
});

test("invalid pacing is rejected instead of silently using another quota", () => {
  for (const value of ["oops", "0", "1.5", "301", ""]) {
    expect(() => HenrikClient.fromEnv({ HENRIK_API_KEY: "test", HENRIK_REQUESTS_PER_MINUTE: value })).toThrow(
      "HENRIK_REQUESTS_PER_MINUTE",
    );
  }
});
