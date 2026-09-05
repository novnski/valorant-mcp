import type { MatchDetail, MatchKillEvent } from "../domain/types";

export function killRoundOffset(detail: MatchDetail): 0 | 1 {
  return detail.killRoundOffset ?? (detail.killEvents.some((event) => event.round === 0) ? 1 : 0);
}
export function killRoundNumber(detail: MatchDetail, event: MatchKillEvent): number | null {
  return event.round === null ? null : event.round + killRoundOffset(detail);
}
