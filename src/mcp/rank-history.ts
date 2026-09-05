import * as z from "zod/v4";
import { HenrikApiError } from "./henrik-client";

const text = z.string().min(1).max(256);
const pair = z.object({ id: text, name: text });
const historySchema = z.object({
  account: z.object({ puuid: text }).optional(),
  history: z
    .array(
      z.object({
        match_id: text,
        date: z.string().max(80),
        map: pair,
        tier: z.object({ id: z.number().int(), name: text }),
        season: z.object({ id: text, short: text }),
        rr: z.number().int(),
        last_change: z.number().int(),
        elo: z.number().int(),
        refunded_rr: z.number().int(),
        was_derank_protected: z.boolean(),
      }),
    )
    .max(1000),
});

export function normalizeRankHistory(raw: unknown, puuid: string) {
  const parsed = historySchema.safeParse(raw);
  if (!parsed.success || (parsed.data.account && parsed.data.account.puuid !== puuid))
    throw new HenrikApiError("Invalid rank history fields", 200, "invalid-payload");
  const seen = new Set<string>();
  return parsed.data.history
    .filter((row) => {
      if (seen.has(row.match_id)) return false;
      seen.add(row.match_id);
      return true;
    })
    .map((row) => ({
      matchId: row.match_id,
      map: row.map,
      tier: row.tier,
      season: row.season,
      rr: row.rr,
      rrDelta: row.last_change,
      providerElo: row.elo,
      refundedRr: row.refunded_rr,
      wasDerankProtected: row.was_derank_protected,
      changedAt: Number.isFinite(Date.parse(row.date)) ? new Date(row.date).toISOString() : null,
    }))
    .sort((a, b) => (Date.parse(b.changedAt ?? "") || 0) - (Date.parse(a.changedAt ?? "") || 0));
}
