const mediaBase = "/assets/game";

type MapSpatialResource = {
  uuid: string;
  xMultiplier: number;
  yMultiplier: number;
  xScalarToAdd: number;
  yScalarToAdd: number;
};

const resources: Record<string, MapSpatialResource> = {
  abyss: {
    uuid: "224b0a95-48b9-f703-1bd8-67aca101a61f",
    xMultiplier: 0.000081,
    yMultiplier: -0.000081,
    xScalarToAdd: 0.5,
    yScalarToAdd: 0.5,
  },
  ascent: {
    uuid: "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319",
    xMultiplier: 0.00007,
    yMultiplier: -0.00007,
    xScalarToAdd: 0.813895,
    yScalarToAdd: 0.573242,
  },
  bind: {
    uuid: "2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba",
    xMultiplier: 0.000059,
    yMultiplier: -0.000059,
    xScalarToAdd: 0.576941,
    yScalarToAdd: 0.967566,
  },
  breeze: {
    uuid: "2fb9a4fd-47b8-4e7d-a969-74b4046ebd53",
    xMultiplier: 0.00007,
    yMultiplier: -0.00007,
    xScalarToAdd: 0.465123,
    yScalarToAdd: 0.833078,
  },
  corrode: {
    uuid: "1c18ab1f-420d-0d8b-71d0-77ad3c439115",
    xMultiplier: 0.00007,
    yMultiplier: -0.00007,
    xScalarToAdd: 0.526158,
    yScalarToAdd: 0.5,
  },
  fracture: {
    uuid: "b529448b-4d60-346e-e89e-00a4c527a405",
    xMultiplier: 0.000078,
    yMultiplier: -0.000078,
    xScalarToAdd: 0.556952,
    yScalarToAdd: 1.155886,
  },
  haven: {
    uuid: "2bee0dc9-4ffe-519b-1cbd-7fbe763a6047",
    xMultiplier: 0.000075,
    yMultiplier: -0.000075,
    xScalarToAdd: 1.09345,
    yScalarToAdd: 0.642728,
  },
  icebox: {
    uuid: "e2ad5c54-4114-a870-9641-8ea21279579a",
    xMultiplier: 0.000072,
    yMultiplier: -0.000072,
    xScalarToAdd: 0.460214,
    yScalarToAdd: 0.304687,
  },
  lotus: {
    uuid: "2fe4ed3a-450a-948b-6d6b-e89a78e680a9",
    xMultiplier: 0.000072,
    yMultiplier: -0.000072,
    xScalarToAdd: 0.454789,
    yScalarToAdd: 0.917752,
  },
  pearl: {
    uuid: "fd267378-4d1d-484f-ff52-77821ed10dc2",
    xMultiplier: 0.000078,
    yMultiplier: -0.000078,
    xScalarToAdd: 0.480469,
    yScalarToAdd: 0.916016,
  },
  split: {
    uuid: "d960549e-485c-e861-8d71-aa9d1aed12a2",
    xMultiplier: 0.000078,
    yMultiplier: -0.000078,
    xScalarToAdd: 0.842188,
    yScalarToAdd: 0.697578,
  },
  summit: {
    uuid: "756da597-416b-c0f2-f47b-afbdf28670bc",
    xMultiplier: 0.000075,
    yMultiplier: -0.000075,
    xScalarToAdd: 0.047401,
    yScalarToAdd: 0.978891,
  },
  sunset: {
    uuid: "92584fbe-486a-b1b2-9faa-39b0f486b498",
    xMultiplier: 0.000078,
    yMultiplier: -0.000078,
    xScalarToAdd: 0.5,
    yScalarToAdd: 0.515625,
  },
};

export type NormalizedMapSpatialResource = { name: string; assetUrl: string; width: 1; height: 1 };

export function normalizedMapSpatialResource(mapName: string | null): NormalizedMapSpatialResource | null {
  const resource = mapName ? resources[key(mapName)] : null;
  return mapName && resource
    ? { name: mapName, assetUrl: `${mediaBase}/maps/${resource.uuid}/displayicon.png`, width: 1, height: 1 }
    : null;
}

export function normalizeMapSpatialPosition(
  mapName: string | null,
  position: { x: number; y: number } | null,
): { x: number; y: number } | null {
  const resource = mapName ? resources[key(mapName)] : null;
  if (!resource || !position) return null;
  const x = position.y * resource.xMultiplier + resource.xScalarToAdd;
  const y = position.x * resource.yMultiplier + resource.yScalarToAdd;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function key(value: string): string {
  return value.trim().toLowerCase();
}

export function mapTransformFingerprintInput(): string {
  return JSON.stringify(resources);
}
