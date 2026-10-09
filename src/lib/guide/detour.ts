import * as THREE from "three";
import {
  BUILDINGS,
  CHI_EB,
  CROSS_Z,
  MICH_NB,
  RUSH_X,
  SPAN,
  carHitsBuilding,
  inIntersection,
  laneById,
  lanePose,
  wrapS,
} from "./city.ts";
import { CORPUS_HZ_DEFAULT, CORPUS_HEIGHT, CORPUS_WIDTH, FrameClock, cameraRecord } from "./corpus.ts";
import type { DebrisDef } from "./debris.ts";
import { Y } from "./specs.ts";
import {
  SIM_STEP,
  TrafficSim,
  createSimCar,
  type LaneBlock,
  type RouteLink,
  type SimCar,
} from "./traffic.ts";
import { buildingOccludes, isVisibleInCamera, ndcInView } from "./visibility.ts";

/** Hub debris scenario blocks these two. The scene also has `mich-nb-0`, which the hub graph does not. */
export const HUB_NB_LANES = ["mich-nb-1", "mich-nb-2"] as const;

export const BLOCK_S0 = 97;
export const BLOCK_S1 = 110;
export const START_S = 68;
export const FINISH_S = 146;
export const JAM_SPEED_MPS = 2.5;
export const JAM_WINDOW_S = 5;
export const SWEEP_FRACTIONS = [0, 0.1, 0.25, 0.5, 1] as const;

const JOIN_Z = CHI_EB[0];
const CURB_X = MICH_NB[2];
const RUSH_X0 = RUSH_X[0];
const LANE_CHANGE_S = 70;
const ROUTED_COLOR = 0x3c7dff;
const PALETTE = [0xc5c8ce, 0x3a3e44, 0x5c6460, 0xb8bcc2, 0x2c3238, 0x6a5040, 0x4a5560, 0x8a7a68];

/** Rush northbound only. `conn-wb-0` is the return, not a Rush lane. */
export const RUSH_LANES = ["rush-nb-0", "rush-nb-1"] as const;

/**
 * Ordered joins a router can hand to a car. The parallel street is Rush
 * (`rush-nb-0`). Chicago Avenue's eastbound inner lane `chi-eb-0` is the
 * south connection. `conn-wb-0` is the north return to Michigan.
 */
export const DETOUR_LINKS: RouteLink[] = [
  { from: "mich-nb-1", to: "mich-nb-2", fromS: LANE_CHANGE_S, toS: LANE_CHANGE_S },
  { from: "mich-nb-2", to: "chi-eb-0", fromS: SPAN - JOIN_Z, toS: CURB_X + SPAN },
  { from: "chi-eb-0", to: "rush-nb-0", fromS: RUSH_X0 + SPAN, toS: 0 },
  { from: "rush-nb-0", to: "conn-wb-0", fromS: laneById("rush-nb-0")!.length, toS: 0 },
  {
    from: "conn-wb-0",
    to: "mich-nb-2",
    fromS: laneById("conn-wb-0")!.length,
    toS: SPAN - CROSS_Z,
  },
];

export type PresetName = "single" | "both";
export type ArmName = "stay" | "detour";

export const PRESETS: Record<PresetName, { id: string; lanes: readonly string[] }> = {
  single: { id: "block-mich-nb-1", lanes: ["mich-nb-1"] },
  both: { id: "block-mich-nb", lanes: [...HUB_NB_LANES] },
};

export function blocksFor(lanes: readonly string[]): LaneBlock[] {
  return lanes.map((laneId) => ({ laneId, s0: BLOCK_S0, s1: BLOCK_S1 }));
}

export function detourRoute(laneId: string): string[] {
  if (laneId === "mich-nb-2") {
    return ["mich-nb-2", "chi-eb-0", "rush-nb-0", "conn-wb-0", "mich-nb-2"];
  }
  if (laneId === "mich-nb-1") {
    return ["mich-nb-1", "mich-nb-2", "chi-eb-0", "rush-nb-0", "conn-wb-0", "mich-nb-2"];
  }
  return [laneId];
}

export function stayRoute(laneId: string): string[] {
  return [laneId];
}

/**
 * Largest pose jump on a geometric join. The mich-nb-1 → mich-nb-2 step is a
 * same-s lane change, so its lateral offset is not a broken junction.
 */
