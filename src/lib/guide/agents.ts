import {
  CHI_CURB,
  CURB_PARKING,
  CAR_L,
  CAR_W,
  LAMP_XS,
  LAMP_ZS,
  MICH_CURB,
  PARK_X,
  SIDEWALK_W,
  SPAN,
  XWALK_X,
  XWALK_Z,
  inIntersection,
  baseLaneIdAt,
  laneById,
  lanePose,
  pointInBuilding,
  wrapS,
  zoneAt,
  type Approach,
} from "./city.ts";

/**
 * Vulnerable road users: pedestrians on sidewalks and crosswalks, and
 * bicycles, scooters, and motorbikes along the curb edge of the curb lanes.
 * They run on their own RNG and never feed back into car following, so the
 * car fleet for a seed is the same with or without them.
 */
export type AgentType = "person" | "bicycle" | "scooter" | "motorbike";
export type AgentClass = "person" | "bicycle" | "motor";

export const AGENT_CLASS: Record<AgentType, AgentClass> = {
  person: "person",
  bicycle: "bicycle",
  scooter: "motor",
  motorbike: "motor",
};

export const AGENT_TRACK_PREFIX: Record<AgentClass, string> = {
  person: "ped",
  bicycle: "bike",
  motor: "motor",
};

/** Ground footprint and height of the rendered rig, rider included. Metres. */
export const AGENT_SIZE: Record<AgentType, { length: number; width: number; height: number }> = {
  person: { length: 0.42, width: 0.5, height: 1.72 },
  bicycle: { length: 1.8, width: 0.6, height: 1.72 },
  scooter: { length: 1.15, width: 0.5, height: 1.78 },
  motorbike: { length: 2.1, width: 0.8, height: 1.5 },
};

/**
 * A parked bicycle with nobody on it: a rack cluster at the curb, one out in
 * the open on the sidewalk, one against a building front (in its shade when
 * the clip casts shadows), one tucked behind a parked car, or one leaned on a lamp
 * pole. It never moves and never carries a rider box.
 */
export type ParkKind = "rack" | "open" | "facade" | "car" | "pole";
export const PARK_KINDS: readonly ParkKind[] = ["rack", "open", "facade", "car", "pole"];

/** Bike alone, no rider: saddle and bars top out near 1 m. Mirrors the parked rig in build-world.ts. */
export const PARKED_BIKE_SIZE = { length: 1.75, width: 0.6, height: 1.05 } as const;

/** Bikes in one rack cluster, side by side. Frame 7 of the VisDrone eval has four. */
export const RACK_SIZE = 4;

type Pt = { x: number; z: number };

export type SimAgent = {
  id: number;
  type: AgentType;
  x: number;
  z: number;
  /** Heading. 0 faces +Z, the same convention as `SimCar.yaw`. */
  yaw: number;
  /** Current ground speed, m/s. */
  v: number;
  /** Cruise speed, m/s. */
  v0: number;
  /** Riders: the curb lane they follow. Null for pedestrians. */
  laneId: string | null;
  s: number;
  /** Pedestrians: polyline to walk. Closed loops wrap; open paths turn around. */
  path: Pt[] | null;
  closed: boolean;
  /** Approach whose green lets a pedestrian start segment i. Null is plain sidewalk. */
  crossings: (Approach | null)[];
  seg: number;
  u: number;
  dir: 1 | -1;
  /** Set on parked, riderless bicycles. Parked agents never move. */
  parked?: ParkKind;
};

export type AgentSignals = {
  lit: (approach: Approach) => "g" | "y" | "r";
  /** Seconds of green left for this approach. 0 when it is not green. */
  greenLeft: (approach: Approach) => number;
  /** True while a vehicle body sits on the strip from a to b. Optional. */
  blocked?: (
    a: { x: number; z: number },
    b: { x: number; z: number },
    halfWidth: number,
  ) => boolean;
};

/** Curb lanes and how far a rider sits from the lane centerline toward the curb. */
const CURB_LANES = [
  { id: "mich-nb-2", lateral: 1.3 },
  { id: "mich-sb-2", lateral: -1.3 },
  { id: "chi-eb-1", lateral: 1.3 },
  { id: "chi-wb-1", lateral: -1.3 },
] as const;

const RIDER_GAP = 2.4;

