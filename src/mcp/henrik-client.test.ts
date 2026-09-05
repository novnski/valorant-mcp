import { describe, expect, test } from "bun:test";

import { HenrikApiError, HenrikClient } from "./henrik-client";

describe("HenrikClient", () => {
  test("fails closed when the API key is missing", () => {
    expect(() => new HenrikClient("")).toThrow(HenrikApiError);
  });

  test("keeps the credential in the Authorization header", async () => {
    let requestedUrl = "";
    let authorization = "";
    const client = new HenrikClient("secret-test-key", 300, async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ status: 200, data: { puuid: "p", name: "Name", tag: "TAG" } });
    });

    const account = await client.getAccountByRiotId("Name", "TAG");

    expect(account.puuid).toBe("p");
    expect(authorization).toBe("secret-test-key");
    expect(requestedUrl).not.toContain("secret-test-key");
    expect(requestedUrl).toEndWith("/valorant/v2/account/Name/TAG");
  });

  test("turns rate limits into an actionable retry timestamp", async () => {
    const client = new HenrikClient("secret-test-key", 300, async () =>
      Response.json(
        { status: 429, errors: [{ message: "slow down" }] },
        { status: 429, headers: { "retry-after": "2" } },
      ),
    );

    const error = await client.getAccountByPuuid("p").catch((caught) => caught);

    expect(error).toBeInstanceOf(HenrikApiError);
    expect(error).toMatchObject({ code: "rate-limited", status: 429, retryable: true });
    expect(Date.parse(error.retryAt)).toBeGreaterThan(Date.now());
  });

  test("bounds recent-match pagination to twenty rows", async () => {
    let calls = 0;
    const client = new HenrikClient("secret-test-key", 300, async (input) => {
      calls += 1;
      const url = new URL(String(input));
      const start = Number(url.searchParams.get("start"));
      return Response.json({
        status: 200,
        data: Array.from({ length: 10 }, (_, index) => ({ metadata: { match_id: `test-match-${start + index}` } })),
      });
    });

    const rows = await client.getMatchesByPuuid("eu", "pc", "p", 99);

    expect(rows).toHaveLength(20);
    expect(calls).toBe(2);
  });
});
