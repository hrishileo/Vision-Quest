/** Chicago Mag Mile excerpt: N Michigan Avenue × Chicago Avenue (800 N).
 *  Facts used: six-lane two-way Michigan (Wikipedia / Mag Mile);
 *  lighted two-way intersection with NB + WB turning pockets;
 *  NW Water Tower, NE Pumping Station, SW Peninsula, SE Walgreens;
 *  Pearson ~60 m north, Superior ~137 m south (800 numbers/mile).
 *  +X east, +Z south, +Y up. Origin = intersection center. 1 unit = 1 m.
 */

export const MAG_MILE = {
  name: "Magnificent Mile",
  loc: "Michigan Ave & Chicago Ave",
  city: "Chicago, IL",
  lat: 41.8969,
  lon: -87.6244,
} as const;

export const SPAN = 78;
export const LANE_W = 3.5;
export const STOP = 12;
export const INTER_HALF_Z = 9.2;
export const INTER_HALF_X = 11.4;
export const MICH_CURB = 11.2;
export const CHI_CURB = 8.6;
export const BLDG_SETBACK = 18.5;
export const CAR_L = 4.4;
export const CAR_W = 1.8;
/** Curb-side parking strip, between travel lanes and lots. */
export const PARK_X = 12.8;
export const PARK_Z = 10.2;

/** Lane center X on Michigan (NB +X / east of center, SB −X). */
export const MICH_NB = [2.0, 5.5, 9.0] as const;
export const MICH_SB = [-2.0, -5.5, -9.0] as const;
/** Lane center Z on Chicago Ave. +Z is south; EB uses +Z offset. */
export const CHI_EB = [2.4, 5.8] as const;
export const CHI_WB = [-2.4, -5.8] as const;

export type Approach = "NS" | "EW";

export type LaneDef = {
  id: string;
  road: "mich" | "chi";
  approach: Approach;
  /** Constant axis value (x for Michigan, z for Chicago). */
  offset: number;
  /** World coordinate of s = 0. */
  s0: number;
  /** +1 if s increases with +axis world, −1 otherwise. */
  sign: 1 | -1;
  axis: "x" | "z";
  length: number;
  heading: number;
  stopS: number;
  inner: boolean;
};

function michLane(id: string, x: number, nb: boolean, inner: boolean): LaneDef {
  const length = SPAN * 2;
  return {
    id,
    road: "mich",
    approach: "NS",
    offset: x,
    s0: nb ? SPAN : -SPAN,
    sign: nb ? -1 : 1,
    axis: "z",
    length,
    heading: nb ? Math.PI : 0,
    stopS: SPAN - STOP,
    inner,
  };
}

function chiLane(id: string, z: number, eb: boolean, inner: boolean): LaneDef {
  const length = SPAN * 2;
  return {
    id,
    road: "chi",
    approach: "EW",
    offset: z,
    s0: eb ? -SPAN : SPAN,
    sign: eb ? 1 : -1,
    axis: "x",
    length,
    heading: eb ? Math.PI / 2 : -Math.PI / 2,
    stopS: SPAN - STOP,
    inner,
  };
}

export const LANES: LaneDef[] = [
  michLane("mich-nb-0", MICH_NB[0], true, true),
  michLane("mich-nb-1", MICH_NB[1], true, false),
  michLane("mich-nb-2", MICH_NB[2], true, false),
  michLane("mich-sb-0", MICH_SB[0], false, true),
  michLane("mich-sb-1", MICH_SB[1], false, false),
  michLane("mich-sb-2", MICH_SB[2], false, false),
  chiLane("chi-eb-0", CHI_EB[0], true, true),
  chiLane("chi-eb-1", CHI_EB[1], true, false),
  chiLane("chi-wb-0", CHI_WB[0], false, true),
  chiLane("chi-wb-1", CHI_WB[1], false, false),
];

export const LANE_BY_ID: Record<string, LaneDef> = Object.fromEntries(
  LANES.map((l) => [l.id, l]),
);

export function lanePose(lane: LaneDef, s: number): { x: number; z: number; yaw: number } {
  const t = ((s % lane.length) + lane.length) % lane.length;
  if (lane.axis === "z") {
    return { x: lane.offset, z: lane.s0 + lane.sign * t, yaw: lane.heading };
  }
  return { x: lane.s0 + lane.sign * t, z: lane.offset, yaw: lane.heading };
}