function curbLateral(laneId: string): number {
  return CURB_LANES.find((lane) => lane.id === laneId)?.lateral ?? 0;
}

export function riderPose(laneId: string, s: number): { x: number; z: number; yaw: number } {
  const lane = laneById(laneId);
  if (!lane) throw new Error(`unknown lane ${laneId}`);
  const p = lanePose(lane, s);
  const lat = curbLateral(laneId);
  return lane.axis === "z"
    ? { x: p.x + lat, z: p.z, yaw: p.yaw }
    : { x: p.x, z: p.z + lat, yaw: p.yaw };
}

function segLength(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function segEnds(agent: SimAgent): { a: Pt; b: Pt } {
  const path = agent.path!;
  const a = path[agent.seg]!;
  const b = path[(agent.seg + 1) % path.length]!;
  return agent.dir === 1 ? { a, b } : { a: b, b: a };
}

function poseWalker(agent: SimAgent) {
  const { a, b } = segEnds(agent);
  const len = segLength(a, b);
  const t = len > 0 ? Math.min(1, agent.u / len) : 0;
  agent.x = a.x + (b.x - a.x) * t;
  agent.z = a.z + (b.z - a.z) * t;
  if (len > 0) agent.yaw = Math.atan2(b.x - a.x, b.z - a.z);
}

function crossingOf(agent: SimAgent): Approach | null {
  return agent.crossings[agent.seg] ?? null;
}

function stepWalker(agent: SimAgent, dt: number, signals: AgentSignals) {
  const path = agent.path!;
  const n = path.length;
  const segCount = agent.closed ? n : n - 1;
  const { a, b } = segEnds(agent);
  const len = segLength(a, b);
  if (agent.u <= 1e-6) {
    const approach = crossingOf(agent);
    if (approach) {
      const need = len / Math.max(0.3, agent.v0) + 1;
      const red = signals.lit(approach) !== "g" || signals.greenLeft(approach) < need;
      if (red || signals.blocked?.(a, b, 1.2)) {
        agent.v = 0;
        poseWalker(agent);
        return;
      }
    }
  }
  agent.v = agent.v0;
  agent.u += agent.v * dt;
  if (agent.u >= len) {
    const extra = agent.u - len;
    if (agent.closed) {
      agent.seg = (agent.seg + 1) % segCount;
      agent.u = 0;
    } else {
      const next = agent.seg + agent.dir;
      if (agent.dir === 1 && agent.seg >= segCount - 1) {
        agent.dir = -1;
        agent.u = 0;
      } else if (agent.dir === -1 && agent.seg <= 0) {
        agent.dir = 1;
        agent.u = 0;
      } else {
        agent.seg = next;
        agent.u = 0;
      }
    }
    // Do not carry overshoot into a crossing; the walker waits at the curb.
    if (!crossingOf(agent)) agent.u = Math.min(extra, 0.5);
  }
  poseWalker(agent);
}

function stepRiders(riders: SimAgent[], dt: number, signals: AgentSignals) {
  const byLane = new Map<string, SimAgent[]>();
  for (const r of riders) {
    const list = byLane.get(r.laneId!) ?? [];
    list.push(r);
    byLane.set(r.laneId!, list);
  }
  for (const [laneId, list] of byLane) {
    const lane = laneById(laneId)!;
    list.sort((p, q) => p.s - q.s);
    const lit = signals.lit(lane.approach);
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      const len = AGENT_SIZE[r.type].length;
      let v = r.v0;
      const distStop = wrapS(lane.stopS - r.s, lane.length);
      const pastStop = distStop > lane.length * 0.72;
      if (!pastStop && lit !== "g" && distStop < 14 && distStop > 0.2) {
        const hold = distStop - len * 0.5 - 0.35;
        v = hold <= 0.05 ? 0 : Math.min(v, hold / Math.max(dt, 1e-3), Math.sqrt(2 * 1.8 * hold));
      }
      if (list.length > 1) {
        const leader = list[(i + 1) % list.length]!;
        let ds = leader.s - r.s;
        if (ds <= 0.01) ds += lane.length;
        const gap = ds - (len + AGENT_SIZE[leader.type].length) * 0.5;
        if (gap < RIDER_GAP + r.v * 0.8)
          v = Math.min(v, leader.v, Math.max(0, gap - RIDER_GAP) / Math.max(dt, 1e-3));
      }
      r.v = Math.max(0, v);
    }
    for (const r of list) {
      r.s = wrapS(r.s + r.v * dt, lane.length);
      const p = riderPose(laneId, r.s);
      r.x = p.x;
      r.z = p.z;
      r.yaw = p.yaw;
    }
  }
}