export function junctionGapM(): number {
  let worst = 0;
  for (const link of DETOUR_LINKS) {
    if (link.fromS === link.toS && link.from.startsWith("mich-") && link.to.startsWith("mich-")) {
      continue;
    }
    const from = laneById(link.from);
    const to = laneById(link.to);
    if (!from || !to) return Infinity;
    const a = lanePose(from, link.fromS);
    const b = lanePose(to, link.toS);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.z - b.z));
  }
  return worst;
}

export function detourHitsBuilding(): boolean {
  const spans: { id: string; s0: number; s1: number }[] = [
    { id: "mich-nb-2", s0: START_S, s1: FINISH_S },
    { id: "chi-eb-0", s0: CURB_X + SPAN, s1: RUSH_X0 + SPAN },
    { id: "rush-nb-0", s0: 0, s1: laneById("rush-nb-0")!.length },
    { id: "conn-wb-0", s0: 0, s1: laneById("conn-wb-0")!.length },
  ];
  for (const span of spans) {
    const lane = laneById(span.id);
    if (!lane) return true;
    for (let s = span.s0; s <= span.s1 + 1e-6; s += 2) {
      const pose = lanePose(lane, Math.min(s, lane.finite ? lane.length : span.s1));
      if (carHitsBuilding(pose.x, pose.z, pose.yaw)) return true;
    }
  }
  return false;
}

export function blockedLaneDebris(lanes: readonly string[]): DebrisDef[] {
  const defs: DebrisDef[] = [];
  let id = 100;
  for (const laneId of lanes) {
    const lane = laneById(laneId);
    if (!lane) continue;
    for (let s = BLOCK_S0 + 1.2; s <= BLOCK_S1 - 0.4; s += 3.6) {
      const pose = lanePose(lane, s);
      defs.push({
        id: id++,
        type: "barrier",
        kind: "blockade",
        origin: "manmade",
        label: "Lane blockade",
        x: pose.x,
        z: pose.z,
        yaw: Math.PI / 2,
      });
    }
  }
  return defs;
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

export function routedCount(fraction: number, n: number): number {
  if (fraction <= 0 || n <= 0) return 0;
  if (fraction >= 1) return n;
  return Math.round(fraction * n);
}

export type Fleet = { cars: SimCar[]; measuredIds: number[] };

/** Same positions for every fraction. Only the downstream cohort flag changes. */
export function buildFleet(seed: number, fraction: number, lanes: readonly string[]): Fleet {
  const rng = mulberry32(seed >>> 0);
  const cars: SimCar[] = [];
  const measuredIds: number[] = [];
  let id = 0;
  const push = (laneId: string, s: number, measure: boolean) => {
    const car = createSimCar({
      id,
      laneId,
      s,
      length: 4.25 + rng() * 0.35,
      v0: 8.4 + rng() * 2.4,
      v: 5.5 + rng() * 2.5,
      color: PALETTE[id % PALETTE.length],
    });
    cars.push(car);
    if (measure) measuredIds.push(id);
    id += 1;
  };
  for (const laneId of ["mich-nb-1", "mich-nb-2"] as const) {
    for (let i = 0; i < 8; i++) push(laneId, 2 + i * 7.2, true);
  }
  for (let s = 36; s <= 140; s += 7.2) push("mich-nb-0", s, s < START_S);
  const blocked = new Set(lanes);
  for (const laneId of blocked) {
    const platoon = cars.filter((c) => c.laneId === laneId).sort((a, b) => b.s - a.s);
    const k = routedCount(fraction, platoon.length);
    for (let i = 0; i < k; i++) {
      const car = platoon[i]!;
      car.routed = true;
      car.color = ROUTED_COLOR;
    }
  }
  return { cars, measuredIds };
}

export function armFleet(
  seed: number,
  fraction: number,
  lanes: readonly string[],
  arm: ArmName,
): Fleet {
  const fleet = buildFleet(seed, fraction, lanes);
  for (const car of fleet.cars) {
    if (!car.routed) continue;
    car.route = arm === "detour" ? detourRoute(car.laneId) : stayRoute(car.laneId);
    car.routeIndex = 0;
  }
  return fleet;
}

export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Nearest-rank percentile. `p` is in (0, 1]. Rank = ceil(p * n). */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1]!;
}

export function p90(values: readonly number[]): number | null {
  return percentile(values, 0.9);
}

export type QueueCar = { laneId: string; s: number; v: number; length: number };

