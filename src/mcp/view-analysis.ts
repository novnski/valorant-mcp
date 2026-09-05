import { normalizeMapSpatialPosition } from "../domain/map-spatial-resources";
import type { MatchDetail, MatchKillEvent, MatchPlayerDetail, MatchPlayerLocation } from "../domain/types";
import { nearestMapCallout, type NearestCallout } from "./game-knowledge";
import type { PlayerRef } from "./round-intelligence";

export const assumedHorizontalFovDegrees = 103;
const halfFovRadians = ((assumedHorizontalFovDegrees / 2) * Math.PI) / 180;

export type FacingRelation = {
  observer: PlayerRef;
  observerCallout: NearestCallout | null;
  target: PlayerRef;
  targetCallout: NearestCallout | null;
  distanceMeters: number;
  viewRadians: number | null;
  bearingRadians: number;
  angleDeltaDegrees: number | null;
  withinAssumedFov: boolean | null;
  alignment: "direct" | "inside-cone" | "looking-away" | "unknown";
  mapFacingRadians: number | null;
};

export type AttentionSnapshot = {
  model: "geometric-attention-v1";
  assumedHorizontalFovDegrees: number;
  killerToVictim: FacingRelation | null;
  victimToKiller: FacingRelation | null;
  victimTeamSupport: FacingRelation[];
  recordedVictimTeammates: number;
  teammatesWithKillerInsideCone: number;
  potentialCrossfire: boolean | null;
  geometricSummary: string;
  limitations: string[];
};

export function buildAttentionSnapshot(
  detail: MatchDetail,
  kill: MatchKillEvent,
  killer: PlayerRef,
  victim: PlayerRef,
  alivePlayerKeys?: ReadonlySet<string>,
): AttentionSnapshot {
  const roster = detail.teams.flatMap((team) => team.players);
  const killerLocation = findLocation(kill.playerLocations, killer);
  const victimLocation = findLocation(kill.playerLocations, victim);
  const killerPosition = killerLocation?.location ?? null;
  const victimPosition = kill.victimLocation ?? victimLocation?.location ?? null;
  const killerToVictim = relation(detail, killer, killerLocation, victim, victimPosition);
  const victimToKiller = relation(detail, victim, victimLocation, killer, killerPosition);

  const victimTeam = victim.teamId;
  const teammates = kill.playerLocations.filter(
    (location) =>
      victimTeam &&
      sameTeam(location.teamId, victimTeam) &&
      !sameIdentity(location, victim) &&
      (!alivePlayerKeys || alivePlayerKeys.has(location.puuid ?? `${location.gameName}#${location.tagLine ?? ""}`)),
  );
  const support = teammates
    .flatMap((location) => {
      const player = roster.find((candidate) => sameIdentity(candidate, location));
      if (!player || !killerPosition) return [];
      return [relation(detail, playerRef(player), location, killer, killerPosition)].filter(
        (value): value is FacingRelation => value !== null,
      );
    })
    .sort((left, right) =>
      left.angleDeltaDegrees === null
        ? 1
        : right.angleDeltaDegrees === null
          ? -1
          : left.angleDeltaDegrees - right.angleDeltaDegrees,
    );
  const covering = support.filter((candidate) => candidate.withinAssumedFov === true);
  const potentialCrossfire =
    victimToKiller?.withinAssumedFov === null || !support.length
      ? null
      : victimToKiller?.withinAssumedFov === true && covering.length > 0;
  const geometricSummary =
    support.length === 0
      ? "No victim-team teammate with a usable position and facing angle was recorded in this snapshot."
      : covering.length === 0
        ? `No recorded victim-team teammate had the killer inside the assumed ${assumedHorizontalFovDegrees}° horizontal view cone at the kill snapshot.`
        : `${covering.length} recorded victim-team teammate${covering.length === 1 ? " had" : "s had"} the killer inside the assumed ${assumedHorizontalFovDegrees}° horizontal view cone.`;

  return {
    model: "geometric-attention-v1",
    assumedHorizontalFovDegrees,
    killerToVictim,
    victimToKiller,
    victimTeamSupport: support,
    recordedVictimTeammates: support.length,
    teammatesWithKillerInsideCone: covering.length,
    potentialCrossfire,
    geometricSummary,
    limitations: [
      "The cone test is geometric only. It does not know walls, elevation occlusion, smokes, flashes, nearsight, recoil, scoped FOV, or whether the player had visual contact.",
      "A player inside the cone is potential coverage, not proof they saw, could shoot, or were responsible for a trade.",
      "A player outside the cone supports that they were oriented elsewhere at that instant, but not why.",
    ],
  };
}

