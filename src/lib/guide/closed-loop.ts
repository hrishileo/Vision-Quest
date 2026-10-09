import * as THREE from "three";
import {
  BUILDINGS,
  CHI_EB,
  CHI_WB,
  CROSS_Z,
  MICH_NB,
  RUSH_X,
  SPAN,
  WABASH_X,
  carHitsBuilding,
  laneById,
  lanePose,
} from "./city.ts";
import {
  CORPUS_HEIGHT,
  CORPUS_WIDTH,
  cameraRecord,
  debrisRecord,
  framesToJsonl,
  makeFrame,
  projectBox,
  vehicleRecord,
  type CorpusFrame,
  type Vec3,
} from "./corpus.ts";
import type { DebrisDef } from "./debris.ts";
import { BLOCK_S0, BLOCK_S1, FINISH_S, START_S, blockedLaneDebris } from "./detour.ts";
import { SIM_STEP, TrafficSim, createSimCar, type LaneBlock, type RouteLink, type SimCar } from "./traffic.ts";
import { OCCLUDE_PAD, VIEW_NDC } from "./visibility.ts";

/** Pass/fail bars for the closed-loop batch. Change these, not the checks. */
export const LOOP_THRESHOLDS = {
  detectWithinS: 5,
  followRate: 0.95,
  herdMaxShare: 0.75,
  herdMinCars: 4,
  horizonS: 140,
  hz: 10,
  /** Lane may stay `blocked` this long after the debris leaves (edge stale window). */
  clearGraceS: 1.6,
} as const;

const LOOP_NDC = 0.995;
/** First station where a routed car may weave. The window runs 16 m past this, and it ends before the Rush exit at s = 75.6. */
const LANE_CHANGE_S = 58;

/** Kept in lockstep with `__fixtures__/hub-scene-lanes.json`. */
export const HUB_LANE_TO_SCENE: Record<string, string> = {
  "mich-nb-0": "mich-nb-0",
  "mich-nb-1": "mich-nb-1",
  "mich-nb-2": "mich-nb-2",
  "mich-sb-0": "mich-sb-0",
  "mich-sb-1": "mich-sb-1",
  "mich-sb-2": "mich-sb-2",
  "chi-eb-0": "chi-eb-0",
  "chi-wb-0": "chi-wb-0",
  "rush-nb": "rush-nb-0",
  "wabash-nb": "wabash-nb-0",
};

const HUB_LANES = HUB_LANE_TO_SCENE;

/** Same order as `horizon_vision.hub.scenario.corridor_of`. */
const CORRIDOR_PREFIXES = [
  "wabash-nb",
  "rush-nb",
  "wabash-sb",
  "rush-sb",
  "mich-nb-0",
  "mich-nb-1",
  "mich-nb-2",
  "mich-sb-0",
  "mich-sb-1",
  "mich-sb-2",
] as const;

const NB_LANES = ["mich-nb-0", "mich-nb-1", "mich-nb-2"] as const;
const RUSH_COLOR = 0x3c7dff;
const WABASH_COLOR = 0xe09a3e;
const SB_COLOR = 0xc5c8ce;

export type SeeMode = "legacy" | "loop";
export type TrialKind = "closure" | "control" | "clear";
export type CarRole = "nb" | "sb" | "queue" | "stall" | "side";

export type DronePose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  fovY?: number;
};

export type DebrisWindow = {
  laneId: string;
  s0: number;
  s1: number;
  /** Sim time the barriers appear. */
  t0: number;
  /** Exclusive end. Null stays for the whole run. */
  t1: number | null;
};

export type CarInit = {
  id: number;
  laneId: string;
  s: number;
  v: number;
  v0: number;
  role: CarRole;
  route?: string[];
};

export type Trial = {
  id: string;
  seed: number;
  stress: string;
  kind: TrialKind;
  light: "day" | "night";
  pose: DronePose;
  debris: DebrisWindow[];
  cars: CarInit[];
  recordS: number;
  /** Why the legacy policy fails this trial, when it does. */
  legacyFault: string;
  fix: string;
};

export type HubAlert = {
  driver_id: string;
  reason: string;
  old_eta_s: number | null;
  new_eta_s: number | null;
  saved_s: number | null;
  route: string[];
  t: number;
};

export type Plan = {
  t: number;
  blocked: string[];
  alerts: HubAlert[];
};

export type DriverSpec = {
  driver_id: string;
  lane: string;
  origin: string;
  destination: string;
};

export function corridorOf(route: readonly string[]): string {
  for (const name of CORRIDOR_PREFIXES) {
    if (route.some((edgeId) => edgeId.startsWith(`${name}@`))) return name;
  }
  return "other";
}

export function sceneLane(hubLane: string): string | null {
  return HUB_LANES[hubLane] ?? null;
}

function adjacentApproach(from: string, to: string): string[] {
  const a = NB_LANES.indexOf(from as (typeof NB_LANES)[number]);
  const b = NB_LANES.indexOf(to as (typeof NB_LANES)[number]);
  if (a < 0 || b < 0) return [from];
  const step = a <= b ? 1 : -1;
  const out = [from];
  for (let i = a; i !== b; i += step) out.push(NB_LANES[i + step]!);
  return out;
}

