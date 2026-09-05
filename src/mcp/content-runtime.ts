import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as z from "zod/v4";
import { assetRoot } from "./paths";
import { gameKnowledge } from "./game-knowledge";
import { ValorantInputError } from "./errors";
import { ProviderTransport, ProviderTransportError } from "./provider-transport";
import { SharedReads, requestSignal } from "./request-context";
import { TransientCache } from "./transient-cache";

export type ContentKind = "agent" | "map" | "weapon";
type Row = Record<string, unknown>;
type ContentEntry = Row & { uuid: string; name: string };
type Catalog = Record<"agents" | "maps" | "weapons", Record<string, { uuid: string; icon: string }>>;
type ContentInput = { kind: ContentKind; query: string; locale?: string; fresh?: boolean };
const entrySchema = z.looseObject({
  uuid: z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i),
  displayName: z.string().min(1).max(160),
});
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export class ContentRuntime {
  private readonly reads = new SharedReads();
  private readonly metadata = new TransientCache<{ data: Row; fetchedAt: string }>(64, 4 * 1024 * 1024);
  private readonly images = new TransientCache<{ data: string; width: number; height: number; hash: string }>(
    24,
    4 * 1024 * 1024,
  );
  constructor(private readonly transport = new ProviderTransport("valorant-api.com", 250)) {}

  async getContent(input: ContentInput) {
    const knowledge = gameKnowledge();
    const entries = knowledge[`${input.kind}s` as "agents" | "maps" | "weapons"] as ContentEntry[];
    const bundled = entries.find(
      (row) => row.uuid === input.query.toLowerCase() || normalize(row.name) === normalize(input.query),
    );
    const uuid = bundled?.uuid ?? (uuidPattern.test(input.query) ? input.query.toLowerCase() : null);
    if (!uuid)
      throw new ValorantInputError(
        `Unknown ${input.kind}. Use a bundled name or the explicit Valorant-API UUID for newer content.`,
      );
    const locale = input.locale ?? "en-US";
    let data = bundled ?? null;
    let source = "bundled";
    let fetchedAt: string | null = knowledge.generatedAt;
    let version: Row | null = knowledge.contentVersion ?? null;
    let warning: string | null = null;
    if (input.fresh) {
      try {
        const fresh = await this.fetchMetadata(`/v1/${input.kind}s/${uuid}?language=${encodeURIComponent(locale)}`);
        if (!entrySchema.safeParse(fresh.data).success || fresh.data.uuid !== uuid)
          throw new ProviderTransportError("invalid-payload", 200);
        data = projectContent(input.kind, fresh.data);
        fetchedAt = fresh.fetchedAt;
        source = "valorant-api.com";
        try {
          version = (await this.fetchMetadata("/v1/version")).data;
        } catch {
          requestSignal()?.throwIfAborted();
          version = null;
          warning = "Fresh content loaded, but its build/version could not be verified.";
        }
      } catch (error) {
        requestSignal()?.throwIfAborted();
        if (error instanceof ProviderTransportError && error.code === "cancelled") throw error;
        if (!bundled)
          throw new ValorantInputError(
            "Fresh public content is unavailable and this UUID is not bundled. Check the UUID or retry later.",
          );
        source = "bundled-fallback";
        warning = "Fresh public content is unavailable; returning the identified bundled snapshot.";
      }
    }
    if (!data)
      throw new ValorantInputError(
        "That UUID has no bundled content. Set fresh=true for an explicit public metadata lookup.",
      );
    return {
      kind: input.kind,
      data,
      source,
      locale: source === "valorant-api.com" ? locale : (knowledge.locale ?? "en-US"),
      requested_locale: locale,
      source_fetched_at: fetchedAt,
      source_updated_at: null,
      knowledge_generated_at: knowledge.generatedAt,
      content_manifest: string(version?.manifestId),
      content_version: version,
      match_patch: null,
      historical_patch_applicability: "unknown" as const,
      warning,
    };
  }

  async getAsset(input: ContentInput & { ability?: string; size?: number }): Promise<
    Awaited<ReturnType<ContentRuntime["getContent"]>> & {
      assetSource: string;
      source_url: string | null;
      image: { data: string; width: number; height: number; hash: string };
      mimeType: "image/png";
    }
  > {
    let content = await this.getContent(input);
    const size = input.size ?? 256;
    let bytes: Buffer;
    let assetSource: string;
    let sourceUrl: string | null = null;
    let cacheTtl = 0;
    if (!input.fresh && !input.ability) {
      const catalog = JSON.parse(await readFile(join(assetRoot, "catalog.json"), "utf8")) as Catalog;
      const entry = Object.values(catalog[`${input.kind}s` as keyof Catalog]).find(
        (row) => row.uuid === content.data.uuid,
      );
      if (!entry || !/^(maps|agents|weapons)\/[a-f0-9-]+\.png$/.test(entry.icon))
        throw new ValorantInputError(
          "No bundled artwork exists for this content. Set fresh=true to request a public asset explicitly.",
        );
      bytes = await readFile(join(assetRoot, entry.icon));
      assetSource = "bundled";
    } else {
      if (!input.fresh)
        throw new ValorantInputError(
          "Ability artwork is linked in bundled knowledge but is not downloaded locally. Set fresh=true to retrieve one explicitly.",
        );
      let candidate = string(content.data.icon);
      if (input.ability) {
        if (input.kind !== "agent") throw new ValorantInputError("ability is only supported for agent assets.");
        const ability = array(content.data.abilities)
          .map(record)
          .find(
            (row) =>
              normalize(string(row.slot) ?? "") === normalize(input.ability!) ||
              normalize(string(row.name) ?? "") === normalize(input.ability!),
          );
        candidate = string(ability?.icon);
      }
      if (!candidate) throw new ValorantInputError("The selected content has no image for this slot.");
      const url = new URL(candidate);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "media.valorant-api.com" ||
        url.port ||
        url.username ||
        url.password ||
        !/^\/(agents|maps|weapons)\//.test(url.pathname)
      )
        throw new ValorantInputError("The provider returned an unsupported asset URL.");
      sourceUrl = url.href;
      assetSource = "valorant-api.com";
      const cached = this.images.get(`${url.href}:${size}`);
      if (cached)
        return { ...content, assetSource, source_url: sourceUrl, image: cached, mimeType: "image/png" as const };
      try {
        bytes = await this.reads.run(`asset:${url.href}`, () => this.transport.binary(url.href));
        const policy = this.transport.cachePolicy(bytes);
        cacheTtl = policy.noStore ? 0 : Math.min(5 * 60_000, policy.maxAgeMs ?? 5 * 60_000);
      } catch (error) {
        requestSignal()?.throwIfAborted();
        if (input.ability) throw error;
        const fallback = await this.getAsset({ ...input, fresh: false });
        return {
          ...fallback,
          warning: "Fresh artwork is unavailable; returning bundled artwork.",
          assetSource: "bundled-fallback",
        };
      }
    }
    const image = await renderAsset(bytes, size);
    if (sourceUrl) this.images.set(`${sourceUrl}:${size}`, image, cacheTtl);
    return { ...content, assetSource, source_url: sourceUrl, image, mimeType: "image/png" as const };
  }

  private async fetchMetadata(path: string) {
    return this.reads.run(path, async () => {
      const cached = this.metadata.get(path);
      if (cached) return cached;
      const envelope = (await this.transport.json(`https://valorant-api.com${path}`, {}, true)) as { data: unknown };
      const data = record(envelope.data);
      if (!Object.keys(data).length) throw new ProviderTransportError("invalid-payload", 200);
      const result = { data, fetchedAt: new Date().toISOString() };
      const policy = this.transport.cachePolicy(envelope);
      this.metadata.set(path, result, policy.noStore ? 0 : Math.min(5 * 60_000, policy.maxAgeMs ?? 5 * 60_000));
      return result;
    });
  }
}