export function stepAgents(agents: SimAgent[], dt: number, signals: AgentSignals) {
  const riders: SimAgent[] = [];
  for (const agent of agents) {
    if (agent.parked) continue;
    if (agent.laneId) riders.push(agent);
    else stepWalker(agent, dt, signals);
  }
  stepRiders(riders, dt, signals);
}

/** Free run of a sidewalk from the corner outward, stopping before the first building. */
function freeSpan(fixed: number, axis: "x" | "z", sign: 1 | -1, start: number): [number, number] {
  let end = start;
  for (let t = start; t <= SPAN - 4; t += 0.5) {
    const x = axis === "z" ? fixed : sign * t;
    const z = axis === "z" ? sign * t : fixed;
    if (pointInBuilding(x, z, 0.8)) break;
    end = t;
  }
  return [start, end];
}

function crosswalkLoop(): { path: Pt[]; crossings: (Approach | null)[] } {
  // NE → SE crosses Chicago (walks with Michigan's NS green), SE → SW crosses
  // Michigan (EW green), SW → NW crosses Chicago, NW → NE crosses Michigan.
  return {
    path: [
      { x: XWALK_X, z: -XWALK_Z },
      { x: XWALK_X, z: XWALK_Z },
      { x: -XWALK_X, z: XWALK_Z },
      { x: -XWALK_X, z: -XWALK_Z },
    ],
    crossings: ["NS", "EW", "NS", "EW"],
  };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const AGENT_COUNTS = {
  crossers: 8,
  strollers: 14,
  bicycle: 5,
  scooter: 3,
  motorbike: 2,
  /** Parked riderless bicycle spots. A rack spot holds RACK_SIZE bikes. Off by default. */
  parked: 0,
} as const;

export type AgentCounts = { [K in keyof typeof AGENT_COUNTS]: number };

/**
 * Deterministic VRU spawn. `density` scales counts the same way as the car
 * fleet. `counts` replaces the base counts per group (a sequence that wants a
 * crosswalk crowd or a bike-heavy curb lane); density still scales them.
 */
export function spawnAgents(
  seed: number,
  density: number,
  counts?: Partial<AgentCounts>,
  park?: ParkWindow,
): SimAgent[] {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const scale = Number.isFinite(density) ? Math.min(2, Math.max(0, density)) : 1;
  const base: AgentCounts = { ...AGENT_COUNTS, ...counts };
  const count = (n: number) =>
    scale <= 0 || n <= 0 ? 0 : Math.max(1, Math.round(n * scale));
  const agents: SimAgent[] = [];
  let id = 0;
  const walker = (
    path: Pt[],
    closed: boolean,
    crossings: (Approach | null)[],
    seg: number,
    u: number,
    dir: 1 | -1,
  ) => {
    const agent: SimAgent = {
      id: id++,
      type: "person",
      x: 0,
      z: 0,
      yaw: 0,
      v: 0,
      v0: 1.1 + rng() * 0.5,
      laneId: null,
      s: 0,
      path,
      closed,
      crossings,
      seg,
      u,
      dir,
    };
    poseWalker(agent);
    agents.push(agent);
  };

  const loop = crosswalkLoop();
  const sides = loop.path.length;
  for (let i = 0; i < count(base.crossers); i++) {
    const seg = Math.floor(rng() * sides);
    // Start on the corner side so nobody spawns mid-crossing against a red.
    walker(loop.path, true, loop.crossings, seg, 0, 1);
  }

  const walks: { fixed: number; axis: "x" | "z"; sign: 1 | -1; start: number }[] = [];
  for (const sx of [1, -1] as const) {
    for (const sz of [1, -1] as const) {
      // Michigan sidewalk on side sx heading toward sz, and Chicago sidewalk on side sz heading toward sx.
      walks.push({ fixed: sx, axis: "z", sign: sz, start: CHI_CURB + 3 });
      walks.push({ fixed: sz, axis: "x", sign: sx, start: MICH_CURB + 3 });
    }
  }
  for (let i = 0; i < count(base.strollers); i++) {
    const w = walks[Math.floor(rng() * walks.length)]!;
    const curb = w.axis === "z" ? MICH_CURB : CHI_CURB;
    const off = w.fixed * (curb + 2.8 + rng() * (SIDEWALK_W - 4.0));
    const [a, b] = freeSpan(off, w.axis, w.sign, w.start);
    if (b - a < 4) continue;
    const p0 = w.axis === "z" ? { x: off, z: w.sign * a } : { x: w.sign * a, z: off };
    const p1 = w.axis === "z" ? { x: off, z: w.sign * b } : { x: w.sign * b, z: off };
    walker([p0, p1], false, [null], 0, rng() * (b - a), rng() < 0.5 ? 1 : -1);
  }

  const riders: { type: AgentType; v0: () => number; n: number }[] = [
    { type: "bicycle", v0: () => 4 + rng() * 1.6, n: count(base.bicycle) },
    { type: "scooter", v0: () => 3.4 + rng() * 1.4, n: count(base.scooter) },
    { type: "motorbike", v0: () => 6.5 + rng() * 2, n: count(base.motorbike) },
  ];
  const placed: { laneId: string; s: number; len: number }[] = [];
  for (const group of riders) {
    for (let i = 0; i < group.n; i++) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const curb = CURB_LANES[Math.floor(rng() * CURB_LANES.length)]!;
        const lane = laneById(curb.id)!;
        const s = rng() * lane.length;
        const len = AGENT_SIZE[group.type].length;
        const pose = riderPose(curb.id, s);
        if (inIntersection(pose.x, pose.z)) continue;
        const clash = placed.some((p) => {
          if (p.laneId !== curb.id) return false;
          let ds = Math.abs(p.s - s);
          ds = Math.min(ds, lane.length - ds);
          return ds < (p.len + len) * 0.5 + RIDER_GAP + 1;
        });
        if (clash) continue;
        placed.push({ laneId: curb.id, s, len });
        const v0 = group.v0();
        agents.push({
          id: id++,
          type: group.type,
          x: pose.x,
          z: pose.z,
          yaw: pose.yaw,
          v: v0,
          v0,
          laneId: curb.id,
          s,
          path: null,
          closed: false,
          crossings: [],
          seg: 0,
          u: 0,
          dir: 1,
        });
        break;
      }
    }
  }

  const spots = count(base.parked);
  if (spots > 0) {
    // Own stream, drawn last, so adding parked bikes never moves a walker or rider.
    const prng = mulberry32((seed ^ 0x2c1b3c6d) >>> 0);
    const stalls = CURB_PARKING.slice(0, Math.round(CURB_PARKING.length * scale)).filter(
      (p) => Math.abs(p.x) === PARK_X,
    );
    for (const bike of parkedBikes(prng, spots, stalls, park)) {
      agents.push({
        id: id++,
        type: "bicycle",
        x: bike.x,
        z: bike.z,
        yaw: bike.yaw,
        v: 0,
        v0: 0,
        laneId: null,
        s: 0,
        path: null,
        closed: false,
        crossings: [],
        seg: 0,
        u: 0,
        dir: 1,
        parked: bike.kind,
      });
    }
  }
  return agents;
}

