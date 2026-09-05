import { describe, expect, test } from "bun:test";

import { sanitizedMatchDetail } from "../mcp/test-fixture";
import {
  buildUserCoachingProjectionV1,
  buildUserMatchProjectionV1,
  buildUserRoundEvidenceProjectionV1,
  parseUserCoachingProjectionV1,
  parseUserMatchProjectionV1,
  parseUserRoundEvidenceProjectionV1,
} from "./match-product-contracts";

describe("versioned match, round and coaching contracts", () => {
  test("selects exact user facts while removing source and packet internals", () => {
    const detail = sanitizedMatchDetail();
    const match = parseUserMatchProjectionV1(JSON.parse(JSON.stringify(buildUserMatchProjectionV1(detail))));
    const rounds = parseUserRoundEvidenceProjectionV1(
      JSON.parse(JSON.stringify(buildUserRoundEvidenceProjectionV1(detail))),
    );
    const coaching = parseUserCoachingProjectionV1(
      JSON.parse(JSON.stringify(buildUserCoachingProjectionV1(detail.coaching))),
    );

    expect(match.version).toBe("user-match-v1");
    expect(match.match).toMatchObject({
      matchId: "sanitized-match-001",
      map: "Haven",
      patch: "13.02",
      endState: { kind: "completed" },
    });
    expect(match.teams[0]).toMatchObject({ score: 13 });
    expect(match.teams[0]?.players[0]).toMatchObject({
      riotId: "SamplePlayer#EU",
      combat: { kills: 21, deaths: 12, assists: 5, acs: 244, adr: 158 },
    });
    expect(match.coverage).toEqual({
      rounds: "available",
      events: "available",
      economy: "available",
      coaching: "available",
    });
    expect(rounds.version).toBe("user-round-evidence-v1");
    expect(rounds).toMatchObject({ matchId: "sanitized-match-001", coverage: { rounds: 1, killEvents: 1 } });
    expect(rounds.rounds[0]?.events[0]).toMatchObject({ id: "r1-kill-0", distanceMeters: 7 });
    expect(coaching).toMatchObject({ version: "user-coaching-v1", matchId: "sanitized-match-001" });
    expect(coaching).not.toHaveProperty("cached");
    expect(coaching.coverage).toMatchObject({
      evidenceAgreement: "unknown",
      continuousPov: false,
      comms: false,
      intent: false,
      crosshairPlacement: false,
      continuousMovement: false,
    });
    expect(coaching.claims[0]).toMatchObject({
      label: "observed",
      confidence: "high",
      evidenceIds: ["match:sanitized-match-001"],
    });
    expect(JSON.stringify({ match, rounds, coaching })).not.toMatch(
      /provider|payloadHash|packetHash|focusPuuid|sourceVersion|provenance/i,
    );
  });

  test("rejects missing, unknown, changed-version and unsupported-evidence shapes", () => {
    const match = buildUserMatchProjectionV1(sanitizedMatchDetail());
    expect(() => parseUserMatchProjectionV1({ ...match, provider: "internal" })).toThrow("unknown field provider");
    expect(() => parseUserMatchProjectionV1({ ...match, version: "user-match-v2" })).toThrow("Unsupported");
    const rounds = buildUserRoundEvidenceProjectionV1(sanitizedMatchDetail())!;
    const { coverage: _coverage, ...missing } = rounds;
    expect(() => parseUserRoundEvidenceProjectionV1(missing)).toThrow("missing field coverage");
    const coaching = buildUserCoachingProjectionV1(sanitizedMatchDetail().coaching)!;
    expect(() =>
      parseUserCoachingProjectionV1({ ...coaching, coverage: { ...coaching.coverage, comms: true } }),
    ).toThrow("coverage.comms must be false");
  });

  test("preserves conflict disclosure without exposing provider identifiers", () => {
    const detail = sanitizedMatchDetail();
    const source = detail.coaching!;
    const projection = buildUserCoachingProjectionV1({
      ...source,
      coverage: {
        ...source.coverage,
        sources: { available: 2, providers: ["provider-canary-a", "provider-canary-b"], conflictState: "conflict" },
      },
      claims: [
        {
          id: "source-conflict",
          label: "observed",
          confidence: "high",
          text: "Stored providers disagree.",
          evidenceIds: ["source:provider-canary-a:1", "source:provider-canary-b:1"],
        },
      ],
    })!;
    expect(projection.coverage.evidenceAgreement).toBe("conflict");
    expect(projection.claims[0]?.text).toBe("stored evidence revisions disagree.");
    expect(projection.claims[0]?.evidenceIds).toEqual(["stored-evidence:1", "stored-evidence:2"]);
    expect(JSON.stringify(projection)).not.toContain("provider-canary");
    expect(JSON.stringify(projection)).not.toMatch(/provider/i);
  });
});
