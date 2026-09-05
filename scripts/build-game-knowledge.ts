import { createHash } from "node:crypto";
import { mapTransformFingerprintInput } from "../src/domain/map-spatial-resources";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Envelope = { data?: unknown[] };
type Row = Record<string, unknown>;

const source = process.argv[2]?.trim();
if (!source) {
  console.error("Usage: bun run scripts/build-game-knowledge.ts <valorant-content-metadata-directory>");
  process.exit(2);
}

const outputDirectory = process.argv[3]?.trim() || join(import.meta.dir, "..", "assets", "valorant");
const target = join(outputDirectory, "knowledge.json");
const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as {
  version: number;
  locale: string;
  fetchedAt: string;
  sources: Array<{ file: string; sha256: string; url: string }>;
};
if (manifest.version !== 1 || !Number.isFinite(Date.parse(manifest.fetchedAt)))
  throw new Error("A versioned source manifest with fetchedAt is required. Run fetch-game-content.ts first.");
if (new Set(manifest.sources.map((row) => row.file)).size !== 4 || manifest.sources.length !== 4)
  throw new Error("Exactly four distinct source files are required.");
for (const row of manifest.sources) {
  if (!["version.json", "agents.json", "maps.json", "weapons.json"].includes(row.file))
    throw new Error("Unknown content source file");
  if (
    createHash("sha256")
      .update(await readFile(join(source, row.file)))
      .digest("hex") !== row.sha256
  )
    throw new Error(`Source hash mismatch: ${row.file}`);
}
const contentVersion = record(JSON.parse(await readFile(join(source, "version.json"), "utf8")).data);
const [agents, maps, weapons] = await Promise.all([load("agents.json"), load("maps.json"), load("weapons.json")]);

const knowledge = {
  version: 2,
  generatedAt: manifest.fetchedAt,
  locale: manifest.locale,
  contentVersion,
  agents: agents
    .filter((row) => row.isPlayableCharacter === true)
    .map((row) => ({
      uuid: string(row.uuid),
      name: string(row.displayName),
      aliases: [string(row.displayName)],
      icon: optionalString(row.displayIcon),
      portrait: optionalString(row.fullPortrait),
      roleIcon: optionalString(record(row.role).displayIcon),
      description: optionalString(row.description),
      role: optionalString(record(row.role).displayName),
      roleDescription: optionalString(record(row.role).description),
      abilities: array(row.abilities).map((ability) => ({
        slot: string(record(ability).slot),
        name: string(record(ability).displayName),
        icon: optionalString(record(ability).displayIcon),
        description: optionalString(record(ability).description),
      })),
    }))
    .filter((row) => row.uuid && row.name)
    .sort((left, right) => left.name.localeCompare(right.name)),
  maps: maps
    .map((row) => ({
      uuid: string(row.uuid),
      name: string(row.displayName),
      coordinates: optionalString(row.coordinates),
      icon: optionalString(row.displayIcon),
      splash: optionalString(row.splash),
      transforms: {
        xMultiplier: optionalNumber(row.xMultiplier),
        yMultiplier: optionalNumber(row.yMultiplier),
        xScalarToAdd: optionalNumber(row.xScalarToAdd),
        yScalarToAdd: optionalNumber(row.yScalarToAdd),
      },
      callouts: array(row.callouts)
        .map((callout) => ({
          region: string(record(callout).regionName),
          superRegion: string(record(callout).superRegionName),
          x: number(record(record(callout).location).x),
          y: number(record(record(callout).location).y),
        }))
        .filter((callout) => callout.region && Number.isFinite(callout.x) && Number.isFinite(callout.y)),
    }))
    .filter((row) => row.uuid && row.name)
    .sort((left, right) => left.name.localeCompare(right.name)),
  weapons: weapons
    .map((row) => {
      const stats = record(row.weaponStats);
      return {
        uuid: string(row.uuid),
        name: string(row.displayName),
        aliases: [string(row.displayName)],
        icon: optionalString(row.displayIcon),
        price: optionalNumber(record(row.shopData).cost),
        category: optionalString(row.category)?.replace("EEquippableCategory::", "") ?? null,
        fireRate: optionalNumber(stats.fireRate),
        magazineSize: optionalNumber(stats.magazineSize),
        wallPenetration: optionalString(stats.wallPenetration)?.replace("EWallPenetrationDisplayType::", "") ?? null,
        damageRanges: array(stats.damageRanges).map((range) => ({
          startMeters: number(record(range).rangeStartMeters),
          endMeters: number(record(range).rangeEndMeters),
          head: number(record(range).headDamage),
          body: number(record(range).bodyDamage),
          legs: number(record(range).legDamage),
        })),
      };
    })
    .filter((row) => row.uuid && row.name)
    .sort((left, right) => left.name.localeCompare(right.name)),
};