type ParkedPose = { x: number; z: number; yaw: number; kind: ParkKind };

/**
 * Stretch of Michigan a clip's parked bikes are drawn from: signed z range
 * and, optionally, one sidewalk (+1 east, −1 west). Lets a clip put its bikes
 * in frame and its facade bikes on the side its sun shades.
 */
export type ParkWindow = { z: [number, number]; side?: 1 | -1 };

const PARK_MIN_Z = CHI_CURB + 7.4;
/** |x| probed for a building behind a facade bike: the lot line plus a few metres. */
export const FACADE_PROBE_X = MICH_CURB + SIDEWALK_W + 3.5;
const PARK_MAX_Z = SPAN - 6;

/** Clear of every curb stall's car body (plus `pad`) and, unless `poles` is false, of lamp poles. */
function parkClear(x: number, z: number, pad: number, poles: boolean): boolean {
  for (const c of CURB_PARKING) {
    if (Math.abs(x - c.x) < CAR_W / 2 + pad && Math.abs(z - c.z) < CAR_L / 2 + pad) return false;
  }
  if (!poles) return true;
  for (const lx of LAMP_XS) {
    for (const lz of LAMP_ZS) if (Math.hypot(x - lx, z - lz) < 0.6) return false;
  }
  return true;
}

/**
 * Deterministic parked-bike layout on the two Michigan sidewalks, cycling
 * through PARK_KINDS. Every bike sits on sidewalk, out of buildings, clear of
 * car bodies and poles, and at least 2 m from any other spot.
 */