/** Hub corridor → scene lane sequence that starts on `startLane`. */
export function simRouteFor(startLane: string, corridor: string): string[] {
  if (corridor === "rush-nb") {
    return [startLane, "chi-eb-0", "rush-nb-0", "conn-wb-0", "mich-nb-2"];
  }
  if (corridor === "wabash-nb") {
    return [startLane, "chi-wb-0", "wabash-nb-0", "conn-eb-0", "mich-nb-0"];
  }
  if ((NB_LANES as readonly string[]).includes(corridor)) {
    if (corridor === startLane) return [startLane];
    return adjacentApproach(startLane, corridor);
  }
  return [startLane];
}

function laneChange(from: string, to: string): RouteLink {
  return { from, to, fromS: LANE_CHANGE_S, toS: LANE_CHANGE_S };
}

function loopLinks(): RouteLink[] {
  const rushJoin = SPAN - CHI_EB[0];
  const wabashJoin = SPAN - CHI_WB[0];
  const back = SPAN - CROSS_Z;
  const wabash = laneById("wabash-nb-0")!;
  const connEast = laneById("conn-eb-0")!;
  const rush = laneById("rush-nb-0")!;
  const connWest = laneById("conn-wb-0")!;
  return [
    laneChange("mich-nb-0", "mich-nb-1"),
    laneChange("mich-nb-1", "mich-nb-0"),
    laneChange("mich-nb-1", "mich-nb-2"),
    laneChange("mich-nb-2", "mich-nb-1"),
    ...MICH_NB.map((x, index) => ({
      from: NB_LANES[index]!,
      to: "chi-eb-0",
      fromS: rushJoin,
      toS: x + SPAN,
    })),
    {
      from: "chi-eb-0",
      to: "rush-nb-0",
      fromS: RUSH_X[0] + SPAN,
      toS: 0,
    },
    { from: "rush-nb-0", to: "conn-wb-0", fromS: rush.length, toS: 0 },
    { from: "conn-wb-0", to: "mich-nb-2", fromS: connWest.length, toS: back },
    ...MICH_NB.map((x, index) => ({
      from: NB_LANES[index]!,
      to: "chi-wb-0",
      fromS: wabashJoin,
      toS: SPAN - x,
    })),
    {
      from: "chi-wb-0",
      to: "wabash-nb-0",
      fromS: SPAN - WABASH_X[0],
      toS: 0,
    },
    { from: "wabash-nb-0", to: "conn-eb-0", fromS: wabash.length, toS: 0 },
    { from: "conn-eb-0", to: "mich-nb-0", fromS: connEast.length, toS: back },
  ];
}

export const LOOP_LINKS: RouteLink[] = loopLinks();