export function mapFacingRadians(
  mapName: string | null,
  location: { x: number; y: number } | null,
  viewRadians: number | null,
): number | null {
  if (!location || viewRadians === null) return null;
  const start = normalizeMapSpatialPosition(mapName, location);
  const end = normalizeMapSpatialPosition(mapName, {
    x: location.x + Math.cos(viewRadians) * 1_000,
    y: location.y + Math.sin(viewRadians) * 1_000,
  });
  return start && end ? Math.atan2(end.y - start.y, end.x - start.x) : null;
}

function relation(
  detail: MatchDetail,
  observer: PlayerRef,
  observerLocation: MatchPlayerLocation | null,
  target: PlayerRef,
  targetPosition: { x: number; y: number } | null,
): FacingRelation | null {
  if (!observerLocation || !targetPosition) return null;
  const dx = targetPosition.x - observerLocation.location.x;
  const dy = targetPosition.y - observerLocation.location.y;
  const bearingRadians = Math.atan2(dy, dx);
  const viewRadians = observerLocation.viewRadians;
  const delta = viewRadians === null ? null : angularDelta(viewRadians, bearingRadians);
  const within = delta === null ? null : delta <= halfFovRadians;
  return {
    observer,
    observerCallout: nearestMapCallout(detail.mapName, observerLocation.location),
    target,
    targetCallout: nearestMapCallout(detail.mapName, targetPosition),
    distanceMeters: Math.hypot(dx, dy) / 100,
    viewRadians,
    bearingRadians,
    angleDeltaDegrees: delta === null ? null : (delta * 180) / Math.PI,
    withinAssumedFov: within,
    alignment:
      delta === null ? "unknown" : delta <= (12 * Math.PI) / 180 ? "direct" : within ? "inside-cone" : "looking-away",
    mapFacingRadians: mapFacingRadians(detail.mapName, observerLocation.location, viewRadians),
  };
}

function angularDelta(left: number, right: number): number {
  const raw = Math.abs(((((left - right + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI);
  return Math.min(raw, Math.PI * 2 - raw);
}

function findLocation(locations: MatchPlayerLocation[], player: PlayerRef): MatchPlayerLocation | null {
  return locations.find((location) => sameIdentity(location, player)) ?? null;
}

function playerRef(player: MatchPlayerDetail): PlayerRef {
  return {
    puuid: player.puuid,
    riotId: player.tagLine ? `${player.gameName}#${player.tagLine}` : player.gameName,
    gameName: player.gameName,
    tagLine: player.tagLine,
    teamId: player.teamId,
    agentName: player.agentName,
  };
}

function sameIdentity(
  left: { puuid: string | null; gameName: string; tagLine: string | null },
  right: { puuid: string | null; gameName: string; tagLine: string | null },
): boolean {
  if (left.puuid && right.puuid) return left.puuid === right.puuid;
  return (
    left.gameName.toLocaleLowerCase() === right.gameName.toLocaleLowerCase() &&
    (left.tagLine ?? "").toLocaleLowerCase() === (right.tagLine ?? "").toLocaleLowerCase()
  );
}

function sameTeam(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase());
}