const transforms = JSON.parse(mapTransformFingerprintInput()) as Record<string, Record<string, unknown>>;
for (const row of maps) {
  const bundled = transforms[string(row.displayName).toLowerCase()];
  if (!bundled) continue;
  for (const key of ["uuid", "xMultiplier", "yMultiplier", "xScalarToAdd", "yScalarToAdd"])
    if (row[key] !== bundled[key])
      throw new Error(
        `Map transform changed for ${string(row.displayName)}; review tactical artwork and transforms together before rebuilding.`,
      );
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(target, `${JSON.stringify(knowledge, null, 2)}\n`, "utf8");
const bundledRoot = join(import.meta.dir, "..", "assets", "valorant");
const catalog = JSON.parse(await readFile(join(bundledRoot, "catalog.json"), "utf8")) as Record<
  string,
  Record<string, { icon: string; uuid: string }>
>;
const assets = [];
for (const [kind, rows] of Object.entries(catalog))
  for (const [name, row] of Object.entries(rows)) {
    if (!/^(maps|agents|weapons)\/[a-f0-9-]+\.png$/.test(row.icon)) throw new Error("Invalid bundled asset path");
    assets.push({
      kind,
      name,
      uuid: row.uuid,
      file: row.icon,
      sha256: createHash("sha256")
        .update(await readFile(join(bundledRoot, row.icon)))
        .digest("hex"),
    });
  }
assets.sort((a, b) => a.file.localeCompare(b.file));
const buildManifest = {
  version: 1,
  source: "valorant-api.com",
  unofficial: true,
  locale: manifest.locale,
  sourceFetchedAt: manifest.fetchedAt,
  contentVersion,
  sources: manifest.sources,
  knowledgeSha256: createHash("sha256")
    .update(JSON.stringify(knowledge, null, 2) + "\n")
    .digest("hex"),
  transformsSha256: createHash("sha256").update(mapTransformFingerprintInput()).digest("hex"),
  selectedFields: {
    agents: [
      "uuid",
      "name",
      "aliases",
      "description",
      "role",
      "roleDescription",
      "roleIcon",
      "icon",
      "portrait",
      "abilities",
    ],
    maps: ["uuid", "name", "coordinates", "icon", "splash", "transforms", "callouts"],
    weapons: [
      "uuid",
      "name",
      "aliases",
      "icon",
      "price",
      "category",
      "fireRate",
      "magazineSize",
      "wallPenetration",
      "damageRanges",
    ],
  },
  assets,
};
await writeFile(join(outputDirectory, "content-manifest.json"), JSON.stringify(buildManifest, null, 2) + "\n");
console.error(
  `Wrote ${target}: ${knowledge.agents.length} agents, ${knowledge.maps.length} maps, ${knowledge.weapons.length} weapons`,
);

async function load(name: string): Promise<Row[]> {
  const envelope = JSON.parse(await readFile(join(source!, name), "utf8")) as Envelope;
  return array(envelope.data).map(record);
}
function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}
function optionalString(value: unknown): string | null {
  const valueString = string(value).trim();
  return valueString || null;
}
function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