/** Largest geometric gap on a real junction. Same-s Michigan lane changes are lateral. */
export function loopJunctionGapM(): number {
  let worst = 0;
  for (const link of LOOP_LINKS) {
    if (link.from.startsWith("mich-nb") && link.to.startsWith("mich-nb") && link.fromS === link.toS) {
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

export function loopRouteHitsBuilding(): boolean {
  const spans: { id: string; s0: number; s1: number }[] = [];
  for (const id of ["rush-nb-0", "wabash-nb-0", "conn-wb-0", "conn-eb-0", "chi-eb-0", "chi-wb-0"]) {
    const lane = laneById(id);
    if (!lane) return true;
    const s0 = id.startsWith("chi-") ? Math.min(SPAN - 9, SPAN + WABASH_X[0]) : 0;
    const s1 = id.startsWith("chi-eb")
      ? 60.8 + SPAN
      : id.startsWith("chi-wb")
        ? SPAN - WABASH_X[0]
        : lane.length;
    spans.push({ id, s0: Math.max(0, s0), s1 });
  }
  for (const span of spans) {
    const lane = laneById(span.id)!;
    for (let s = span.s0; s <= span.s1 + 1e-6; s += 2) {
      const pose = lanePose(lane, Math.min(s, lane.finite ? lane.length : span.s1));
      if (carHitsBuilding(pose.x, pose.z, pose.yaw)) return true;
    }
  }
  return false;
}

function blocksAt(debris: readonly DebrisWindow[], t: number): LaneBlock[] {
  return debris
    .filter((item) => debrisLive(item, t))
    .map((item) => ({ laneId: item.laneId, s0: item.s0, s1: item.s1 }));
}

function debrisLive(item: DebrisWindow, t: number): boolean {
  if (t + 1e-9 < item.t0) return false;
  if (item.t1 !== null && t > item.t1 + 1e-9) return false;
  return true;
}

export function debrisPieces(debris: readonly DebrisWindow[], t: number): DebrisDef[] {
  const defs: DebrisDef[] = [];
  let id = 100;
  for (const item of debris) {
    if (!debrisLive(item, t)) continue;
    const lane = laneById(item.laneId);
    if (!lane) continue;
    for (let s = item.s0 + 1.2; s <= item.s1 - 0.4; s += 3.6) {
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

function makeCars(cars: readonly CarInit[]): SimCar[] {
  return cars.map((car) =>
    createSimCar({
      id: car.id,
      laneId: car.laneId,
      s: car.s,
      v: car.v,
      v0: car.v0,
      length: 4.4,
      color: car.role === "sb" ? SB_COLOR : 0x8a9098,
      route: car.route,
      routed: !!car.route,
    }),
  );
}

export function driverSpecs(cars: readonly CarInit[]): DriverSpec[] {
  return cars
    .filter((car) => car.role === "nb" || car.role === "sb")
    .map((car) => ({
      driver_id: `veh-${car.id}`,
      lane: car.laneId,
      origin: car.role === "nb" ? "ohio" : "chicago",
      destination: car.role === "nb" ? "chicago" : "ohio",
    }));
}

function makeDrone(pose: DronePose): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(pose.fovY ?? 70, CORPUS_WIDTH / CORPUS_HEIGHT, 0.04, 500);
  camera.rotation.order = "YXZ";
  camera.position.set(pose.x, pose.y, pose.z);
  camera.rotation.set(pose.pitch, pose.yaw, pose.roll);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function buildingMeshes(): THREE.Mesh[] {
  return BUILDINGS.map((foot) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(foot.sx, foot.h, foot.sz));
    mesh.position.set(foot.x, foot.h / 2, foot.z);
    mesh.updateMatrixWorld(true);
    return mesh;
  });
}

function debrisCorners(def: DebrisDef): Vec3[] {
  const hx = 1.65;
  const hy = 0.45;
  const hz = 1.2;
  const c = Math.cos(def.yaw);
  const s = Math.sin(def.yaw);
  const corners: Vec3[] = [];
  for (const y of [0.48 - hy, 0.48 + hy]) {
    for (const lx of [-hx, hx]) {
      for (const lz of [-hz, hz]) {
        corners.push({
          x: def.x + lx * c + lz * s,
          y,
          z: def.z - lx * s + lz * c,
        });
      }
    }
  }
  return corners;
}

function carCorners(car: SimCar): Vec3[] {
  const lane = laneById(car.laneId);
  const alongX = lane?.axis === "x";
  const hl = car.length * 0.5;
  const hw = 0.9;
  const corners: Vec3[] = [];
  for (const y of [0.08, 1.45]) {
    for (const a of [-hl, hl]) {
      for (const w of [-hw, hw]) {
        corners.push(
          alongX
            ? { x: car.x + a, y, z: car.z + w }
            : { x: car.x + w, y, z: car.z + a },
        );
      }
    }
  }
  return corners;
}

export type ViewHit = { ndcX: number; ndcY: number; inFrame: boolean; occluded: boolean };

export function viewPoint(
  pose: DronePose,
  point: Vec3,
  ndcLimit: number,
  buildings = buildingMeshes(),
): ViewHit {
  const camera = makeDrone(pose);
  const camPos = camera.getWorldPosition(new THREE.Vector3());
  const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  const inFrame = Math.abs(ndc.x) < ndcLimit && Math.abs(ndc.y) < ndcLimit && ndc.z > 0 && ndc.z < 1;
  if (!inFrame) return { ndcX: ndc.x, ndcY: ndc.y, inFrame: false, occluded: false };
  const to = new THREE.Vector3(point.x, point.y, point.z).sub(camPos);
  const dist = to.length();
  if (dist < 0.4) return { ndcX: ndc.x, ndcY: ndc.y, inFrame: true, occluded: true };
  to.multiplyScalar(1 / dist);
  const ray = new THREE.Raycaster(camPos, to);
  const hits = ray.intersectObjects(buildings, false);
  const occluded = hits.length > 0 && hits[0]!.distance < dist - OCCLUDE_PAD;
  return { ndcX: ndc.x, ndcY: ndc.y, inFrame: true, occluded };
}

function samplesOf(corners: readonly Vec3[], center: Vec3): Vec3[] {
  return [center, ...corners.filter((_, index) => index % 2 === 0)];
}

function objectSeen(
  pose: DronePose,
  camera: THREE.PerspectiveCamera,
  buildings: THREE.Mesh[],
  corners: readonly Vec3[],
  center: Vec3,
  mode: SeeMode,
): boolean {
  const limit = mode === "legacy" ? VIEW_NDC : LOOP_NDC;
  const points = mode === "legacy" ? [center] : samplesOf(corners, center);
  return points.some((point) => {
    const hit = viewPoint(pose, point, limit, buildings);
    return hit.inFrame && !hit.occluded;
  }) && projectBox(camera, corners, CORPUS_WIDTH, CORPUS_HEIGHT) !== null;
}

export function recordLabels(trial: Trial, mode: SeeMode): CorpusFrame[] {
  const cars = makeCars(trial.cars);
  const sim = new TrafficSim(trial.seed);
  sim.loadFleet(cars, { seed: trial.seed, blocks: blocksAt(trial.debris, 0), links: LOOP_LINKS });
  const buildings = buildingMeshes();
  const camera = makeDrone(trial.pose);
  const frames: CorpusFrame[] = [];
  const stepsPer = Math.max(1, Math.round(1 / LOOP_THRESHOLDS.hz / SIM_STEP));
  const frameCount = Math.round(trial.recordS * LOOP_THRESHOLDS.hz);
  for (let index = 0; index < frameCount; index++) {
    const t = index / LOOP_THRESHOLDS.hz;
    sim.blocks = blocksAt(trial.debris, t);
    const objects = [];
    for (const car of sim.cars) {
      if (car.parked) continue;
      const corners = carCorners(car);
      const center = { x: car.x, y: 0.7, z: car.z };
      if (!objectSeen(trial.pose, camera, buildings, corners, center, mode)) continue;
      const rec = vehicleRecord(car, corners, camera, CORPUS_WIDTH, CORPUS_HEIGHT);
      if (rec) objects.push(rec);
    }
    for (const def of debrisPieces(trial.debris, t)) {
      const corners = debrisCorners(def);
      const center = { x: def.x, y: 0.55, z: def.z };
      if (!objectSeen(trial.pose, camera, buildings, corners, center, mode)) continue;
      const rec = debrisRecord(def, corners, camera, CORPUS_WIDTH, CORPUS_HEIGHT);
      if (rec) objects.push(rec);
    }
    frames.push(
      makeFrame({
        index,
        t,
        hz: LOOP_THRESHOLDS.hz,
        camera: cameraRecord(camera, CORPUS_WIDTH, CORPUS_HEIGHT),
        objects,
      }),
    );
    sim.advance(stepsPer);
  }
  return frames;
}

export function labelsJsonl(trial: Trial, mode: SeeMode): string {
  return framesToJsonl(recordLabels(trial, mode));
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

function simCorridor(route: readonly string[]): string {
  if (route.includes("wabash-nb-0")) return "wabash-nb";
  if (route.includes("rush-nb-0")) return "rush-nb";
  const last = route[route.length - 1];
  if (last && (NB_LANES as readonly string[]).includes(last) && route.length > 1) return last;
  return route[0] ?? "other";
}

function applyPlan(sim: TrafficSim, origins: readonly CarInit[], plan: Plan) {
  const byDriver = new Map(plan.alerts.map((alert) => [alert.driver_id, alert]));
  for (const origin of origins) {
    if (origin.role !== "nb") continue;
    const live = sim.cars.find((car) => car.id === origin.id);
    if (!live) continue;
    const alert = byDriver.get(`veh-${origin.id}`);
    if (!alert) {
      if (live.laneId === origin.laneId) {
        sim.setRoute(origin.id, null);
        live.routed = false;
      }
      continue;
    }
    const corridor = corridorOf(alert.route);
    if (live.route && simCorridor(live.route) === corridor) continue;
    const route = simRouteFor(live.laneId, corridor);
    if (!sim.setRoute(origin.id, route)) continue;
    live.color = corridor === "wabash-nb" ? WABASH_COLOR : RUSH_COLOR;
  }
}

export type Replay = {
  visits: Map<number, string[]>;
  travel: Map<number, number | null>;
  endLane: Map<number, string>;
  endRoute: Map<number, string[] | null>;
};

export function replay(trial: Trial, plans: readonly Plan[], arm: "reroute" | "stay"): Replay {
  const cars = makeCars(trial.cars);
  const sim = new TrafficSim(trial.seed);
  sim.loadFleet(cars, {
    seed: trial.seed,
    blocks: blocksAt(trial.debris, 0),
    links: LOOP_LINKS,
  });
  const visits = new Map<number, Set<string>>();
  const timing = new Map<number, { start: number | null; finish: number | null }>();
  for (const car of trial.cars) {
    if (car.role === "nb") timing.set(car.id, { start: null, finish: null });
  }
  let prev = new Map(sim.cars.map((car) => [car.id, { laneId: car.laneId, s: car.s }]));
  const ordered = [...plans].sort((a, b) => a.t - b.t);
  let planIndex = 0;
  const steps = Math.round(LOOP_THRESHOLDS.horizonS / SIM_STEP);
  for (let step = 0; step < steps; step++) {
    if (arm === "reroute") {
      while (planIndex < ordered.length && ordered[planIndex]!.t <= sim.time + 1e-9) {
        applyPlan(sim, trial.cars, ordered[planIndex]!);
        planIndex += 1;
      }
    }
    sim.blocks = blocksAt(trial.debris, sim.time);
    sim.advance(1);
    for (const car of sim.cars) {
      const seen = visits.get(car.id) ?? new Set<string>();
      seen.add(car.laneId);
      visits.set(car.id, seen);
      const clock = timing.get(car.id);
      const was = prev.get(car.id);
      if (!clock || !was) continue;
      if (clock.start === null && crossed(was, car, START_S)) clock.start = sim.time;
      if (clock.start !== null && clock.finish === null && crossed(was, car, FINISH_S)) {
        clock.finish = sim.time;
      }
    }
    prev = new Map(sim.cars.map((car) => [car.id, { laneId: car.laneId, s: car.s }]));
  }
  const travel = new Map<number, number | null>();
  for (const [id, clock] of timing) {
    travel.set(id, clock.start !== null && clock.finish !== null ? clock.finish - clock.start : null);
  }
  const endLane = new Map(sim.cars.map((car) => [car.id, car.laneId]));
  const endRoute = new Map(sim.cars.map((car) => [car.id, car.route ? [...car.route] : null]));
  return {
    visits: new Map([...visits].map(([id, lanes]) => [id, [...lanes]])),
    travel,
    endLane,
    endRoute,
  };
}

export type Score = {
  pass: boolean;
  failed: string[];
  detectS: Record<string, number | null>;
  falseBlocked: string[];
  affected: number;
  alerted: number;
  followed: number;
  followRate: number;
  sbAlerts: string[];
  split: Record<string, number>;
  herdShare: number | null;
  travelRerouteS: number | null;
  travelBaseS: number | null;
  reopened: boolean;
};

function censored(travel: Map<number, number | null>, ids: readonly number[], horizon: number): number | null {
  if (ids.length === 0) return null;
  let sum = 0;
  for (const id of ids) {
    const value = travel.get(id);
    sum += value === null || value === undefined ? horizon : value;
  }
  return sum / ids.length;
}

function firstBlocked(plans: readonly Plan[], laneId: string, t0: number): number | null {
  for (const plan of [...plans].sort((a, b) => a.t - b.t)) {
    if (plan.t + 1e-9 >= t0 && plan.blocked.includes(laneId)) return plan.t;
  }
  return null;
}

function falseBlockedLanes(trial: Trial, plans: readonly Plan[]): string[] {
  const found = new Set<string>();
  const ordered = [...plans].sort((a, b) => a.t - b.t);
  for (let i = 0; i < ordered.length; i++) {
    const plan = ordered[i]!;
    const until = ordered[i + 1]?.t ?? trial.recordS;
    for (const laneId of plan.blocked) {
      const covered = trial.debris.some((item) => {
        if (item.laneId !== laneId) return false;
        const end = item.t1 === null ? Infinity : item.t1 + LOOP_THRESHOLDS.clearGraceS;
        return plan.t <= end && until >= item.t0 - 1e-9;
      });
      if (!covered) found.add(laneId);
    }
  }
  return [...found].sort();
}

export function scoreTrial(trial: Trial, plans: readonly Plan[], reroute: Replay, stay: Replay): Score {
  const detectS: Record<string, number | null> = {};
  const failed = new Set<string>();
  for (const item of trial.debris) {
    const seen = firstBlocked(plans, item.laneId, item.t0);
    detectS[item.laneId] = seen === null ? null : seen - item.t0;
    if (seen === null || seen - item.t0 > LOOP_THRESHOLDS.detectWithinS) failed.add("detect");
  }

  const falseBlocked = falseBlockedLanes(trial, plans);
  if (falseBlocked.length > 0) failed.add("false-block");

  const last = [...plans].sort((a, b) => a.t - b.t).at(-1);
  const reopened =
    trial.kind !== "clear" ||
    (last !== undefined && last.blocked.length === 0 && last.alerts.length === 0);
  if (trial.kind === "clear" && !reopened) failed.add("reopen");

  const affected = trial.cars.filter(
    (car) => car.role === "nb" && trial.debris.some((item) => item.laneId === car.laneId),
  );
  const alertFor = new Map<number, HubAlert>();
  for (const plan of plans) {
    for (const alert of plan.alerts) {
      const id = Number(alert.driver_id.replace("veh-", ""));
      if (!alertFor.has(id)) alertFor.set(id, alert);
    }
  }
  let followed = 0;
  let alerted = 0;
  for (const car of affected) {
    const alert = alertFor.get(car.id);
    if (!alert) continue;
    alerted += 1;
    const scene = sceneLane(corridorOf(alert.route));
    const lanes = reroute.visits.get(car.id) ?? [];
    if (scene && lanes.includes(scene)) followed += 1;
  }
  const followRate = affected.length === 0 ? 1 : followed / affected.length;
  if (trial.kind === "clear") {
    const stillForced = affected.filter((car) => {
      const route = reroute.endRoute.get(car.id);
      const lane = reroute.endLane.get(car.id);
      const visited = reroute.visits.get(car.id) ?? [];
      const leftOrigin = visited.some((id) => id !== car.laneId);
      return lane === car.laneId && !!route && route.length > 1 && !leftOrigin;
    });
    if (alerted < affected.length || stillForced.length > 0) failed.add("follow");
  } else if (followRate + 1e-12 < LOOP_THRESHOLDS.followRate) {
    failed.add("follow");
  }

  const sbIds = new Set(trial.cars.filter((car) => car.role === "sb").map((car) => `veh-${car.id}`));
  const sbAlerts = plans.flatMap((plan) => plan.alerts.map((alert) => alert.driver_id)).filter((id) => sbIds.has(id));
  const sbDrift = trial.cars.filter((car) => {
    if (car.role !== "sb") return false;
    const lanes = reroute.visits.get(car.id) ?? [];
    return lanes.includes("rush-nb-0") || lanes.includes("wabash-nb-0");
  });
  if (sbAlerts.length > 0 || sbDrift.length > 0) failed.add("southbound");

  const main = plans.reduce<Plan | null>((best, plan) => {
    if (!best || plan.alerts.length > best.alerts.length) return plan;
    return best;
  }, null);
  const split: Record<string, number> = {};
  for (const alert of main?.alerts ?? []) {
    const name = corridorOf(alert.route);
    split[name] = (split[name] ?? 0) + 1;
  }
  const herdN = main?.alerts.length ?? 0;
  const herdMax = herdN === 0 ? 0 : Math.max(...Object.values(split));
  const herdShare = herdN === 0 ? null : herdMax / herdN;
  if (herdN > LOOP_THRESHOLDS.herdMinCars && herdShare !== null && herdShare > LOOP_THRESHOLDS.herdMaxShare) {
    failed.add("herd");
  }

  const ids = affected.map((car) => car.id);
  const travelRerouteS = censored(reroute.travel, ids, LOOP_THRESHOLDS.horizonS);
  const travelBaseS = censored(stay.travel, ids, LOOP_THRESHOLDS.horizonS);
  if (trial.kind !== "clear" && ids.length > 0) {
    if (travelRerouteS === null || travelBaseS === null || !(travelRerouteS < travelBaseS)) {
      failed.add("travel");
    }
  }
  if (trial.kind === "clear" && ids.length > 0 && travelRerouteS !== null && travelBaseS !== null) {
    if (travelRerouteS > travelBaseS + 1) failed.add("travel");
  }

  return {
    pass: failed.size === 0,
    failed: [...failed],
    detectS,
    falseBlocked,
    affected: affected.length,
    alerted,
    followed,
    followRate,
    sbAlerts: [...new Set(sbAlerts)],
    split,
    herdShare,
    travelRerouteS,
    travelBaseS,
    reopened,
  };
}

function cohort(
  laneIds: readonly string[],
  n: number,
  role: CarRole,
  id0: number,
  v: number,
  v0: number,
  s0 = 8,
): CarInit[] {
  const cars: CarInit[] = [];
  for (let i = 0; i < n; i++) {
    cars.push({
      id: id0 + i,
      laneId: laneIds[i % laneIds.length]!,
      s: s0 + i * 5.2,
      v,
      v0,
      role,
    });
  }
  return cars;
}

const SB: CarInit[] = [
  { id: 101, laneId: "mich-sb-0", s: 28, v: 8, v0: 10, role: "sb" },
  { id: 102, laneId: "mich-sb-1", s: 44, v: 7.4, v0: 10, role: "sb" },
];

function windowOn(lanes: readonly string[], t0 = 0, t1: number | null = null, s0 = BLOCK_S0, s1 = BLOCK_S1): DebrisWindow[] {
  return lanes.map((laneId) => ({ laneId, s0, s1, t0, t1 }));
}

function sideTraffic(): CarInit[] {
  const cars: CarInit[] = [];
  for (let i = 0; i < 3; i++) {
    cars.push({
      id: 400 + i,
      laneId: "rush-nb-0",
      s: 16 + i * 8,
      v: 3,
      v0: 3.2,
      role: "side",
      route: ["rush-nb-0", "conn-wb-0", "mich-nb-2"],
    });
    cars.push({
      id: 410 + i,
      laneId: "wabash-nb-0",
      s: 16 + i * 8,
      v: 3,
      v0: 3.2,
      role: "side",
      route: ["wabash-nb-0", "conn-eb-0", "mich-nb-0"],
    });
  }
  return cars;
}

const POSE_NADIR: DronePose = { x: 5.5, y: 34, z: -22, yaw: 0, pitch: -1.28, roll: 0 };
const POSE_EDGE: DronePose = { x: 24, y: 48, z: -10, yaw: -3, pitch: -1.25, roll: 0 };
const POSE_OCCLUDED: DronePose = { x: 32, y: 30, z: -16, yaw: -0.1, pitch: -0.9, roll: 0 };
const POSE_HIGH: DronePose = { x: 6, y: 82, z: -24, yaw: 0, pitch: -1.42, roll: 0 };
const POSE_UP: DronePose = { x: 6, y: 14, z: -8, yaw: 0, pitch: 0.42, roll: 0 };

const ALL_NB = ["mich-nb-0", "mich-nb-1", "mich-nb-2"] as const;

export const LOOP_TRIALS: Trial[] = [
  {
    id: "nominal-all-lanes",
    seed: 7,
    stress: "Debris blocks every northbound Michigan lane in daylight.",
    kind: "closure",
    light: "day",
    pose: POSE_NADIR,
    debris: windowOn(ALL_NB),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 7.6, 9.4), ...SB],
    recordS: 6,
    legacyFault: "None expected when nothing is stopped off the closure.",
    fix: "Loop policy is the one that distinguishes debris from traffic.",
  },
  {
    id: "single-lane",
    seed: 11,
    stress: "Only mich-nb-1 is closed. Eight cars share that lane.",
    kind: "closure",
    light: "day",
    pose: POSE_NADIR,
    debris: windowOn(["mich-nb-1"]),
    cars: [...cohort(["mich-nb-1"], 8, "nb", 1, 7.6, 9.4), ...SB],
    recordS: 6,
    legacyFault: "Open lanes stay clear. Anti-herding must still split the eight.",
    fix: "Adjacent Michigan lanes are real detours. Herd cost pushes the second batch off them.",
  },
  {
    id: "frame-edge",
    seed: 13,
    stress: "Barriers sit near the image edge, inside the frame and outside the 0.92 lock margin.",
    kind: "closure",
    light: "day",
    pose: POSE_EDGE,
    debris: windowOn(ALL_NB),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 7.6, 9.4), ...SB],
    recordS: 6,
    legacyFault: "The pursuit lock drops a point once NDC passes 0.92, so an in-frame barrier never becomes a label.",
    fix: "The loop recorder keeps an object when any sample lies inside the full frame.",
  },
  {
    id: "partial-occlusion",
    seed: 17,
    stress: "A building hides the barrier center. A corner still has a clear ray.",
    kind: "closure",
    light: "day",
    pose: POSE_OCCLUDED,
    debris: windowOn(["mich-nb-2"], 0, null, 100, 112),
    cars: [...cohort(["mich-nb-2"], 8, "nb", 1, 7.6, 9.4), ...SB],
    recordS: 6,
    legacyFault: "Visibility is a single center sample. Occluding that sample drops the whole barrier.",
    fix: "The loop labels a barrier when any corner sample is in frame and not occluded.",
  },
  {
    id: "mid-run",
    seed: 19,
    stress: "Lanes are empty, then debris appears at t = 3 s.",
    kind: "closure",
    light: "day",
    pose: POSE_NADIR,
    debris: windowOn(ALL_NB, 3, null),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 7.2, 9), ...SB],
    recordS: 9,
    legacyFault: "Detection has to start at placement, not at t = 0.",
    fix: "The dwell clock starts when the unknown track appears. The 1.5 s hold fits inside 5 s.",
  },
  {
    id: "stalled-vs-debris",
    seed: 23,
    stress: "Debris closes mich-nb-0. A car sits still on open mich-nb-2, in the same view.",
    kind: "closure",
    light: "day",
    pose: POSE_NADIR,
    debris: windowOn(["mich-nb-0"]),
    cars: [
      ...cohort(["mich-nb-0"], 8, "nb", 1, 7.6, 9.4),
      { id: 301, laneId: "mich-nb-2", s: 102, v: 0, v0: 0, role: "stall" },
      ...SB,
    ],
    recordS: 6,
    legacyFault: "A stationary vehicle finishes the same dwell as debris and the lane is published blocked.",
    fix: "The loop closes a lane only for class unknown. A stall stays slow.",
  },
  {
    id: "dense-queue",
    seed: 29,
    stress: "mich-nb-1 is debris. mich-nb-0 is a stopped queue with no debris.",
    kind: "closure",
    light: "day",
    pose: POSE_NADIR,
    debris: windowOn(["mich-nb-1"]),
    cars: [
      ...cohort(["mich-nb-1"], 8, "nb", 1, 7.6, 9.4),
      ...[96, 101, 106, 111].map((s, index) => ({
        id: 220 + index,
        laneId: "mich-nb-0",
        s,
        v: 0,
        v0: 0,
        role: "queue" as const,
      })),
      ...SB,
    ],
    recordS: 6,
    legacyFault: "Stopped queue traffic is classified blocked, so an open lane is closed.",
    fix: "Stopped vehicles pull the mean into slow. Only an unknown dwell publishes blocked.",
  },
  {
    id: "night",
    seed: 31,
    stress: "Same closure as the nominal run, tagged night. The edge has no exposure term.",
    kind: "closure",
    light: "night",
    pose: POSE_NADIR,
    debris: windowOn(ALL_NB),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 7.6, 9.4), ...SB],
    recordS: 6,
    legacyFault: "Night does not change ray confidence. This case is not a photometric failure.",
    fix: "No change. Confidence is the ray's depression, which daylight and night share.",
  },
  {
    id: "extreme-altitude",
    seed: 37,
    stress: "Nadir from 82 m. The barrier is small in the frame and the ray is steep.",
    kind: "closure",
    light: "day",
    pose: POSE_HIGH,
    debris: windowOn(ALL_NB),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 7.6, 9.4), ...SB],
    recordS: 6,
    legacyFault: "A steep high view should still name the lane. A miss would be a box under one pixel.",
    fix: "The barrier still covers more than a pixel at 82 m, and the ray stays confident.",
  },
  {
    id: "horizon-tilt",
    seed: 41,
    stress: "Camera pitched above the horizon. Ground rays through the barriers do not descend.",
    kind: "closure",
    light: "day",
    pose: POSE_UP,
    debris: windowOn(ALL_NB),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 7.6, 9.4), ...SB],
    recordS: 6,
    legacyFault: "A ray that does not meet the ground produces no track, so the closure is missed.",
    fix: "Not fixable in this contract. Monocular range needs a descending ray. Looking up cannot close a lane.",
  },
  {
    id: "detours-congested",
    seed: 43,
    stress: "Both side streets already carry a slow platoon that is still moving. Michigan is fully closed.",
    kind: "closure",
    light: "day",
    pose: POSE_NADIR,
    debris: windowOn(ALL_NB),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 7.6, 9.4), ...sideTraffic(), ...SB],
    recordS: 6,
    legacyFault: "A platoon that stops at the end of a finite side street seals the connector. The hub still sends cars there because CAM0 never sees Rush or Wabash.",
    fix: "Slow cars keep a route off the street, so the queue discharges. Travel stays under the horizon and beats the barricade. A stopped plug with no third route is not fixable from this camera.",
  },
  {
    id: "debris-cleared",
    seed: 47,
    stress: "Debris is pulled at t = 6 s, before the platoon reaches the exit. The lane must leave blocked and the detour orders must be dropped.",
    kind: "clear",
    light: "day",
    pose: POSE_NADIR,
    debris: windowOn(ALL_NB, 0, 6),
    cars: [...cohort(ALL_NB, 8, "nb", 1, 4.2, 4.4, 4), ...SB],
    recordS: 10,
    legacyFault: "Cars stopped behind the debris keep the lane blocked after the barriers are gone.",
    fix: "Without an unknown dwell the lane goes slow, then stale-unknown. The next plan has no alerts, and cars still on Michigan drop the route.",
  },
  {
    id: "control-moving",
    seed: 3,
    stress: "No debris. Northbound and southbound traffic is moving.",
    kind: "control",
    light: "day",
    pose: POSE_NADIR,
    debris: [],
    cars: [...cohort(ALL_NB, 8, "nb", 1, 8, 10), ...SB],
    recordS: 6,
    legacyFault: "Moving traffic should not close a lane.",
    fix: "No debris, no blocked state, no alerts.",
  },
  {
    id: "control-queue",
    seed: 5,
    stress: "No debris. A stopped queue sits in view on mich-nb-1.",
    kind: "control",
    light: "day",
    pose: POSE_NADIR,
    debris: [],
    cars: [
      ...cohort(["mich-nb-0", "mich-nb-2"], 4, "nb", 1, 8, 10),
      ...[96, 101, 106, 111].map((s, index) => ({
        id: 230 + index,
        laneId: "mich-nb-1",
        s,
        v: 0,
        v0: 0,
        role: "queue" as const,
      })),
      ...SB,
    ],
    recordS: 6,
    legacyFault: "The stopped queue is published as blocked even though nothing is in the lane but cars.",
    fix: "Unknown-only closures. The queue is slow. Nobody is rerouted.",
  },
];

