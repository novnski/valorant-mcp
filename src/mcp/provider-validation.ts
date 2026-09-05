import * as z from "zod/v4";

const identifier = z.string().min(1).max(256);
const name = z.string().min(1).max(160);
const count = z.number().finite().nonnegative().nullable().optional();
const identity = z.looseObject({
  puuid: identifier.optional(),
  name: name.optional(),
  tag: name.optional(),
  team: z.string().max(80).optional(),
});
const position = z.looseObject({ x: z.number().finite(), y: z.number().finite() });
export const accountPayload = z.looseObject({
  puuid: identifier,
  name,
  tag: name,
  region: z.string().max(20).optional(),
  platforms: z.array(z.string().max(20)).max(10).optional(),
  account_level: count,
});
export const matchPayload = z.looseObject({
  metadata: z.looseObject({ match_id: identifier }),
  players: z
    .array(
      z.looseObject({
        puuid: identifier.optional(),
        name: name.optional(),
        tag: name.optional(),
        stats: z.looseObject({ kills: count, deaths: count, assists: count, score: count }).optional(),
      }),
    )
    .max(100)
    .optional(),
  rounds: z
    .array(z.looseObject({ round: z.number().int().nonnegative().optional() }))
    .max(200)
    .optional(),
  kills: z
    .array(
      z.looseObject({
        round: z.number().int().nonnegative().nullable().optional(),
        time_in_round_in_ms: count,
        killer: identity.optional(),
        victim: identity.optional(),
        location: position.nullable().optional(),
        player_locations: z
          .array(
            z.looseObject({
              player: identity.optional(),
              location: position,
              view_radians: z.number().finite().nullable().optional(),
            }),
          )
          .max(100)
          .optional(),
      }),
    )
    .max(10_000)
    .optional(),
});
export const rankPayload = z
  .looseObject({
    current: z
      .looseObject({ rr: count, elo: count, tier: z.looseObject({ id: count, name: name.optional() }).optional() })
      .nullable()
      .optional(),
    peak: z
      .looseObject({ tier: z.looseObject({ id: count, name: name.optional() }).optional() })
      .nullable()
      .optional(),
  })
  .nullable();
export const stratsCatalog = z.array(z.looseObject({ id: identifier, name })).max(200);
export const stratsLineup = z.looseObject({
  id: identifier,
  title: z.string().max(2000).nullable().optional(),
  description: z.string().max(40_000).nullable().optional(),
  views: count,
});
export const stratsGroups = z
  .array(z.looseObject({ lineups: z.array(stratsLineup).max(5_000).nullable().optional() }))
  .max(5_000);