/** Longest bumper-to-bumper run of stopped cars, in metres. */
export function maxQueueLengthM(
  cars: readonly QueueCar[],
  laneIds: readonly string[],
  stoppedV = 1.2,
  coupleGap = 6,
): number {
  let best = 0;
  for (const laneId of laneIds) {
    const list = cars
      .filter((c) => c.laneId === laneId && c.v < stoppedV)
      .sort((a, b) => a.s - b.s);
    let runRear = 0;
    let runFront = 0;
    let open = false;
    const close = () => {
      if (!open) return;
      best = Math.max(best, runFront - runRear);
      open = false;
    };
    for (const car of list) {
      const rear = car.s - car.length * 0.5;
      const front = car.s + car.length * 0.5;
      if (!open || rear - runFront > coupleGap) {
        close();
        runRear = rear;
        runFront = front;
        open = true;
      } else {
        runFront = front;
      }
    }
    close();
  }
  return best;
}

export type SpeedSample = { t: number; speed: number | null };

/** True when occupied samples stay under `threshold` for at least `windowS` seconds. */
export function sustainedSlow(
  samples: readonly SpeedSample[],
  threshold: number,
  windowS: number,
): boolean {
  let runStart: number | null = null;
  for (const sample of samples) {
    const slow = sample.speed !== null && sample.speed < threshold;
    if (!slow) {
      runStart = null;
      continue;
    }
    if (runStart === null) runStart = sample.t;
    if (sample.t - runStart >= windowS - 1e-9) return true;
  }
  return false;
}

export type CohortStats = {
  n: number;
  completed: number;
  incomplete: number;
  meanTravelS: number | null;
  p90TravelS: number | null;
};

export function cohortStats(times: readonly (number | null)[]): CohortStats {
  const done = times.filter((t): t is number => t !== null && Number.isFinite(t));
  return {
    n: times.length,
    completed: done.length,
    incomplete: times.length - done.length,
    meanTravelS: meanOf(done),
    p90TravelS: p90(done),
  };
}

export type CarResult = {
  id: number;
  routed: boolean;
  laneId: string;
  travelS: number | null;
};

export type ArmReport = {
  routed: CohortStats;
  nonRouted: CohortStats;
  cars: CarResult[];
  sideStreet: {
    maxQueueM: number;
    meanSpeedMps: number | null;
    jam: boolean;
  };
};

export type FractionReport = {
  routedFraction: number;
  routedCount: number;
  platoon: number;
  arms: Record<ArmName, ArmReport>;
};

export type PresetReport = {
  id: string;
  blockedLanes: string[];
  fractions: FractionReport[];
};

export type Cam0RushView = {
  /** Pursuit entry pose, held for every frame. The chase controller does not run. */
  droneMoved: false;
  presetId: string;
  arm: "detour";
  routedFraction: number;
  seed: number;
  horizonS: number;
  hz: number;
  frames: number;
  rushLaneFrames: number;
  rushCarFrames: number;
  rushLaneFraction: number;
  rushCarFraction: number;
  /** Rush centerline samples (every 4 m), classified once. The camera does not move. */
  samples: number;
  outsideFrustum: number;
  occluded: number;
  visibleSamples: number;
  occluders: string[];
  laneIds: string[];
  body: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };
  camera: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    roll: number;
    fovY: number;
    aspect: number;
  };
  gimbalYaw: 0;
  gimbalPitch: 0;
  routerNote: string;
};

export type DetourStudy = {
  seed: number;
  horizonS: number;
  stepS: number;
  startS: number;
  finishS: number;
  blockS0: number;
  blockS1: number;
  jamSpeedMps: number;
  jamWindowS: number;
  streets: { name: string; laneIds: string[] }[];
  hubMap: { hubLane: string; sceneLane: string | null; note: string }[];
  presets: PresetReport[];
  cam0: Cam0RushView;
};

/**
 * Downstream routers cost an unseen side street as `unknown` (a cautious cost).
 * This measurement records true travel times and does not apply that cost.
 */
export const ROUTER_UNKNOWN_COST =
  "In the downstream router an unseen side street is costed as `unknown` with a cautious cost. This sim measures true travel times, so it does not use that cost.";

/** Same station the default pursuit subject uses (`mich-nb-1`, `SPAN - 28`, clear of the box). */
function subjectStation(laneId: string, s: number): number {
  const lane = laneById(laneId)!;
  let t = wrapS(s, lane.length);
  for (let i = 0; i < 48; i++) {
    const pose = lanePose(lane, t);
    if (!inIntersection(pose.x, pose.z)) return t;
    t = wrapS(t + 3.2, lane.length);
  }
  return t;
}

