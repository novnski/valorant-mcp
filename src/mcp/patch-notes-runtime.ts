import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/v4";
import { assetRoot } from "./paths";
import { SharedReads, requestSignal } from "./request-context";
import { TransientCache } from "./transient-cache";

const newsSchema = z.looseObject({
  id: z.string().max(256).optional(),
  title: z.string().max(1000),
  date: z.string().max(80),
  category: z.string().max(256),
  url: z.string().max(2048),
  content: z.string().max(250_000).nullable().optional(),
});
export type NewsEntry = z.infer<typeof newsSchema>;
export type NewsReader = {
  getWebsite(locale: string): Promise<unknown>;
  getWebsiteEntry(locale: string, id: string): Promise<unknown>;
};
export type PatchNotesInput = { patch?: string; locale?: string; sections?: string[]; limit?: number };
type Section = {
  heading: string;
  platform: "all" | "pc" | "console" | "unspecified";
  text: string;
  truncated: boolean;
  timing: "may-include-future-announcements";
};

export class PatchNotesRuntime {
  private readonly reads = new SharedReads();
  private readonly lists = new TransientCache<{ rows: NewsEntry[]; fetchedAt: string }>(8, 2 * 1024 * 1024);
  private readonly details = new TransientCache<{ row: NewsEntry; fetchedAt: string }>(32, 4 * 1024 * 1024);
  constructor(private readonly reader: NewsReader | null) {}

  async getPatchNotes(input: PatchNotesInput) {
    const locale = (input.locale ?? "en-US").toLowerCase();
    let source = "henrik";
    let warning: string | null = null;
    let list: { rows: NewsEntry[]; fetchedAt: string };
    try {
      list = await this.reads.run(`news:${locale}`, async () => {
        const cached = this.lists.get(locale);
        if (cached) return cached;
        if (!this.reader) throw new Error("No configured news reader");
        // No category literal: provider category values have not been authenticated in this environment.
        const rows = z
          .array(newsSchema)
          .max(2000)
          .parse(await this.reader.getWebsite(locale));
        const result = { rows, fetchedAt: new Date().toISOString() };
        this.lists.set(locale, result, 10 * 60_000);
        return result;
      });
    } catch {
      requestSignal()?.throwIfAborted();
      const bundled = JSON.parse(await readFile(join(assetRoot, "patch-notes.json"), "utf8")) as {
        verifiedAt: string;
        articles: NewsEntry[];
      };
      list = {
        rows: bundled.articles.filter((r) => canonical(r.url)?.locale === locale),
        fetchedAt: bundled.verifiedAt,
      };
      source = "bundled-riot-metadata";
      warning =
        "Live patch discovery is unavailable. These are known bundled links; the latest published patch has not been verified live.";
    }
    const requestedPatch = input.patch && input.patch !== "latest" ? normalizePatch(input.patch) : null;
    const matches = list.rows
      .flatMap((row) => {
        const url = canonical(row.url);
        const patch = patchIdentity(row);
        const published = Date.parse(row.date);
        return url &&
          patch &&
          Number.isFinite(published) &&
          url.locale === locale &&
          (!requestedPatch || requestedPatch === patch)
          ? [{ row, url, patch, published }]
          : [];
      })
      .sort((a, b) => b.published - a.published || b.patch.localeCompare(a.patch, undefined, { numeric: true }));
    const unique = matches.filter(
      (candidate, index) => matches.findIndex((r) => r.url.url === candidate.url.url) === index,
    );
    const articles = [];
    for (const selected of unique.slice(0, input.limit ?? 1)) {
      let row = selected.row;
      let contentFetchedAt: string | null = null;
      let contentWarning: string | null = null;
      if (source === "henrik" && this.reader && row.id) {
        try {
          const id = row.id;
          const detail = await this.reads.run(`article:${locale}:${id}`, async () => {
            const cached = this.details.get(`${locale}:${id}`);
            if (cached) return cached;
            const value = newsSchema.parse(await this.reader!.getWebsiteEntry(locale, id));
            if (canonical(value.url)?.url !== selected.url.url || patchIdentity(value) !== selected.patch)
              throw new Error("Article identity mismatch");
            const result = { row: value, fetchedAt: new Date().toISOString() };
            this.details.set(`${locale}:${id}`, result, 10 * 60_000);
            return result;
          });
          row = detail.row;
          contentFetchedAt = detail.fetchedAt;
        } catch {
          requestSignal()?.throwIfAborted();
          contentWarning = "Article detail is unavailable; retaining canonical link and publication metadata.";
        }
      }
      const parsed = parsePatchSections(row.content ?? null, input.sections);
      articles.push({
        title: row.title,
        patch: selected.patch,
        published_at: new Date(selected.published).toISOString(),
        locale,
        canonical_url: selected.url.url,
        source,
        source_fetched_at: list.fetchedAt,
        content_fetched_at: contentFetchedAt,
        content_status: row.content ? "sections" : "metadata-only",
        sections: parsed.sections,
        sections_truncated: parsed.truncated,
        warning:
          contentWarning ?? (!row.content ? "The source provided no article body. Use the canonical Riot link." : null),
      });
    }
    return {
      requested_patch: input.patch ?? "latest",
      locale,
      source,
      source_fetched_at: list.fetchedAt,
      latest_scope: source === "henrik" ? "returned-provider-publications" : "known-bundled-publications",
      articles,
      returned: articles.length,
      has_more: unique.length > articles.length,
      warning:
        warning ??
        (!articles.length ? "No matching patch publication was found in the available source window." : null),
      limitations: [
        "Publication dates and article patch identities determine ordering; content build dates do not.",
        "A patch article can include future announcements. Retain its platform headings and wording; do not treat every statement as an already released change.",
      ],
    };
  }
}

