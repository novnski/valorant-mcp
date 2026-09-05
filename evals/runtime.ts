import { ValorantRuntime } from "../src/mcp/valorant-runtime";
import { providerMatch } from "./fixtures/provider";

/** Public synthetic scenario. This provider performs no network requests. */
export function evaluationRuntime(): ValorantRuntime {
  return new ValorantRuntime({
    async getAccountByRiotId() {
      return { puuid: "focus-puuid", name: "Focus", tag: "EU", region: "eu" };
    },
    async getAccountByPuuid(puuid: string) {
      return { puuid, name: puuid === "focus-puuid" ? "Focus" : "Enemy", tag: "EU", region: "eu" };
    },
    async getMmrByPuuid() {
      return null;
    },
    async getMatchesByPuuid() {
      return [providerMatch("cache-match-1")];
    },
    async getMatch() {
      return providerMatch("cache-match-1");
    },
  });
}
