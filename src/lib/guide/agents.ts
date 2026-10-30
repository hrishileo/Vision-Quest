import {
  CHI_CURB,
  MICH_CURB,
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
} as const;

/** Deterministic VRU spawn. `density` scales counts the same way as the car fleet. */
export function spawnAgents(seed: number, density: number): SimAgent[] {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const scale = Number.isFinite(density) ? Math.min(2, Math.max(0, density)) : 1;
  const count = (n: number) => (scale <= 0 ? 0 : Math.max(1, Math.round(n * scale)));
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
  for (let i = 0; i < count(AGENT_COUNTS.crossers); i++) {
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
  for (let i = 0; i < count(AGENT_COUNTS.strollers); i++) {
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
    { type: "bicycle", v0: () => 4 + rng() * 1.6, n: count(AGENT_COUNTS.bicycle) },
    { type: "scooter", v0: () => 3.4 + rng() * 1.4, n: count(AGENT_COUNTS.scooter) },
    { type: "motorbike", v0: () => 6.5 + rng() * 2, n: count(AGENT_COUNTS.motorbike) },
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
  return agents;
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

/** Oriented box corners of the rig, rider included. */
export function agentCorners(
  agent: Pick<SimAgent, "x" | "z" | "yaw" | "type">,
): { x: number; y: number; z: number }[] {
  const size = AGENT_SIZE[agent.type];
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
