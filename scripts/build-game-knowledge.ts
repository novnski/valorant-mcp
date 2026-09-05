import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Envelope = { data?: unknown[] };
type Row = Record<string, unknown>;

const source = process.argv[2]?.trim();
if (!source) {
  console.error("Usage: bun run scripts/build-game-knowledge.ts <valorant-content-metadata-directory>");
  process.exit(2);
}

const target = join(import.meta.dir, "..", "assets", "valorant", "knowledge.json");
const [agents, maps, weapons] = await Promise.all([load("agents.json"), load("maps.json"), load("weapons.json")]);

const knowledge = {
  version: 1,
  generatedAt: new Date().toISOString(),
  agents: agents
    .filter((row) => row.isPlayableCharacter === true)
    .map((row) => ({
      uuid: string(row.uuid),
      name: string(row.displayName),
      description: optionalString(row.description),
      role: optionalString(record(row.role).displayName),
      roleDescription: optionalString(record(row.role).description),
      abilities: array(row.abilities).map((ability) => ({
        slot: string(record(ability).slot),
        name: string(record(ability).displayName),
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
      callouts: array(row.callouts)
        .map((callout) => ({
          region: string(record(callout).regionName),
          superRegion: string(record(callout).superRegionName),
          x: number(record(record(callout).location).x),
          y: number(record(record(callout).location).y),
        }))
        .filter((callout) => callout.region && Number.isFinite(callout.x) && Number.isFinite(callout.y)),
    }))
    .filter((row) => row.uuid && row.name && row.callouts.length)
    .sort((left, right) => left.name.localeCompare(right.name)),
  weapons: weapons
    .map((row) => {
      const stats = record(row.weaponStats);
      return {
        uuid: string(row.uuid),
        name: string(row.displayName),
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

await mkdir(join(import.meta.dir, "..", "assets", "valorant"), { recursive: true });
await writeFile(target, `${JSON.stringify(knowledge, null, 2)}\n`, "utf8");
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