export function projectContent(kind: ContentKind, row: Row): ContentEntry {
  const base = { uuid: String(row.uuid), name: String(row.displayName), icon: string(row.displayIcon) };
  if (kind === "agent")
    return {
      ...base,
      description: string(row.description),
      portrait: string(row.fullPortrait),
      role: string(record(row.role).displayName),
      roleIcon: string(record(row.role).displayIcon),
      abilities: array(row.abilities)
        .slice(0, 8)
        .map(record)
        .map((a) => ({
          slot: string(a.slot),
          name: string(a.displayName),
          description: string(a.description),
          icon: string(a.displayIcon),
        })),
    };
  if (kind === "map")
    return {
      ...base,
      coordinates: string(row.coordinates),
      splash: string(row.splash),
      callouts: array(row.callouts)
        .slice(0, 100)
        .map(record)
        .map((c) => ({
          region: string(c.regionName),
          superRegion: string(c.superRegionName),
          x: number(record(c.location).x),
          y: number(record(c.location).y),
        })),
      competitive_rotation: "unknown",
    };
  const stats = record(row.weaponStats);
  return {
    ...base,
    category: string(row.category)?.replace("EEquippableCategory::", "") ?? null,
    price: number(record(row.shopData).cost),
    fireRate: number(stats.fireRate),
    magazineSize: number(stats.magazineSize),
    wallPenetration: string(stats.wallPenetration)?.replace("EWallPenetrationDisplayType::", "") ?? null,
    damageRanges: array(stats.damageRanges)
      .slice(0, 12)
      .map(record)
      .map((r) => ({
        startMeters: number(r.rangeStartMeters),
        endMeters: number(r.rangeEndMeters),
        head: number(r.headDamage),
        body: number(r.bodyDamage),
        legs: number(r.legDamage),
      })),
  };
}
async function renderAsset(bytes: Buffer, size: number) {
  const decoded = await loadImage(bytes);
  if (decoded.width > 8192 || decoded.height > 8192)
    throw new ValorantInputError("Asset dimensions exceed the supported image budget.");
  let width = size,
    height = size,
    output: Buffer;
  do {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const scale = Math.min(width / decoded.width, height / decoded.height);
    ctx.drawImage(
      decoded,
      (width - decoded.width * scale) / 2,
      (height - decoded.height * scale) / 2,
      decoded.width * scale,
      decoded.height * scale,
    );
    output = Buffer.from(await canvas.encode("png"));
    if (output.length <= 256 * 1024) break;
    width = Math.floor(width / 2);
    height = Math.floor(height / 2);
  } while (width >= 64);
  if (output.length > 256 * 1024) throw new ValorantInputError("Asset could not fit the image byte budget.");
  return { data: output.toString("base64"), width, height, hash: createHash("sha256").update(output).digest("hex") };
}
function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function string(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 8000) : null;
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