export function parsePatchSections(content: string | null, filters?: string[]) {
  if (!content) return { sections: [] as Section[], truncated: false };
  const clean = content.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const headings = [...clean.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const blocks = headings.length
    ? headings.map((h, index) => ({
        heading: plain(h[2]!),
        text: plain(clean.slice(h.index! + h[0].length, headings[index + 1]?.index ?? clean.length)),
      }))
    : [{ heading: "Article", text: plain(clean) }];
  let platform: Section["platform"] = "unspecified";
  const sections: Section[] = [];
  for (const block of blocks) {
    if (/all platforms/i.test(block.heading)) platform = "all";
    else if (/\bpc only\b/i.test(block.heading)) platform = "pc";
    else if (/\bconsole(?: only)?\b/i.test(block.heading)) platform = "console";
    if (
      !block.text ||
      (filters?.length && !filters.some((filter) => block.heading.toLowerCase().includes(filter.toLowerCase())))
    )
      continue;
    sections.push({
      heading: block.heading.slice(0, 200),
      platform,
      text: block.text.slice(0, 1500),
      truncated: block.text.length > 1500,
      timing: "may-include-future-announcements",
    });
  }
  return {
    sections: sections.slice(0, 6),
    truncated: sections.length > 6 || sections.some((section) => section.truncated),
  };
}
function plain(value: string) {
  return value
    .replace(/<\/(?:p|li|div)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
function normalizePatch(value: string): string {
  const match = value.match(/^(\d{1,2})\.(\d{1,2})$/);
  return match ? `${Number(match[1])}.${match[2]!.padStart(2, "0")}` : value;
}
function patchIdentity(row: NewsEntry): string | null {
  const slug = row.url.match(/patch-notes-(\d{1,2})-(\d{1,2})(?:\/|$)/i);
  const title = row.title.match(/(?:patch|notes|notas|패치|更新|パッチ)[^\d]*(\d{1,2})\.(\d{1,2})/i);
  const found = slug ?? title;
  return found ? normalizePatch(`${found[1]}.${found[2]}`) : null;
}
function canonical(value: string): { url: string; locale: string } | null {
  try {
    const url = new URL(value, "https://playvalorant.com");
    const locale = url.pathname.match(/^\/([a-z]{2}-[a-z]{2})\/news\/game-updates\//i)?.[1]?.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.hostname !== "playvalorant.com" ||
      url.port ||
      url.username ||
      url.password ||
      !locale
    )
      return null;
    url.search = "";
    url.hash = "";
    return { url: url.href, locale };
  } catch {
    return null;
  }
}