/**
 * CAM0 at the pose `GuideEngine` writes when Pursuit starts, before the chase
 * integrator runs. Body yaw is π, gimbal stays at rest, aspect is the corpus 16:9.
 */
export function pursuitEntryCamera(): {
  camera: THREE.PerspectiveCamera;
  camPos: THREE.Vector3;
  body: Cam0RushView["body"];
} {
  const subject = lanePose(laneById("mich-nb-1")!, subjectStation("mich-nb-1", SPAN - 28));
  const body = new THREE.Group();
  body.position.set(subject.x, 8, subject.z + 14);
  body.rotation.order = "YXZ";
  body.rotation.set(0, Math.PI, 0);
  const gimbalYaw = new THREE.Group();
  gimbalYaw.position.set(0, Y.gimbal, 0.152);
  body.add(gimbalYaw);
  const gimbalPitch = new THREE.Group();
  gimbalPitch.position.set(0, 0, 0.018);
  gimbalYaw.add(gimbalPitch);
  const camBody = new THREE.Group();
  camBody.position.set(0, 0, 0.012);
  gimbalPitch.add(camBody);
  const camera = new THREE.PerspectiveCamera(70, CORPUS_WIDTH / CORPUS_HEIGHT, 0.04, 180);
  camera.position.set(0, 0, 0.034);
  camera.rotation.y = Math.PI;
  camBody.add(camera);
  body.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return {
    camera,
    camPos: camera.getWorldPosition(new THREE.Vector3()),
    body: {
      x: body.position.x,
      y: body.position.y,
      z: body.position.z,
      yaw: Math.PI,
      pitch: 0,
      roll: 0,
    },
  };
}

function buildingOccluders(): THREE.Object3D[] {
  return BUILDINGS.map((foot) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(foot.sx, foot.h, foot.sz));
    mesh.name = foot.name;
    mesh.position.set(foot.x, foot.h / 2, foot.z);
    mesh.updateMatrixWorld();
    return mesh;
  });
}

function rushSamples(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const id of RUSH_LANES) {
    const lane = laneById(id)!;
    for (let s = 0; s <= lane.length + 1e-6; s += 4) {
      const pose = lanePose(lane, Math.min(s, lane.length));
      out.push({ x: pose.x, z: pose.z });
    }
  }
  return out;
}

/**
 * Fraction of corpus-rate frames in which any Rush sample, or any car on Rush,
 * passes `isVisibleInCamera`. The drone stays on the pursuit entry pose.
 * The both-lanes blockade at 50% routed is the scenario the viewer loads.
 */
export function measureCam0Rush(opts?: {
  seed?: number;
  horizonS?: number;
  fraction?: number;
  preset?: PresetName;
  hz?: number;
}): Cam0RushView {
  const seed = opts?.seed ?? 7;
  const horizonS = opts?.horizonS ?? 120;
  const fraction = opts?.fraction ?? 0.5;
  const preset = PRESETS[opts?.preset ?? "both"];
  const view = pursuitEntryCamera();
  const buildings = buildingOccluders();
  const samples = rushSamples();
  const scratch = { ndc: new THREE.Vector3(), to: new THREE.Vector3(), ray: new THREE.Raycaster() };
  const sample = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const see = (x: number, z: number) =>
    isVisibleInCamera(
      view.camera,
      view.camPos,
      sample.set(x, 0.6, z),
      aim.set(x, 1, z),
      buildings,
      scratch,
    );
  let outsideFrustum = 0;
  let occluded = 0;
  let visibleSamples = 0;
  const occluders = new Set<string>();
  for (const point of samples) {
    const visible = see(point.x, point.z);
    if (visible) {
      visibleSamples += 1;
      continue;
    }
    scratch.ndc.copy(sample.set(point.x, 0.6, point.z)).project(view.camera);
    if (!ndcInView(scratch.ndc)) {
      outsideFrustum += 1;
      continue;
    }
    aim.set(point.x, 1, point.z).sub(view.camPos);
    const dist = aim.length();
    aim.multiplyScalar(1 / Math.max(dist, 1e-6));
    scratch.ray.set(view.camPos, aim);
    const hits = scratch.ray.intersectObjects(buildings, false);
    if (buildingOccludes(hits, dist) && hits[0]!.object.name) occluders.add(hits[0]!.object.name);
    occluded += 1;
  }
  const laneSeen = visibleSamples > 0;
  const fleet = armFleet(seed, fraction, preset.lanes, "detour");
  const sim = new TrafficSim(seed);
  sim.loadFleet(fleet.cars, { seed, blocks: blocksFor(preset.lanes), links: DETOUR_LINKS });
  const clock = new FrameClock();
  clock.reset(opts?.hz ?? CORPUS_HZ_DEFAULT);
  let frames = 0;
  let rushLaneFrames = 0;
  let rushCarFrames = 0;
  const take = () => {
    if (!clock.due(sim.time)) return;
    frames += 1;
    if (laneSeen) rushLaneFrames += 1;
    const carSeen = sim.cars.some(
      (car) => !car.parked && (RUSH_LANES as readonly string[]).includes(car.laneId) && see(car.x, car.z),
    );
    if (carSeen) rushCarFrames += 1;
  };
  take();
  const steps = Math.round(horizonS / SIM_STEP);
  for (let i = 0; i < steps; i++) {
    sim.advance(1);
    take();
  }
  const recorded = cameraRecord(view.camera, CORPUS_WIDTH, CORPUS_HEIGHT);
  const fractionOf = (count: number) => (frames === 0 ? 0 : count / frames);
  return {
    droneMoved: false,
    presetId: preset.id,
    arm: "detour",
    routedFraction: fraction,
    seed,
    horizonS,
    hz: clock.hz,
    frames,
    rushLaneFrames,
    rushCarFrames,
    rushLaneFraction: fractionOf(rushLaneFrames),
    rushCarFraction: fractionOf(rushCarFrames),
    samples: samples.length,
    outsideFrustum,
    occluded,
    visibleSamples,
    occluders: [...occluders],
    laneIds: [...RUSH_LANES],
    body: view.body,
    camera: {
      x: recorded.position.x,
      y: recorded.position.y,
      z: recorded.position.z,
      yaw: recorded.yaw,
      pitch: recorded.pitch,
      roll: recorded.roll,
      fovY: recorded.intrinsics.fovY,
      aspect: CORPUS_WIDTH / CORPUS_HEIGHT,
    },
    gimbalYaw: 0,
    gimbalPitch: 0,
    routerNote: ROUTER_UNKNOWN_COST,
  };
}

