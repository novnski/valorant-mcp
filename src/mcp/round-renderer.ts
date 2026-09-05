import { assetRoot } from "./paths";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { TacticalMarker, TacticalSnapshot } from "./round-intelligence";

type CanvasImage = Awaited<ReturnType<typeof loadImage>>;
type CanvasContext = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;
type CatalogEntry = { uuid: string; icon: string };
type AssetCatalog = {
  maps: Record<string, CatalogEntry>;
  agents: Record<string, CatalogEntry>;
  weapons: Record<string, CatalogEntry>;
};

export type TacticalRenderResult = {
  buffer: Buffer;
  filename: string;
  map: string | null;
  roundNumber: number;
  eventId: string;
  eventIndex: number;
  eventCount: number;
  previousEventId: string | null;
  nextEventId: string | null;
  renderedSamples: number;
  markers: TacticalMarker[];
  summary: string;
  limitations: string[];
};

const size = 1024;
const inset = 24;
const mapDrawSize = size - inset * 2;
const markerRadius = 18;
// Mirrors the former website marker: the portrait-width base is almost fully
// hidden beneath the portrait, while only a short point projects beyond its
// outline. Drawing it first makes the triangle and ring read as one marker.
// The 103-degree attention cone remains analysis-only.
const pointerBaseDistance = 4;
const pointerTipDistance = markerRadius + 14;
const pointerHalfWidth = markerRadius;

const ink = {
  void: "#05070b",
  panel: "#090d13",
  red: "#ff655f",
  blue: "#55b8ff",
  neutral: "#a6b1c3",
  border: "rgba(174,194,222,0.18)",
};

let catalogPromise: Promise<AssetCatalog> | null = null;

export async function renderTacticalSnapshotImage(snapshot: TacticalSnapshot): Promise<TacticalRenderResult> {
  const catalog = await loadCatalog();
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  drawBase(ctx);
  await drawMap(ctx, snapshot.replay.map, catalog);
  for (const marker of snapshot.markers) drawFacingTriangle(ctx, marker);
  for (const marker of snapshot.markers) await drawMarker(ctx, marker, catalog);
  const encoded = await canvas.encode("png");
  return {
    buffer: Buffer.from(encoded),
    filename: `valorant-${safeName(snapshot.replay.map ?? "match")}-round-${snapshot.replay.roundNumber}-${safeName(snapshot.replay.eventId)}.png`,
    map: snapshot.replay.map,
    roundNumber: snapshot.replay.roundNumber,
    eventId: snapshot.replay.eventId,
    eventIndex: snapshot.replay.eventIndex,
    eventCount: snapshot.replay.eventCount,
    previousEventId: snapshot.replay.previousEventId,
    nextEventId: snapshot.replay.nextEventId,
    renderedSamples: snapshot.markers.length,
    markers: snapshot.markers,
    summary: snapshot.replay.summary,
    limitations: [...snapshot.warnings, ...snapshot.replay.limitations],
  };
}

function drawBase(ctx: CanvasContext): void {
  ctx.fillStyle = ink.void;
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(size * 0.35, size * 0.25, 0, size * 0.35, size * 0.25, size);
  glow.addColorStop(0, "rgba(0,224,184,0.035)");
  glow.addColorStop(1, "rgba(5,7,11,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
}

async function drawMap(ctx: CanvasContext, mapName: string | null, catalog: AssetCatalog): Promise<void> {
  ctx.fillStyle = ink.panel;
  ctx.fillRect(inset, inset, mapDrawSize, mapDrawSize);
  ctx.strokeStyle = ink.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, mapDrawSize, mapDrawSize);
  const entry = mapName ? catalog.maps[mapName.toLowerCase()] : null;
  const image = entry ? await loadOptionalImage(join(assetRoot, entry.icon)) : null;
  if (!image) return;
  ctx.save();
  ctx.globalAlpha = 0.92;
  drawImageContain(ctx, image, inset + 16, inset + 16, mapDrawSize - 32, mapDrawSize - 32);
  ctx.restore();
}

