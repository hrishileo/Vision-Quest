import {
  BUILDINGS,
  CAR_L,
  LANE_BY_ID,
  LANES,
  MAG_MILE,
  PARK_X,
  PARK_Z,
  SPAN,
  buildingAabb,
  carHitsBuilding,
  inIntersection,
  lanePose,
  overlapsRoad,
  wrapS,
  type LaneDef,
} from "./city";

const A_MAX = 1.45;
const B_COM = 2.15;
const HEADWAY = 1.35;
const S0 = 2.3;
const DELTA = 4;
const STEP = 1 / 30;
const CYCLE = 64;
const CAR_LEN_PAD = CAR_L;

const PALETTE = [
  0xc5c8ce, 0x3a3e44, 0x5c6460, 0xb8bcc2, 0x2c3238, 0x6a5040, 0x4a5560, 0x8a7a68, 0x3e4840,
  0xd0ccc4, 0x5a4038, 0x4c5850,
];

export type LosGrade = "A" | "B" | "C" | "D" | "E" | "F";
export type Congestion = "free" | "moderate" | "heavy";
export type SignalLit = "g" | "y" | "r";

export type TrafficSnapshot = {
  loc: string;
  city: string;
  lat: number;
  lon: number;
  los: LosGrade;
  congestion: Congestion;
  detected: number;
  moving: number;
  stopped: number;
  meanKmh: number;
  queueM: number;
  targetMotion: "stationary" | "moving";
  targetSpeed: number;
  signal: "NS" | "EW" | "all-red";
  subjectId: number;
};

export type SimCar = {
  id: number;
  laneId: string;
  s: number;
  v: number;
  v0: number;
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  parked: boolean;
  color: number;
  length: number;
  subject: boolean;
  stallUntil: number;
  nextStall: number;
};

export type TrafficDiag = {
  n: number;
  moving: number;
  parked: number;
  minGap: number;
  overlap: boolean;
  buildingHit: boolean;
  offLane: boolean;
  roadBuildings: number;
  loc: string;
  subjectV: number;
  time: number;
};

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

function idmAcc(v: number, v0: number, gap: number, dv: number): number {
  const sStar = S0 + Math.max(0, v * HEADWAY + (v * dv) / (2 * Math.sqrt(A_MAX * B_COM)));
  const g = Math.max(0.35, gap);
  const vRatio = v / Math.max(0.6, v0);
  return A_MAX * (1 - vRatio ** DELTA - (sStar / g) ** 2);
}

function bumpS(s: number, ds: number, length: number): number {
  return wrapS(s + ds, length);
}

function poseCar(car: SimCar) {
  const lane = LANE_BY_ID[car.laneId];
  if (!lane) return;
  const p = lanePose(lane, car.s);
  car.x = p.x;
  car.z = p.z;
  car.yaw = p.yaw;
  const v = car.parked ? 0 : car.v;
  if (lane.axis === "z") {
    car.vx = 0;
    car.vz = lane.sign * v;
  } else {
    car.vx = lane.sign * v;
    car.vz = 0;
  }
}

function clearOfIntersection(lane: LaneDef, s: number): number {
  let t = wrapS(s, lane.length);
  for (let i = 0; i < 48; i++) {
    const p = lanePose(lane, t);
    if (!inIntersection(p.x, p.z)) return t;
    t = wrapS(t + 3.2, lane.length);
  }
  return t;
}

function losFromKmh(kmh: number): { los: LosGrade; congestion: Congestion } {
  let los: LosGrade;
  if (kmh >= 42) los = "A";
  else if (kmh >= 34) los = "B";
  else if (kmh >= 26) los = "C";
  else if (kmh >= 18) los = "D";
  else if (kmh >= 10) los = "E";
  else los = "F";
  const congestion: Congestion =
    los === "A" || los === "B" ? "free" : los === "F" ? "heavy" : "moderate";
  return { los, congestion };
}

export class TrafficSim {
  cars: SimCar[] = [];
  time = 0;
  subjectId = 0;
  nsLit: SignalLit = "g";
  ewLit: SignalLit = "r";
  signal: TrafficSnapshot["signal"] = "NS";
  private acc = 0;
  private rng: () => number = mulberry32(1);

  constructor(seed = 1) {
    this.reset(seed);
  }