function onNb(laneId: string): boolean {
  return laneId.startsWith("mich-nb");
}

function crossed(prev: { laneId: string; s: number }, car: SimCar, line: number): boolean {
  if (!onNb(prev.laneId) || !onNb(car.laneId)) return false;
  if (!(prev.s < line && car.s >= line)) return false;
  if (car.s - prev.s > 25) return false;
  return true;
}

function sideSnapshot(sim: TrafficSim): { queueM: number; speed: number | null } {
  const present = sim.cars.filter(
    (c) => !c.parked && (RUSH_LANES as readonly string[]).includes(c.laneId),
  );
  const queueM = maxQueueLengthM(
    sim.cars.filter((c) => !c.parked),
    RUSH_LANES,
  );
  if (present.length === 0) return { queueM, speed: null };
  return { queueM, speed: present.reduce((sum, c) => sum + c.v, 0) / present.length };
}

export function runArm(
  seed: number,
  fraction: number,
  lanes: readonly string[],
  arm: ArmName,
  horizonS: number,
): ArmReport {
  const fleet = armFleet(seed, fraction, lanes, arm);
  const sim = new TrafficSim(seed);
  sim.loadFleet(fleet.cars, { seed, blocks: blocksFor(lanes), links: DETOUR_LINKS });
  const measured = new Set(fleet.measuredIds);
  const timing = new Map<
    number,
    { start: number | null; finish: number | null; routed: boolean; laneId: string }
  >();
  for (const car of sim.cars) {
    if (!measured.has(car.id)) continue;
    timing.set(car.id, { start: null, finish: null, routed: car.routed, laneId: car.laneId });
  }
  let prev = new Map(sim.cars.map((c) => [c.id, { laneId: c.laneId, s: c.s }]));
  const samples: SpeedSample[] = [];
  const speeds: number[] = [];
  let maxQueue = 0;
  const steps = Math.round(horizonS / SIM_STEP);
  const sampleEvery = Math.max(1, Math.round(0.5 / SIM_STEP));
  for (let step = 0; step < steps; step++) {
    sim.advance(1);
    for (const car of sim.cars) {
      const rec = timing.get(car.id);
      const was = prev.get(car.id);
      if (!rec || !was) continue;
      if (rec.start === null && crossed(was, car, START_S)) rec.start = sim.time;
      if (rec.start !== null && rec.finish === null && crossed(was, car, FINISH_S)) {
        rec.finish = sim.time;
      }
    }
    if (step % sampleEvery === 0) {
      const snap = sideSnapshot(sim);
      samples.push({ t: sim.time, speed: snap.speed });
      if (snap.speed !== null) speeds.push(snap.speed);
      maxQueue = Math.max(maxQueue, snap.queueM);
    }
    prev = new Map(sim.cars.map((c) => [c.id, { laneId: c.laneId, s: c.s }]));
  }
  const cars: CarResult[] = [];
  const routedTimes: (number | null)[] = [];
  const otherTimes: (number | null)[] = [];
  for (const [id, rec] of timing) {
    const travel = rec.start !== null && rec.finish !== null ? rec.finish - rec.start : null;
    cars.push({ id, routed: rec.routed, laneId: rec.laneId, travelS: travel });
    (rec.routed ? routedTimes : otherTimes).push(travel);
  }
  cars.sort((a, b) => a.id - b.id);
  return {
    routed: cohortStats(routedTimes),
    nonRouted: cohortStats(otherTimes),
    cars,
    sideStreet: {
      maxQueueM: maxQueue,
      meanSpeedMps: meanOf(speeds),
      jam: sustainedSlow(samples, JAM_SPEED_MPS, JAM_WINDOW_S),
    },
  };
}

