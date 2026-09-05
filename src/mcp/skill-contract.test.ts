import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skill = readFileSync(join(import.meta.dir, "..", "..", "skills", "valorant-analyst", "SKILL.md"), "utf8");

describe("Valorant analyst skill", () => {
  test("has valid identifying frontmatter and strong trigger language", () => {
    expect(skill).toMatch(/^---\nname: valorant-analyst\ndescription: .+Valorant.+\n/);
    expect(skill).toContain("Use whenever the user asks what happened in a Valorant game or round");
  });

  test("defines score, death, button, geometry, and evidence workflows", () => {
    for (const required of [
      "valorant_explain_round",
      "valorant_review_deaths",
      "valorant_render_round",
      "clarify",
      "opening duel",
      "site access",
      "crossfire",
      "103°",
      "walls",
      "smoke",
      "flash",
      "ability cast counts",
    ])
      expect(skill).toContain(required);
  });

  test("forbids absolute sight and causality claims from sparse evidence", () => {
    expect(skill).toContain("not proof of visibility");
    expect(skill).toContain("Never claim these as observed");
    expect(skill).toContain("every tactical inference has a corresponding observed fact");
  });
});