  reset(seed = Date.now()) {
    this.rng = mulberry32(seed >>> 0);
    this.time = 0;
    this.acc = 0;
    this.cars = [];
    this.syncSignals();
    this.spawn();
  }

  step(dt: number) {
    if (dt <= 0) return;
    this.acc += Math.min(dt, 0.12);
    let guard = 0;
    while (this.acc >= STEP && guard++ < 8) {
      this.integrate(STEP);
      this.acc -= STEP;
    }
  }

  assess(detectedIds: number[], targetId: number): TrafficSnapshot {
    const seen = detectedIds.length
      ? this.cars.filter((c) => detectedIds.includes(c.id) && !c.parked)
      : this.cars.filter((c) => !c.parked);
    const speeds = seen.map((c) => c.v);
    const mean = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const meanKmh = mean * 3.6;
    const moving = seen.filter((c) => c.v > 0.7).length;
    const stopped = seen.length - moving;
    const { los, congestion } = losFromKmh(meanKmh);
    const target = this.cars[targetId] ?? this.cars[this.subjectId]!;
    const queueM = this.queueLength();
    return {
      loc: MAG_MILE.loc,
      city: MAG_MILE.city,
      lat: MAG_MILE.lat,
      lon: MAG_MILE.lon,
      los,
      congestion,
      detected: seen.length,
      moving,
      stopped,
      meanKmh,
      queueM,
      targetMotion: target.v < 0.55 ? "stationary" : "moving",
      targetSpeed: target.v,
      signal: this.signal,
      subjectId: this.subjectId,
    };
  }