export function wrapS(s: number, length: number): number {
  return ((s % length) + length) % length;
}

export function inIntersection(x: number, z: number): boolean {
  return Math.abs(x) < INTER_HALF_X && Math.abs(z) < INTER_HALF_Z;
}

export type BuildingFoot = {
  x: number;
  z: number;
  sx: number;
  sz: number;
  h: number;
  name: string;
  tone: number;
  kind: "tower" | "castle" | "block" | "retail" | "glass";
};

/** Quadrant lots — AABB never overlaps Michigan |x|<11.2 or Chicago |z|<8.6. */
export const BUILDINGS: BuildingFoot[] = [
  { x: -26, z: -26, sx: 14, sz: 14, h: 28, name: "Chicago Water Tower", tone: 0xb7ae9c, kind: "castle" },
  { x: -32, z: -54, sx: 22, sz: 18, h: 42, name: "900 N Michigan", tone: 0x4a4540, kind: "block" },
  { x: -28, z: -72, sx: 18, sz: 12, h: 32, name: "Pearson west", tone: 0x3c4038, kind: "block" },
  { x: -44, z: -22, sx: 16, sz: 16, h: 38, name: "River North loft", tone: 0x4a423c, kind: "block" },
  { x: 28, z: -26, sx: 16, sz: 14, h: 16, name: "Chicago Ave Pumping Station", tone: 0xa89f8c, kind: "block" },
  { x: 38, z: -52, sx: 28, sz: 20, h: 78, name: "Water Tower Place", tone: 0x3a424c, kind: "tower" },
  { x: 28, z: -70, sx: 18, sz: 12, h: 24, name: "Pearson east", tone: 0x585048, kind: "retail" },
  { x: 46, z: -22, sx: 16, sz: 16, h: 48, name: "Streeterville tower", tone: 0x2a3038, kind: "glass" },
  { x: -34, z: 34, sx: 26, sz: 20, h: 64, name: "The Peninsula Chicago", tone: 0x2c343c, kind: "glass" },
  { x: -36, z: 58, sx: 20, sz: 14, h: 22, name: "Saks Men", tone: 0x5c5852, kind: "retail" },
  { x: -30, z: 72, sx: 20, sz: 12, h: 30, name: "Superior west", tone: 0x454038, kind: "block" },
  { x: -48, z: 16, sx: 14, sz: 12, h: 20, name: "SW walk-up", tone: 0x4c4844, kind: "retail" },
  { x: 30, z: 28, sx: 20, sz: 16, h: 14, name: "Walgreens", tone: 0x6e6256, kind: "retail" },
  { x: 34, z: 52, sx: 22, sz: 18, h: 36, name: "Chicago Place", tone: 0x3e4448, kind: "block" },
  { x: 32, z: 70, sx: 24, sz: 14, h: 44, name: "Neiman block", tone: 0x34383e, kind: "glass" },
  { x: 48, z: 16, sx: 14, sz: 12, h: 26, name: "SE walk-up", tone: 0x5a5248, kind: "retail" },
];

export function buildingAabb(b: BuildingFoot): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const hx = b.sx * 0.5;
  const hz = b.sz * 0.5;
  return { minX: b.x - hx, maxX: b.x + hx, minZ: b.z - hz, maxZ: b.z + hz };
}

export function overlapsRoad(b: BuildingFoot): boolean {
  const a = buildingAabb(b);
  const onMich = a.minX < MICH_CURB && a.maxX > -MICH_CURB;
  const onChi = a.minZ < CHI_CURB && a.maxZ > -CHI_CURB;
  return onMich || onChi;
}

export function carHitsBuilding(x: number, z: number, yaw: number): boolean {
  const hx = CAR_W * 0.5;
  const hz = CAR_L * 0.5;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = hx * c + hz * s;
  const ez = hx * s + hz * c;
  for (const b of BUILDINGS) {
    const a = buildingAabb(b);
    if (x - ex < a.maxX && x + ex > a.minX && z - ez < a.maxZ && z + ez > a.minZ) {
      return true;
    }
  }
  return false;
}