function drawFacingTriangle(ctx: CanvasContext, marker: TacticalMarker): void {
  if (marker.mapFacingRadians === null) return;
  const point = mapPoint(marker);
  const tone = markerTone(marker);
  const triangle = facingTriangleVertices(point, marker.mapFacingRadians);
  ctx.save();
  ctx.fillStyle = tone;
  ctx.strokeStyle = ink.void;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.shadowColor = ink.void;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(triangle.tip.x, triangle.tip.y);
  ctx.lineTo(triangle.baseLeft.x, triangle.baseLeft.y);
  ctx.lineTo(triangle.baseRight.x, triangle.baseRight.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function facingTriangleVertices(
  center: { x: number; y: number },
  angle: number,
): {
  tip: { x: number; y: number };
  baseLeft: { x: number; y: number };
  baseRight: { x: number; y: number };
} {
  const forward = { x: Math.cos(angle), y: Math.sin(angle) };
  const side = { x: -forward.y, y: forward.x };
  const baseCenter = {
    x: center.x + forward.x * pointerBaseDistance,
    y: center.y + forward.y * pointerBaseDistance,
  };
  return {
    tip: {
      x: center.x + forward.x * pointerTipDistance,
      y: center.y + forward.y * pointerTipDistance,
    },
    baseLeft: {
      x: baseCenter.x + side.x * pointerHalfWidth,
      y: baseCenter.y + side.y * pointerHalfWidth,
    },
    baseRight: {
      x: baseCenter.x - side.x * pointerHalfWidth,
      y: baseCenter.y - side.y * pointerHalfWidth,
    },
  };
}

async function drawMarker(ctx: CanvasContext, marker: TacticalMarker, catalog: AssetCatalog): Promise<void> {
  const point = mapPoint(marker);
  const tone = markerTone(marker);
  const entry = marker.player.agentName ? catalog.agents[marker.player.agentName.toLowerCase()] : null;
  const image = entry ? await loadOptionalImage(join(assetRoot, entry.icon)) : null;

  ctx.save();
  ctx.shadowColor = withAlpha(tone, 0.7);
  ctx.shadowBlur = 10;
  ctx.fillStyle = ink.void;
  ctx.beginPath();
  ctx.arc(point.x, point.y, markerRadius + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, markerRadius, 0, Math.PI * 2);
  ctx.clip();
  if (image)
    drawImageCover(ctx, image, point.x - markerRadius, point.y - markerRadius, markerRadius * 2, markerRadius * 2);
  else {
    ctx.fillStyle = ink.panel;
    ctx.fillRect(point.x - markerRadius, point.y - markerRadius, markerRadius * 2, markerRadius * 2);
  }
  ctx.restore();
  ctx.strokeStyle = tone;
  ctx.lineWidth = marker.role === "killer" || marker.role === "victim" ? 4 : 2.5;
  ctx.beginPath();
  ctx.arc(point.x, point.y, markerRadius + 1, 0, Math.PI * 2);
  ctx.stroke();

  if (marker.role === "killer") {
    ctx.strokeStyle = tone;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, markerRadius + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (marker.role === "victim") drawVictimX(ctx, point.x, point.y);
}

function drawVictimX(ctx: CanvasContext, x: number, y: number): void {
  const segments = victimXSegments({ x, y });
  ctx.save();
  ctx.lineCap = "round";
  for (const [strokeStyle, lineWidth] of [
    [ink.void, 8],
    [ink.red, 5],
  ] as const) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    for (const segment of segments) {
      ctx.beginPath();
      ctx.moveTo(segment.from.x, segment.from.y);
      ctx.lineTo(segment.to.x, segment.to.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function markerTone(marker: TacticalMarker): string {
  return teamMarkerColor(marker.player.teamId);
}

export function teamMarkerColor(teamId: string | null): string {
  const normalized = teamId?.trim().toLocaleLowerCase();
  if (normalized === "red") return ink.red;
  if (normalized === "blue") return ink.blue;
  return ink.neutral;
}

export function victimXSegments(center: { x: number; y: number }): Array<{
  from: { x: number; y: number };
  to: { x: number; y: number };
}> {
  const arm = markerRadius * 0.72;
  return [
    { from: { x: center.x - arm, y: center.y - arm }, to: { x: center.x + arm, y: center.y + arm } },
    { from: { x: center.x + arm, y: center.y - arm }, to: { x: center.x - arm, y: center.y + arm } },
  ];
}

function mapPoint(marker: TacticalMarker): { x: number; y: number } {
  const margin = 18;
  return {
    x: inset + margin + marker.x * (mapDrawSize - margin * 2),
    y: inset + margin + marker.y * (mapDrawSize - margin * 2),
  };
}

async function loadCatalog(): Promise<AssetCatalog> {
  catalogPromise ??= readFile(join(assetRoot, "catalog.json"), "utf8").then(
    (value) => JSON.parse(value) as AssetCatalog,
  );
  return catalogPromise;
}

async function loadOptionalImage(path: string): Promise<CanvasImage | null> {
  try {
    return await loadImage(path);
  } catch {
    return null;
  }
}

function drawImageContain(ctx: CanvasContext, image: CanvasImage, x: number, y: number, w: number, h: number): void {
  const scale = Math.min(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawImageCover(ctx: CanvasContext, image: CanvasImage, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function safeName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "valorant"
  );
}