export function parkedBikes(
  rng: () => number,
  spots: number,
  stalls: readonly { x: number; z: number; yaw: number }[],
  park?: ParkWindow,
): ParkedPose[] {
  const out: ParkedPose[] = [];
  const along = () => (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.3;
  const farFromOthers = (bikes: Pt[]) =>
    bikes.every((b) => out.every((o) => Math.hypot(o.x - b.x, o.z - b.z) >= 2));
  const onWalk = (b: Pt) =>
    Math.abs(b.x) > MICH_CURB + 0.35 &&
    Math.abs(b.x) < MICH_CURB + SIDEWALK_W - 0.3 &&
    Math.abs(b.z) >= PARK_MIN_Z &&
    Math.abs(b.z) <= PARK_MAX_Z &&
    !pointInBuilding(b.x, b.z, 0.4);
  for (let i = 0; i < spots; i++) {
    const kind = PARK_KINDS[i % PARK_KINDS.length]!;
    for (let attempt = 0; attempt < 40; attempt++) {
      const flip = rng() < 0.5 ? 1 : -1;
      const side = park?.side ?? flip;
      const zs = park
        ? park.z[0] + rng() * (park.z[1] - park.z[0])
        : (rng() < 0.5 ? 1 : -1) * (PARK_MIN_Z + rng() * (PARK_MAX_Z - PARK_MIN_Z));
      let bikes: ParkedPose[] = [];
      if (kind === "rack") {
        // Perpendicular to the curb, wheels toward the road, packed so oblique views overlap them.
        const x = side * (MICH_CURB + 0.35 + PARKED_BIKE_SIZE.length / 2);
        let z = zs;
        for (let k = 0; k < RACK_SIZE; k++) {
          bikes.push({ x, z, yaw: side * (Math.PI / 2) + (rng() - 0.5) * 0.16, kind });
          z += 0.55 + rng() * 0.15;
        }
      } else if (kind === "open") {
        bikes = [{ x: side * (MICH_CURB + 2.2 + rng() * 1.4), z: zs, yaw: along(), kind }];
      } else if (kind === "facade") {
        const x = side * (MICH_CURB + SIDEWALK_W - 0.75);
        // Needs a building right behind it to cast the shade.
        if (!pointInBuilding(side * FACADE_PROBE_X, zs)) continue;
        bikes = [{ x, z: zs, yaw: along(), kind }];
      } else if (kind === "car") {
        const near = stalls.filter(
          (p) =>
            (!park?.side || Math.sign(p.x) === park.side) &&
            (!park || (p.z >= park.z[0] - 2 && p.z <= park.z[1] + 2)),
        );
        if (near.length === 0) continue;
        const stall = near[Math.floor(rng() * near.length)]!;
        const sx = Math.sign(stall.x);
        bikes = [
          {
            x: sx * (PARK_X + CAR_W / 2 + 0.6),
            z: stall.z + (rng() - 0.5) * 3.2,
            yaw: along(),
            kind,
          },
        ];
      } else {
        const lx = LAMP_XS[side > 0 ? 0 : 1];
        const lamps = LAMP_ZS.filter((z) => !park || (z >= park.z[0] && z <= park.z[1]));
        if (lamps.length === 0) continue;
        const lz = lamps[Math.floor(rng() * lamps.length)]!;
        bikes = [
          {
            x: lx + side * 0.45,
            z: lz + (rng() < 0.5 ? 1 : -1) * (0.35 + rng() * 0.5),
            yaw: along(),
            kind,
          },
        ];
      }
      const pad = kind === "car" ? 0.15 : 0.35;
      if (!bikes.every(onWalk)) continue;
      if (!bikes.every((b) => parkClear(b.x, b.z, pad, kind !== "pole"))) continue;
      if (!farFromOthers(bikes)) continue;
      out.push(...bikes);
      break;
    }
  }
  return out;
}

/** Riders: every moving bicycle, scooter, and motorbike carries one. Parked bikes do not. */
export function hasRider(agent: Pick<SimAgent, "type" | "parked">): boolean {
  return agent.type !== "person" && !agent.parked;
}

/**
 * Track id of the person riding an agent. Derived from the agent id, so it
 * persists for as long as the rig does, and it never collides with a
 * pedestrian's `ped-<id>`.
 */
export function riderTrackId(agent: Pick<SimAgent, "id">): string {
  return `ped-rider-${agent.id}`;
}

/**
 * Seated or standing rider on each rig, in rig-local metres: feet height,
 * head height, and how far the body sits behind the rig centre. Mirrors
 * `makeAgentRig` in build-world.ts.
 */
export const RIDER_POSE: Record<Exclude<AgentType, "person">, { feet: number; top: number; back: number }> = {
  bicycle: { feet: 0.62, top: 1.72, back: 0.12 },
  scooter: { feet: 0.17, top: 1.78, back: 0.08 },
  motorbike: { feet: 0.8, top: 1.5, back: 0.2 },
};

const RIDER_FOOTPRINT = { length: 0.56, width: 0.46 };

/** Oriented box corners of the rider alone. Empty for pedestrians. */
export function riderCorners(
  agent: Pick<SimAgent, "x" | "z" | "yaw" | "type" | "parked">,
): { x: number; y: number; z: number }[] {
  if (!hasRider(agent) || agent.type === "person") return [];
  const pose = RIDER_POSE[agent.type];
  const fx = Math.sin(agent.yaw);
  const fz = Math.cos(agent.yaw);
  const rx = Math.cos(agent.yaw);
  const rz = -Math.sin(agent.yaw);
  const hl = RIDER_FOOTPRINT.length * 0.5;
  const hw = RIDER_FOOTPRINT.width * 0.5;
  const out: { x: number; y: number; z: number }[] = [];
  for (const y of [pose.feet, pose.top]) {
    for (const a of [-pose.back - hl, -pose.back + hl]) {
      for (const w of [-hw, hw]) {
        out.push({ x: agent.x + fx * a + rx * w, y, z: agent.z + fz * a + rz * w });
      }
    }
  }
  return out;
}

export function agentClass(agent: Pick<SimAgent, "type">): AgentClass {
  return AGENT_CLASS[agent.type];
}

export function agentTrackId(agent: Pick<SimAgent, "id" | "type">): string {
  return `${AGENT_TRACK_PREFIX[agentClass(agent)]}-${agent.id}`;
}

/** Lane under the agent, or null on the sidewalk. Riders report their curb lane. */
export function agentLane(agent: Pick<SimAgent, "x" | "z" | "laneId">): string | null {
  return agent.laneId ?? baseLaneIdAt(agent.x, agent.z);
}

/** Lane id for riders, else crosswalk or sidewalk zone. */
export function agentZone(agent: Pick<SimAgent, "x" | "z" | "laneId">): string | null {
  return agent.laneId ?? zoneAt(agent.x, agent.z);
}

/** Oriented box corners of the rig, rider included. A parked bike is the bike alone. */
export function agentCorners(
  agent: Pick<SimAgent, "x" | "z" | "yaw" | "type" | "parked">,
): { x: number; y: number; z: number }[] {
  const size = agent.parked ? PARKED_BIKE_SIZE : AGENT_SIZE[agent.type];
  const fx = Math.sin(agent.yaw);
  const fz = Math.cos(agent.yaw);
  const rx = Math.cos(agent.yaw);
  const rz = -Math.sin(agent.yaw);
  const hl = size.length * 0.5;
  const hw = size.width * 0.5;
  const out: { x: number; y: number; z: number }[] = [];
  for (const y of [0, size.height]) {
    for (const a of [-hl, hl]) {
      for (const w of [-hw, hw]) {
        out.push({ x: agent.x + fx * a + rx * w, y, z: agent.z + fz * a + rz * w });
      }
    }
  }
  return out;
}