function round(n: number | null, digits = 3): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function roundCohort(stats: CohortStats): CohortStats {
  return {
    ...stats,
    meanTravelS: round(stats.meanTravelS),
    p90TravelS: round(stats.p90TravelS),
  };
}

function roundArm(arm: ArmReport): ArmReport {
  return {
    routed: roundCohort(arm.routed),
    nonRouted: roundCohort(arm.nonRouted),
    cars: arm.cars.map((car) => ({ ...car, travelS: round(car.travelS, 3) })),
    sideStreet: {
      maxQueueM: round(arm.sideStreet.maxQueueM, 2) ?? 0,
      meanSpeedMps: round(arm.sideStreet.meanSpeedMps, 3),
      jam: arm.sideStreet.jam,
    },
  };
}

export function runDetourStudy(opts?: {
  seed?: number;
  horizonS?: number;
  fractions?: readonly number[];
  presets?: readonly PresetName[];
}): DetourStudy {
  const seed = opts?.seed ?? 7;
  const horizonS = opts?.horizonS ?? 120;
  const fractions = opts?.fractions ?? SWEEP_FRACTIONS;
  const presets = opts?.presets ?? (["single", "both"] as const);
  const reports: PresetReport[] = [];
  for (const name of presets) {
    const preset = PRESETS[name];
    const fractionsOut: FractionReport[] = [];
    for (const fraction of fractions) {
      const probe = buildFleet(seed, fraction, preset.lanes);
      const routedN = probe.cars.filter((c) => c.routed && preset.lanes.includes(c.laneId)).length;
      const platoon = probe.cars.filter((c) => preset.lanes.includes(c.laneId)).length;
      fractionsOut.push({
        routedFraction: fraction,
        routedCount: routedN,
        platoon,
        arms: {
          stay: roundArm(runArm(seed, fraction, preset.lanes, "stay", horizonS)),
          detour: roundArm(runArm(seed, fraction, preset.lanes, "detour", horizonS)),
        },
      });
    }
    reports.push({ id: preset.id, blockedLanes: [...preset.lanes], fractions: fractionsOut });
  }
  return {
    seed,
    horizonS,
    stepS: SIM_STEP,
    startS: START_S,
    finishS: FINISH_S,
    blockS0: BLOCK_S0,
    blockS1: BLOCK_S1,
    jamSpeedMps: JAM_SPEED_MPS,
    jamWindowS: JAM_WINDOW_S,
    streets: [
      {
        name: "Michigan Avenue",
        laneIds: ["mich-nb-0", "mich-nb-1", "mich-nb-2", "mich-sb-0", "mich-sb-1", "mich-sb-2"],
      },
      {
        name: "Chicago Avenue",
        laneIds: ["chi-eb-0", "chi-eb-1", "chi-wb-0", "chi-wb-1"],
      },
      {
        name: "Rush Street",
        laneIds: [...RUSH_LANES],
      },
      { name: "North connector", laneIds: ["conn-wb-0"] },
    ],
    hubMap: [
      { hubLane: "mich-nb-1", sceneLane: "mich-nb-1", note: "same id" },
      { hubLane: "mich-nb-2", sceneLane: "mich-nb-2", note: "same id" },
      { hubLane: "mich-sb-1", sceneLane: "mich-sb-1", note: "same id, not on the detour" },
      { hubLane: "mich-sb-2", sceneLane: "mich-sb-2", note: "same id, not on the detour" },
      {
        hubLane: "rush-nb",
        sceneLane: "rush-nb-0",
        note: "Added northbound Rush Street, east of Michigan. The hub id has no index. The scene also has rush-nb-1. The detour route uses rush-nb-0.",
      },
      {
        hubLane: "wabash-nb",
        sceneLane: "wabash-nb-0",
        note: "West of the lots. Hub id has no index. The scene lane is wabash-nb-0 (wabash-nb-1 is the outer lane). This Rush measurement does not send cars there. The closed loop does.",
      },
      {
        hubLane: "chicago-ew",
        sceneLane: "chi-eb-0",
        note: "Chicago Avenue eastbound inner lane. The scene also has chi-eb-1, chi-wb-0, chi-wb-1. This is the south connection onto Rush.",
      },
    ],
    presets: reports,
    cam0: measureCam0Rush({ seed, horizonS }),
  };
}