export function trialById(id: string): Trial {
  const trial = LOOP_TRIALS.find((item) => item.id === id);
  if (!trial) throw new Error(`unknown trial ${id}`);
  return trial;
}

export type TrialReport = Score & {
  id: string;
  policy: SeeMode;
  stress: string;
  light: string;
  kind: TrialKind;
  legacyFault: string;
  fix: string;
};

export function reportTrial(trial: Trial, policy: SeeMode, plans: readonly Plan[]): TrialReport {
  const reroute = replay(trial, plans, "reroute");
  const stay = replay(trial, plans, "stay");
  return {
    id: trial.id,
    policy,
    stress: trial.stress,
    light: trial.light,
    kind: trial.kind,
    legacyFault: trial.legacyFault,
    fix: trial.fix,
    ...scoreTrial(trial, plans, reroute, stay),
  };
}

function fmt(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function renderBatch(reports: readonly TrialReport[]): string {
  const lines: string[] = [];
  lines.push("# Closed-loop batch");
  lines.push("");
  lines.push(
    `Thresholds: detect ≤ ${LOOP_THRESHOLDS.detectWithinS}s, follow ≥ ${LOOP_THRESHOLDS.followRate}, herd share ≤ ${LOOP_THRESHOLDS.herdMaxShare} when more than ${LOOP_THRESHOLDS.herdMinCars} cars, horizon ${LOOP_THRESHOLDS.horizonS}s.`,
  );
  lines.push("");
  lines.push(
    "| Trial | Policy | Pass | Failed | Detect s | False blocked | Follow | Split | Travel reroute | Travel base |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of reports) {
    const detect = Object.entries(row.detectS)
      .map(([lane, value]) => `${lane} ${fmt(value)}`)
      .join(", ");
    const split = Object.entries(row.split)
      .map(([name, count]) => `${name}=${count}`)
      .join(" ");
    lines.push(
      `| ${row.id} | ${row.policy} | ${row.pass ? "pass" : "fail"} | ${row.failed.join(", ") || "—"} | ${detect || "—"} | ${row.falseBlocked.join(", ") || "—"} | ${row.followed}/${row.affected} | ${split || "—"} | ${fmt(row.travelRerouteS)} | ${fmt(row.travelBaseS)} |`,
    );
  }
  const final = reports.filter((row) => row.policy === "loop");
  const failed = final.filter((row) => !row.pass).length;
  lines.push("");
  lines.push(
    `Loop failure rate: ${failed}/${final.length} (${final.length === 0 ? "—" : ((failed / final.length) * 100).toFixed(1)}%).`,
  );
  lines.push("");
  lines.push("## Failures found");
  lines.push("");
  lines.push("| Trial | Legacy | Loop | Root cause | Fix |");
  lines.push("| --- | --- | --- | --- | --- |");
  const ids = [...new Set(reports.map((row) => row.id))];
  for (const id of ids) {
    const before = reports.find((row) => row.id === id && row.policy === "legacy");
    const after = reports.find((row) => row.id === id && row.policy === "loop");
    if (!before || !after) continue;
    if (before.pass && after.pass) continue;
    lines.push(
      `| ${id} | ${before.pass ? "pass" : `fail (${before.failed.join(", ")})`} | ${after.pass ? "pass" : `fail (${after.failed.join(", ")})`} | ${before.legacyFault} | ${after.fix} |`,
    );
  }
  return lines.join("\n");
}

/** Cars already on Rush and Wabash, for the daytime screenshot. */
export function showcaseScene(): {
  cars: SimCar[];
  blocks: LaneBlock[];
  links: RouteLink[];
  debris: DebrisDef[];
  atS: number;
} {
  const cars = [
    ...[3, 8, 13, 18].map((s, index) =>
      createSimCar({
        id: index + 1,
        laneId: "rush-nb-0",
        s,
        v: 5.4,
        v0: 6.5,
        route: ["rush-nb-0", "conn-wb-0", "mich-nb-2"],
        routed: true,
        color: RUSH_COLOR,
      }),
    ),
    ...[3, 8, 13, 18].map((s, index) =>
      createSimCar({
        id: index + 5,
        laneId: "wabash-nb-0",
        s,
        v: 5.2,
        v0: 6.5,
        route: ["wabash-nb-0", "conn-eb-0", "mich-nb-0"],
        routed: true,
        color: WABASH_COLOR,
      }),
    ),
  ];
  cars.push(
    createSimCar({ id: 101, laneId: "mich-sb-0", s: 36, v: 8, v0: 10, color: SB_COLOR }),
    createSimCar({ id: 102, laneId: "mich-sb-1", s: 52, v: 7, v0: 10, color: SB_COLOR }),
  );
  return {
    cars,
    blocks: windowOn(ALL_NB).map((item) => ({ laneId: item.laneId, s0: item.s0, s1: item.s1 })),
    links: LOOP_LINKS,
    debris: blockedLaneDebris([...ALL_NB]),
    atS: 2,
  };
}

export function showcaseOnDetour(): { rush: number; wabash: number; sbOff: boolean } {
  const scene = showcaseScene();
  const sim = new TrafficSim(1);
  sim.loadFleet(scene.cars, { seed: 1, blocks: scene.blocks, links: scene.links });
  sim.advance(Math.round(scene.atS / SIM_STEP));
  const sb = sim.cars.filter((car) => car.id >= 100);
  return {
    rush: sim.cars.filter((car) => car.laneId === "rush-nb-0").length,
    wabash: sim.cars.filter((car) => car.laneId === "wabash-nb-0").length,
    sbOff: sb.every((car) => car.laneId.startsWith("mich-sb")),
  };
}