  diagnostics(): TrafficDiag {
    const moving = this.cars.filter((c) => !c.parked);
    const parked = this.cars.length - moving.length;
    let minGap = 1e9;
    let overlap = false;
    let buildingHit = false;
    let offLane = false;
    const byLane = new Map<string, SimCar[]>();
    for (const c of moving) {
      const arr = byLane.get(c.laneId) ?? [];
      arr.push(c);
      byLane.set(c.laneId, arr);
      const lane = LANE_BY_ID[c.laneId];
      if (!lane) {
        offLane = true;
        continue;
      }
      const p = lanePose(lane, c.s);
      if (Math.hypot(p.x - c.x, p.z - c.z) > 0.35) offLane = true;
      if (lane.axis === "z" && Math.abs(c.x - lane.offset) > 0.2) offLane = true;
      if (lane.axis === "x" && Math.abs(c.z - lane.offset) > 0.2) offLane = true;
      if (carHitsBuilding(c.x, c.z, c.yaw)) buildingHit = true;
    }
    for (const [, list] of byLane) {
      list.sort((a, b) => a.s - b.s);
      const lane = LANE_BY_ID[list[0]!.laneId]!;
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        const b = list[(i + 1) % list.length]!;
        let ds = b.s - a.s;
        if (ds <= 0.05) ds += lane.length;
        const gap = ds - (a.length + b.length) * 0.5;
        minGap = Math.min(minGap, gap);
        if (gap < 0.15) overlap = true;
      }
    }
    for (const c of this.cars) {
      if (c.parked && carHitsBuilding(c.x, c.z, c.yaw)) buildingHit = true;
    }
    const roadBuildings = BUILDINGS.filter(overlapsRoad).length;
    return {
      n: this.cars.length,
      moving: moving.length,
      parked,
      minGap: minGap === 1e9 ? 99 : minGap,
      overlap,
      buildingHit,
      offLane,
      roadBuildings,
      loc: MAG_MILE.loc,
      subjectV: this.cars[this.subjectId]?.v ?? 0,
      time: this.time,
    };
  }

  private syncSignals() {
    const t = this.time % CYCLE;
    if (t < 28) {
      this.nsLit = "g";
      this.ewLit = "r";
      this.signal = "NS";
    } else if (t < 32) {
      this.nsLit = "y";
      this.ewLit = "r";
      this.signal = "NS";
    } else if (t < 34) {
      this.nsLit = "r";
      this.ewLit = "r";
      this.signal = "all-red";
    } else if (t < 58) {
      this.nsLit = "r";
      this.ewLit = "g";
      this.signal = "EW";
    } else if (t < 62) {
      this.nsLit = "r";
      this.ewLit = "y";
      this.signal = "EW";
    } else {
      this.nsLit = "r";
      this.ewLit = "r";
      this.signal = "all-red";
    }
  }

  private litFor(approach: LaneDef["approach"]): SignalLit {
    return approach === "NS" ? this.nsLit : this.ewLit;
  }

  private integrate(dt: number) {
    this.time += dt;
    this.syncSignals();
    const groups = new Map<string, SimCar[]>();
    for (const c of this.cars) {
      if (c.parked) continue;
      const list = groups.get(c.laneId) ?? [];
      list.push(c);
      groups.set(c.laneId, list);
    }
    for (const [laneId, list] of groups) {
      const lane = LANE_BY_ID[laneId];
      if (!lane) continue;
      list.sort((a, b) => a.s - b.s);
      for (let i = 0; i < list.length; i++) {
        const car = list[i]!;
        const leader = list[(i + 1) % list.length]!;
        this.follow(car, leader, lane, dt);
      }
    }
    for (const c of this.cars) poseCar(c);
  }

  private follow(car: SimCar, leader: SimCar, lane: LaneDef, dt: number) {
    const stalled = car.subject && this.time < car.stallUntil;
    let v0 = stalled ? 0.02 : car.v0;
    if (car.subject && !stalled && this.time >= car.nextStall) {
      const p = lanePose(lane, car.s);
      const midBlock = !inIntersection(p.x, p.z) && Math.abs(p.z) > 22 && Math.abs(p.z) < 52;
      if (midBlock && car.v > 2) {
        car.stallUntil = this.time + 5.2;
        car.nextStall = this.time + 28;
        v0 = 0.02;
      } else {
        car.nextStall = this.time + 4;
      }
    }

    let ds = leader.s - car.s;
    if (ds <= 0.08) ds += lane.length;
    let gap = ds - (car.length + leader.length) * 0.5;
    let vLead = leader.v;

    const distStop = wrapS(lane.stopS - car.s, lane.length);
    const pastStop = distStop > lane.length * 0.72;
    const lit = this.litFor(lane.approach);
    if (!pastStop && distStop > 0.4) {
      const canStop = (car.v * car.v) / (2 * B_COM) < distStop + 0.8;
      const hold = lit === "r" || (lit === "y" && canStop);
      if (hold) {
        const stopGap = distStop - car.length * 0.5;
        if (stopGap < gap) {
          gap = stopGap;
          vLead = 0;
        }
      }
    }

    const dv = car.v - vLead;
    let a = idmAcc(car.v, v0, gap, dv);
    a = Math.max(-B_COM * 1.6, Math.min(A_MAX, a));
    car.v = Math.max(0, car.v + a * dt);
    if (v0 < 0.1) car.v = Math.max(0, car.v - B_COM * dt);
    let next = car.s + car.v * dt;
    let leadS = leader.s;
    if (leadS <= car.s + 0.08) leadS += lane.length;
    const maxS = leadS - (car.length + leader.length) * 0.5 - S0;
    if (next > maxS) {
      next = maxS;
      car.v = Math.min(car.v, vLead);
    }
    if (!pastStop && lit !== "g") {
      const holdLine = lane.stopS - car.length * 0.5 - 0.35;
      const toLine = wrapS(holdLine - car.s, lane.length);
      if (toLine < 18 && next > holdLine && car.s <= holdLine + 0.05) {
        next = holdLine;
        car.v = 0;
      }
    }
    car.s = wrapS(next, lane.length);
  }

  private queueLength(): number {
    let best = 0;
    const byLane = new Map<string, SimCar[]>();
    for (const c of this.cars) {
      if (c.parked) continue;
      const list = byLane.get(c.laneId) ?? [];
      list.push(c);
      byLane.set(c.laneId, list);
    }
    for (const [id, list] of byLane) {
      const lane = LANE_BY_ID[id]!;
      list.sort((a, b) => a.s - b.s);
      let run = 0;
      for (const c of list) {
        const dist = wrapS(lane.stopS - c.s, lane.length);
        if (c.v < 1.2 && dist < 55) run += c.length + S0;
        else if (run && dist >= 55) break;
      }
      best = Math.max(best, run);
    }
    return best;
  }

  private spawn() {
    const counts: Record<string, number> = {
      "mich-nb-0": 4,
      "mich-nb-1": 3,
      "mich-nb-2": 3,
      "mich-sb-0": 4,
      "mich-sb-1": 3,
      "mich-sb-2": 3,
      "chi-eb-0": 3,
      "chi-eb-1": 3,
      "chi-wb-0": 3,
      "chi-wb-1": 2,
    };

    let id = 0;
    const subjectLane = LANE_BY_ID["mich-nb-1"]!;
    const subject: SimCar = {
      id: 0,
      laneId: subjectLane.id,
      s: clearOfIntersection(subjectLane, SPAN - 28),
      v: 7.6,
      v0: 11.2,
      x: 0,
      z: 0,
      yaw: subjectLane.heading,
      vx: 0,
      vz: 0,
      parked: false,
      color: 0xb85c38,
      length: 4.7,
      subject: true,
      stallUntil: -1,
      nextStall: 16 + this.rng() * 5,
    };
    poseCar(subject);
    this.subjectId = 0;
    this.cars.push(subject);
    id = 1;

    const occupied = (laneId: string, s: number, length: number) =>
      this.cars.some((c) => {
        if (c.laneId !== laneId) return false;
        const lane = LANE_BY_ID[laneId]!;
        let ds = Math.abs(wrapS(c.s - s, lane.length));
        ds = Math.min(ds, lane.length - ds);
        return ds < length + c.length * 0.5 + S0 + 0.5;
      });

    for (const lane of LANES) {
      const n = counts[lane.id] ?? 3;
      const queued = this.litFor(lane.approach) !== "g";
      let s = queued ? lane.stopS - 1.4 : lane.stopS - 10 - this.rng() * 36;
      let placed = 0;
      let attempts = 0;
      while (placed < n && attempts++ < 80) {
        s = clearOfIntersection(lane, wrapS(s, lane.length));
        const len = 4.15 + this.rng() * 0.5;
        if (occupied(lane.id, s, len)) {
          s -= CAR_LEN_PAD + S0 + 1.8 + this.rng() * 4;
          continue;
        }
        const car: SimCar = {
          id,
          laneId: lane.id,
          s,
          v: queued ? 0 : 4 + this.rng() * 5,
          v0: 8.2 + this.rng() * 4.2,
          x: 0,
          z: 0,
          yaw: lane.heading,
          vx: 0,
          vz: 0,
          parked: false,
          color: PALETTE[(id + Math.floor(this.rng() * 5)) % PALETTE.length]!,
          length: len,
          subject: false,
          stallUntil: -1,
          nextStall: 1e9,
        };
        poseCar(car);
        this.cars.push(car);
        id += 1;
        placed += 1;
        s -= CAR_LEN_PAD + (queued ? 2.6 + this.rng() * 1.4 : 8 + this.rng() * 14);
      }
    }

    const parks: { x: number; z: number; yaw: number }[] = [
      { x: PARK_X, z: -34, yaw: Math.PI },
      { x: PARK_X, z: -48, yaw: Math.PI },
      { x: PARK_X, z: 38, yaw: 0 },
      { x: -PARK_X, z: -36, yaw: Math.PI },
      { x: -PARK_X, z: 42, yaw: 0 },
      { x: 36, z: PARK_Z, yaw: Math.PI / 2 },
      { x: -40, z: -PARK_Z, yaw: -Math.PI / 2 },
      { x: 44, z: -PARK_Z, yaw: -Math.PI / 2 },
    ];
    for (const p of parks) {
      if (carHitsBuilding(p.x, p.z, p.yaw)) continue;
      const car: SimCar = {
        id,
        laneId: "park",
        s: 0,
        v: 0,
        v0: 0,
        x: p.x,
        z: p.z,
        yaw: p.yaw,
        vx: 0,
        vz: 0,
        parked: true,
        color: PALETTE[id % PALETTE.length]!,
        length: 4.3,
        subject: false,
        stallUntil: -1,
        nextStall: 1e9,
      };
      this.cars.push(car);
      id += 1;
    }
  }
}

export function buildingsClearOfRoad(): boolean {
  return BUILDINGS.every((b) => !overlapsRoad(b));
}

export { buildingAabb, overlapsRoad };

declare global {
  interface Window {
    __trafficTest?: () => TrafficDiag;
    __scanTest?: () => {
      cycle: number;
      learned: number;
      anomalies: number;
      debris: number;
      blockades: number;
      nextIn: number;
      hits: string[];
    };
  }
}