function fmt(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function renderDetourSummary(study: DetourStudy): string {
  const lines: string[] = [];
  lines.push("# Mag Mile detour measurement");
  lines.push("");
  lines.push(
    "Rush Street is east of Michigan (`rush-nb-0`, `rush-nb-1`). This measurement sends cars out on `chi-eb-0` and back on `conn-wb-0`, using `rush-nb-0`. Wabash is the west parallel (`wabash-nb-0`, `wabash-nb-1`), joined on `chi-wb-0` and `conn-eb-0`. The closed loop uses it when anti-herding leaves Rush. This table does not.",
  );
  lines.push("");
  lines.push(study.cam0.routerNote);
  lines.push("");
  lines.push("## Lane map");
  lines.push("");
  lines.push("| Street | Scene lane ids |");
  lines.push("| --- | --- |");
  for (const street of study.streets) {
    lines.push(`| ${street.name} | ${street.laneIds.join(", ")} |`);
  }
  lines.push("");
  lines.push("| Hub lane | Scene lane |");
  lines.push("| --- | --- |");
  for (const row of study.hubMap) {
    lines.push(`| \`${row.hubLane}\` | ${row.sceneLane ? `\`${row.sceneLane}\`` : "none"} |`);
  }
  lines.push("");
  lines.push(
    `Seed ${study.seed}. Horizon ${study.horizonS}s. Start s=${study.startS}, finish s=${study.finishS} on Michigan northbound. Debris covers s=${study.blockS0}–${study.blockS1}. Jam means Rush mean speed under ${study.jamSpeedMps} m/s for ${study.jamWindowS}s. Travel times are completed trips only.`,
  );
  lines.push("");
  for (const preset of study.presets) {
    lines.push(`## ${preset.id}`);
    lines.push("");
    lines.push(`Blocked lanes: ${preset.blockedLanes.map((id) => `\`${id}\``).join(", ")}.`);
    lines.push("");
    lines.push(
      "| Routed | Arm | Routed n (done) | Mean s | p90 s | Other n (done) | Other mean s | Other p90 s | Rush queue m | Rush speed m/s | Jam |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of preset.fractions) {
      for (const arm of ["stay", "detour"] as const) {
        const report = row.arms[arm];
        lines.push(
          `| ${pct(row.routedFraction)} (${row.routedCount}/${row.platoon}) | ${arm} | ${report.routed.completed}/${report.routed.n} | ${fmt(report.routed.meanTravelS)} | ${fmt(report.routed.p90TravelS)} | ${report.nonRouted.completed}/${report.nonRouted.n} | ${fmt(report.nonRouted.meanTravelS)} | ${fmt(report.nonRouted.p90TravelS)} | ${fmt(report.sideStreet.maxQueueM, 1)} | ${fmt(report.sideStreet.meanSpeedMps, 2)} | ${report.sideStreet.jam ? "yes" : "no"} |`,
        );
      }
    }
    lines.push("");
    lines.push(...interpretPreset(preset, study.horizonS));
    lines.push("");
  }
  lines.push(...renderCam0(study.cam0));
  return lines.join("\n");
}

function renderCam0(view: Cam0RushView): string[] {
  const pctFrames = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
  return [
    "## CAM0 and Rush",
    "",
    "The drone stays on the default Pursuit entry pose: behind the default `mich-nb-1` subject, 14 m south, altitude 8 m, yaw π, gimbal at rest. It is not flown. Each frame uses the corpus camera (70° vertical, 16:9) and `isVisibleInCamera` (NDC inside ±0.92, depth in (0, 1), building ray not closer than the aim point by 1.2 m). A Rush lane counts when any sample every 4 m along `rush-nb-0` or `rush-nb-1` passes, at the vehicle sample (x, 0.6, z). A Rush car counts when a car whose lane is one of those two passes the same check.",
    "",
    `Preset \`${view.presetId}\`, detour arm, ${Math.round(view.routedFraction * 100)}% routed, seed ${view.seed}, ${view.horizonS}s at ${view.hz} Hz. ${view.frames} frames. Rush centerline samples: ${view.visibleSamples} visible, ${view.occluded} inside the frustum but occluded${view.occluders.length ? ` (${view.occluders.join(", ")})` : ""}, ${view.outsideFrustum} outside the NDC margin.`,
    "",
    `| What is in view | Frames | Fraction |`,
    `| --- | --- | --- |`,
    `| Any Rush lane segment | ${view.rushLaneFrames}/${view.frames} | ${pctFrames(view.rushLaneFraction)} |`,
    `| Any car on Rush | ${view.rushCarFrames}/${view.frames} | ${pctFrames(view.rushCarFraction)} |`,
    "",
    view.routerNote,
    "",
  ];
}

