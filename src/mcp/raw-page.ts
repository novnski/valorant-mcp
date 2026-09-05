import { ValorantInputError } from "./errors";

export type RawPageInput = { path?: string; offset?: number; limit?: number };
export type RawPage = {
  version: "raw-page-v2";
  path: string;
  data: unknown;
  pagination: {
    offset: number;
    returned: number;
    total: number;
    nextOffset: number | null;
    unit: "entries" | "characters" | "scalar";
  };
  expandable: Array<{ path: string; type: string; entries: number }>;
};

/** Exact values or explicit expandable JSON pointers; never truncated JSON. */
export function rawPage(root: unknown, input: RawPageInput): RawPage {
  const path = input.path ?? "";
  if (path && !path.startsWith("/"))
    throw new ValorantInputError("path must be a JSON pointer, for example /rounds/0.");
  let node = root;
  for (const token of path ? path.slice(1).split("/") : []) {
    if (/~(?![01])/u.test(token)) throw new ValorantInputError("Invalid JSON pointer escape; use ~0 or ~1.");
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key))
      throw new ValorantInputError("No raw field exists at that path. Inspect its parent pointer first.");
    node = (node as Record<string, unknown>)[key];
  }
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  const expandable: RawPage["expandable"] = [];
  let data: unknown = node;
  let total = 1;
  let returned = 1;
  let unit: RawPage["pagination"]["unit"] = "scalar";
  if (typeof node === "string") {
    unit = "characters";
    total = node.length;
    data = node.slice(offset, offset + Math.min(limit * 100, 4_000));
    returned = (data as string).length;
  } else if (node !== null && typeof node === "object") {
    unit = "entries";
    const entries = Object.entries(node);
    total = entries.length;
    const selected = entries.slice(offset, offset + limit);
    const values: Array<[string, unknown]> = [];
    let bytes = 0;
    for (const [key, value] of selected) {
      const pointer = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      const serialized = JSON.stringify(value);
      const size = Buffer.byteLength(serialized ?? "null");
      if (size > 4_000) {
        expandable.push({
          path: pointer,
          type: Array.isArray(value) ? "array" : typeof value,
          entries: typeof value === "string" ? value.length : Object.keys(value as object).length,
        });
        values.push([key, { $expand: pointer }]);
      } else {
        if (bytes + size > 40_000) break;
        values.push([key, value]);
        bytes += size;
      }
    }
    returned = values.length;
    data = Array.isArray(node) ? values.map(([, value]) => value) : Object.fromEntries(values);
  } else if (offset > 0) {
    data = null;
    returned = 0;
  }
  return {
    version: "raw-page-v2",
    path,
    data,
    pagination: { offset, returned, total, nextOffset: offset + returned < total ? offset + returned : null, unit },
    expandable,
  };
}