function interpretPreset(preset: PresetReport, horizonS: number): string[] {
  const notes: string[] = [];
  let helped = 0;
  let hurt = 0;
  for (const row of preset.fractions) {
    if (row.routedCount === 0) {
      notes.push(`${pct(row.routedFraction)}: no routed cars, so the arms match.`);
      continue;
    }
    const stay = row.arms.stay.routed;
    const detour = row.arms.detour.routed;
    const jam = row.arms.detour.sideStreet.jam ? " Side street jam flag is on." : "";
    if (stay.completed === 0 && detour.completed === 0) {
      notes.push(
        `${pct(row.routedFraction)}: neither arm finished a routed trip within ${horizonS}s.${jam}`,
      );
    } else if (stay.completed === 0 && detour.completed > 0) {
      helped += 1;
      notes.push(
        `${pct(row.routedFraction)}: stay finished ${stay.completed}/${stay.n}. Detour finished ${detour.completed}/${detour.n} with mean ${fmt(detour.meanTravelS)}s.${jam}`,
      );
    } else if (detour.completed === 0 && stay.completed > 0) {
      hurt += 1;
      notes.push(
        `${pct(row.routedFraction)}: detour finished nobody. Stay mean ${fmt(stay.meanTravelS)}s.${jam}`,
      );
    } else if (stay.meanTravelS !== null && detour.meanTravelS !== null) {
      const delta = detour.meanTravelS - stay.meanTravelS;
      if (delta < -1) helped += 1;
      else if (delta > 1) hurt += 1;
      const sign = delta > 0 ? "+" : "";
      notes.push(
        `${pct(row.routedFraction)}: detour mean ${fmt(detour.meanTravelS)}s versus stay ${fmt(stay.meanTravelS)}s (${sign}${delta.toFixed(1)}s).${jam}`,
      );
    }
  }
  if (helped === 0 && hurt > 0) {
    notes.push(
      "On completed trips, sending cars onto Rush does not reduce travel time.",
    );
  } else if (helped > 0 && hurt === 0) {
    notes.push("Where the two arms differ, the detour is the one that gets routed cars through.");
  } else if (helped > 0 && hurt > 0) {
    notes.push("The detour helps at some routed fractions and costs time at others.");
  }
  const jamFractions = preset.fractions.filter((row) => row.arms.detour.sideStreet.jam);
  if (jamFractions.length === 0) {
    notes.push("Rush did not hold a jam under the speed window in this run.");
  } else {
    notes.push(
      `Rush jam flag at ${jamFractions.map((row) => pct(row.routedFraction)).join(", ")} routed.`,
    );
  }
  return notes;
}

export type RoutesApi = {
  assign: (carId: number, laneIds: readonly string[]) => boolean;
  clear: (carId: number) => boolean;
  setLinks: (links: readonly RouteLink[]) => void;
  routes: () => { carId: number; laneIds: string[]; index: number }[];
  loadBlockedLane: (opts?: BlockedLaneView) => void;
  loadLoop: () => void;
};

export type BlockedLaneView = {
  preset?: PresetName;
  fraction?: number;
  detour?: boolean;
  seed?: number;
  /** Sim seconds to advance before holding the frame. */
  atS?: number;
};

declare global {
  interface Window {
    __routes?: RoutesApi;
  }
}
