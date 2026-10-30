import * as THREE from "three";
import { makeCityAsphalt } from "./textures";
import {
  BUILDINGS,
  CHI_CURB,
  CHI_EB,
  CHI_WB,
  CROSS_Z,
  INTER_HALF_X,
  INTER_HALF_Z,
  MAG_MILE,
  MICH_CURB,
  MICH_NB,
  MICH_SB,
  RUSH_X,
  SPAN,
  WABASH_X,
  overlapsRoad,
  type BuildingFoot,
} from "./city";
import { TrafficSim, type SimCar, type TrafficDiag } from "./traffic";
import { AGENT_SIZE, type AgentType, type SimAgent } from "./agents";
import { DEBRIS, type DebrisDef } from "./debris";

export type CarRig = {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  id: number;
  color: number;
  parked: boolean;
};

export type AgentRig = {
  group: THREE.Group;
  id: number;
  type: AgentType;
};

export type SignalHead = {
  approach: "NS" | "EW";
  red: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
};

export type DebrisRig = {
  id: number;
  def: DebrisDef;
  group: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
};

export type WorldBuild = {
  group: THREE.Group;
  cars: CarRig[];
  /** Pedestrian, bicycle, scooter, and motorbike rigs, one per `sim.agents` entry. */
  agents: AgentRig[];
  buildings: THREE.Object3D[];
  debris: DebrisRig[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
  sim: TrafficSim;
  signals: SignalHead[];
  loc: typeof MAG_MILE;
  spawnCar: (car: SimCar) => CarRig;
  spawnAgent: (agent: SimAgent) => AgentRig;
};

const SHIRTS = [0x2f5d8a, 0xa8432f, 0x3e7a4c, 0xd2b34a, 0x6b4a8a, 0xe6e2da, 0x2a2a2e, 0xc77a3a];

type AgentKit = {
  box: THREE.BoxGeometry;
  head: THREE.SphereGeometry;
  wheel: THREE.TorusGeometry;
  skin: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  shirts: THREE.MeshStandardMaterial[];
};

function part(
  kit: AgentKit,
  mat: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(kit.box, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Person standing at the origin, `top` metres tall, feet at `feet`. */
function figure(kit: AgentKit, shirt: THREE.Material, feet: number, top: number, seated: boolean): THREE.Group {
  const g = new THREE.Group();
  const head = 0.22;
  const torsoTop = top - head;
  const hip = seated ? torsoTop - 0.58 : feet + (top - feet) * 0.47;
  if (!seated) g.add(part(kit, kit.pants, 0.34, hip - feet, 0.22, 0, (hip + feet) / 2, 0));
  g.add(part(kit, shirt, 0.42, torsoTop - hip, 0.26, 0, (torsoTop + hip) / 2, 0));
  const h = new THREE.Mesh(kit.head, kit.skin);
  h.position.set(0, top - head / 2, 0);
  h.castShadow = true;
  g.add(h);
  return g;
}

function wheel(kit: AgentKit, r: number, z: number): THREE.Mesh {
  const w = new THREE.Mesh(kit.wheel, kit.tire);
  w.scale.set(r, r, 1);
  w.rotation.y = Math.PI / 2;
  w.position.set(0, r, z);
  w.castShadow = true;
  return w;
}

/** Rig sized to `AGENT_SIZE`, length along local +Z (the heading). */
function makeAgentRig(kit: AgentKit, agent: SimAgent): THREE.Group {
  const size = AGENT_SIZE[agent.type];
  const shirt = kit.shirts[agent.id % kit.shirts.length]!;
  const g = new THREE.Group();
  const hl = size.length / 2;
  if (agent.type === "person") {
    g.add(figure(kit, shirt, 0, size.height, false));
  } else if (agent.type === "bicycle") {
    const r = 0.34;
    g.add(wheel(kit, r, hl - r), wheel(kit, r, -hl + r));
    g.add(part(kit, kit.frame, 0.06, 0.08, size.length - 2 * r, 0, 0.62, 0));
    g.add(part(kit, kit.frame, 0.06, 0.5, 0.06, 0, 0.62, hl - r));
    const rider = figure(kit, shirt, 0.62, size.height, true);
    rider.position.z = -0.12;
    rider.rotation.x = 0.25;
    g.add(rider);
  } else if (agent.type === "scooter") {
    const r = 0.1;
    g.add(wheel(kit, r, hl - r), wheel(kit, r, -hl + r));
    g.add(part(kit, kit.frame, 0.16, 0.05, size.length - 2 * r, 0, 0.14, 0));
    g.add(part(kit, kit.frame, 0.05, 0.95, 0.05, 0, 0.62, hl - 0.14));
    g.add(part(kit, kit.frame, size.width, 0.04, 0.05, 0, 1.08, hl - 0.14));
    const rider = figure(kit, shirt, 0.17, size.height, false);
    rider.position.z = -0.08;
    g.add(rider);
  } else {
    const r = 0.32;
    g.add(wheel(kit, r, hl - r), wheel(kit, r, -hl + r));
    g.add(part(kit, shirt, 0.36, 0.42, size.length - 2 * r, 0, 0.62, 0));
    g.add(part(kit, kit.frame, size.width, 0.04, 0.05, 0, 1.0, hl - 0.4));
    const rider = figure(kit, kit.frame, 0.8, size.height, true);
    rider.position.z = -0.2;
    g.add(rider);
  }
  g.userData.agent = true;
  g.userData.agentId = agent.id;
  g.position.set(agent.x, 0, agent.z);
  g.rotation.y = agent.yaw;
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeCar(
  color: number,
  geos: THREE.BufferGeometry[],
  mats: Record<string, THREE.MeshStandardMaterial>,
): { group: THREE.Group; wheels: THREE.Object3D[] } {
  const g = new THREE.Group();
  const body = mesh(geos[0]!, mats.body.clone(), 0, 0.55, 0);
  (body.material as THREE.MeshStandardMaterial).color.setHex(color);
  const cabin = mesh(geos[1]!, mats.glass, 0, 0.95, -0.12);
  const wheelGeo = geos[2]!;
  const wheels: THREE.Object3D[] = [];
  const wpos = [
    [0.72, 0.28, 1.15],
    [-0.72, 0.28, 1.15],
    [0.72, 0.28, -1.2],
    [-0.72, 0.28, -1.2],
  ] as const;
  for (const [x, y, z] of wpos) {
    const w = mesh(wheelGeo, mats.rubber, x, y, z);
    w.rotation.z = Math.PI / 2;
    g.add(w);
    wheels.push(w);
  }
  g.add(body, cabin);
  const lightL = mesh(geos[3]!, mats.light, 0.42, 0.52, 2.05);
  const lightR = mesh(geos[3]!, mats.light, -0.42, 0.52, 2.05);
  g.add(lightL, lightR);
  return { group: g, wheels };
}

function addMark(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  z: number,
  y: number,
  sx: number,
  sz: number,
  rotY = 0,
) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, 1, sz);
  m.rotation.y = rotY;
  m.receiveShadow = true;
  group.add(m);
}

function buildCastle(
  foot: BuildingFoot,
  box: THREE.BufferGeometry,
  cyl: THREE.BufferGeometry,
  cone: THREE.BufferGeometry,
  stone: THREE.Material,
  roof: THREE.Material,
  group: THREE.Group,
  buildings: THREE.Object3D[],
) {
  const base = mesh(box, stone, foot.x, foot.h * 0.38, foot.z);
  base.scale.set(foot.sx, foot.h * 0.76, foot.sz);
  base.userData.building = true;
  group.add(base);
  buildings.push(base);
  const keep = mesh(box, stone, foot.x, foot.h * 0.78, foot.z);
  keep.scale.set(foot.sx * 0.62, foot.h * 0.28, foot.sz * 0.62);
  keep.userData.building = true;
  group.add(keep);
  buildings.push(keep);
  const inset = 0.38;
  const corners: [number, number][] = [
    [-inset, -inset],
    [inset, -inset],
    [-inset, inset],
    [inset, inset],
  ];
  for (const [ox, oz] of corners) {
    const t = mesh(cyl, stone, foot.x + ox * foot.sx, foot.h * 0.55, foot.z + oz * foot.sz);
    t.scale.set(1.6, foot.h * 1.05, 1.6);
    t.userData.building = true;
    group.add(t);
    buildings.push(t);
    const cap = mesh(cone, roof, foot.x + ox * foot.sx, foot.h * 1.12, foot.z + oz * foot.sz);
    cap.scale.set(2.1, 4.2, 2.1);
    group.add(cap);
  }
}

export function buildWorld(): WorldBuild {
  const group = new THREE.Group();
  group.name = "world";
  const geos: THREE.BufferGeometry[] = [];
  const textures = [makeCityAsphalt()];
  const asphalt = textures[0]!;

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x8a8680,
    roughness: 0.94,
    metalness: 0.04,
  });
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt,
    color: 0x3a3c40,
    roughness: 0.9,
    metalness: 0.06,
  });
  const walkMat = new THREE.MeshStandardMaterial({
    color: 0xa39e94,
    roughness: 0.92,
    metalness: 0.03,
  });
  const stone = new THREE.MeshStandardMaterial({
    color: 0xb7ae9c,
    roughness: 0.82,
    metalness: 0.08,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x3a2c28,
    roughness: 0.7,
    metalness: 0.12,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x1a242c,
    roughness: 0.25,
    metalness: 0.4,
    emissive: 0x3a4a52,
    emissiveIntensity: 0.22,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x161616,
    roughness: 0.8,
    metalness: 0.05,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x8aa0ae,
    roughness: 0.12,
    metalness: 0.3,
    transparent: true,
    opacity: 0.55,
  });
  const light = new THREE.MeshStandardMaterial({
    color: 0xf2efe4,
    emissive: 0xf2efe4,
    emissiveIntensity: 0.8,
    roughness: 0.4,
  });
  const bodyProto = new THREE.MeshStandardMaterial({
    color: 0xc5c8ce,
    roughness: 0.38,
    metalness: 0.55,
  });
  const conc = new THREE.MeshStandardMaterial({
    color: 0x2a2d32,
    roughness: 0.86,
    metalness: 0.08,
  });
  const whiteMark = new THREE.MeshBasicMaterial({ color: 0xd8d4c8 });
  const yellowMark = new THREE.MeshBasicMaterial({ color: 0xc4b26a });
  const stopMat = new THREE.MeshBasicMaterial({ color: 0xe8e4dc });
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x3a3c40,
    roughness: 0.5,
    metalness: 0.6,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x8a6a42,
    roughness: 0.82,
    metalness: 0.04,
  });
  const barrierMat = new THREE.MeshStandardMaterial({
    color: 0xb85a32,
    roughness: 0.55,
    metalness: 0.08,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xd8d4c8,
    roughness: 0.5,
    metalness: 0.04,
  });
  const coneMat = new THREE.MeshStandardMaterial({
    color: 0xc45a28,
    roughness: 0.48,
    metalness: 0.06,
  });
  const barkMat = new THREE.MeshStandardMaterial({
    color: 0x5a4630,
    roughness: 0.9,
    metalness: 0.02,
  });
  const bagMat = new THREE.MeshStandardMaterial({
    color: 0x2c2e32,
    roughness: 0.7,
    metalness: 0.04,
  });

  const materials: THREE.Material[] = [
    groundMat,
    roadMat,
    walkMat,
    stone,
    roofMat,
    windowMat,
    rubber,
    glass,
    light,
    bodyProto,
    conc,
    whiteMark,
    yellowMark,
    stopMat,
    poleMat,
    woodMat,
    barrierMat,
    stripeMat,
    coneMat,
    barkMat,
    bagMat,
  ];

  // Wide enough that a 120 m nadir pass still sees ground at the frame edge.
  const groundGeo = new THREE.PlaneGeometry(420, 420);
  geos.push(groundGeo);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const michGeo = new THREE.PlaneGeometry(MICH_CURB * 2, SPAN * 2);
  const chiGeo = new THREE.PlaneGeometry(SPAN * 2, CHI_CURB * 2);
  geos.push(michGeo, chiGeo);
  const mich = new THREE.Mesh(michGeo, roadMat);
  mich.rotation.x = -Math.PI / 2;
  mich.position.y = 0.02;
  mich.receiveShadow = true;
  group.add(mich);
  const chi = new THREE.Mesh(chiGeo, roadMat);
  chi.rotation.x = -Math.PI / 2;
  chi.position.y = 0.025;
  chi.receiveShadow = true;
  group.add(chi);

  const walkGeo = new THREE.BoxGeometry(1, 1, 1);
  geos.push(walkGeo);
  const walkH = 0.08;
  function sidewalk(x: number, z: number, sx: number, sz: number) {
    const s = mesh(walkGeo, walkMat, x, walkH / 2, z);
    s.scale.set(sx, walkH, sz);
    s.castShadow = false;
    group.add(s);
  }
  const sw = 6.8;
  const michLen = SPAN - CHI_CURB;
  const chiLen = SPAN - MICH_CURB;
  const michMid = CHI_CURB + michLen / 2;
  const chiMid = MICH_CURB + chiLen / 2;
  sidewalk(-MICH_CURB - sw / 2, -michMid, sw, michLen);
  sidewalk(-MICH_CURB - sw / 2, michMid, sw, michLen);
  sidewalk(MICH_CURB + sw / 2, -michMid, sw, michLen);
  sidewalk(MICH_CURB + sw / 2, michMid, sw, michLen);
  sidewalk(-chiMid, -CHI_CURB - sw / 2, chiLen, sw);
  sidewalk(chiMid, -CHI_CURB - sw / 2, chiLen, sw);
  sidewalk(-chiMid, CHI_CURB + sw / 2, chiLen, sw);
  sidewalk(chiMid, CHI_CURB + sw / 2, chiLen, sw);

  const markGeo = new THREE.BoxGeometry(1, 0.04, 1);
  geos.push(markGeo);
  const my = 0.045;

  addMark(group, markGeo, yellowMark, 0, 0, my, 0.18, SPAN * 2);
  addMark(group, markGeo, yellowMark, 0.22, 0, my, 0.18, SPAN * 2);
  addMark(group, markGeo, yellowMark, 0, 0, my + 0.002, SPAN * 2, 0.18);
  addMark(group, markGeo, yellowMark, 0, 0.22, my + 0.002, SPAN * 2, 0.18);

  const dash = (x: number, z0: number, z1: number, alongZ: boolean) => {
    const a = Math.min(z0, z1);
    const b = Math.max(z0, z1);
    for (let t = a + 2; t < b - 2; t += 7) {
      if (Math.abs(t) < INTER_HALF_Z + 2 && alongZ) continue;
      if (alongZ) addMark(group, markGeo, whiteMark, x, t, my, 0.12, 3.2);
      else {
        if (Math.abs(t) < INTER_HALF_X + 2) continue;
        addMark(group, markGeo, whiteMark, t, x, my, 3.2, 0.12);
      }
    }
  };
  dash((MICH_NB[0] + MICH_NB[1]) / 2, -SPAN, SPAN, true);
  dash((MICH_NB[1] + MICH_NB[2]) / 2, -SPAN, SPAN, true);
  dash((MICH_SB[0] + MICH_SB[1]) / 2, -SPAN, SPAN, true);
  dash((MICH_SB[1] + MICH_SB[2]) / 2, -SPAN, SPAN, true);
  dash((CHI_EB[0] + CHI_EB[1]) / 2, -SPAN, SPAN, false);
  dash((CHI_WB[0] + CHI_WB[1]) / 2, -SPAN, SPAN, false);

  const stopZ = INTER_HALF_Z + 2.4;
  const stopX = INTER_HALF_X + 2.4;
  addMark(group, markGeo, stopMat, 5.5, stopZ, my, 10.5, 0.55);
  addMark(group, markGeo, stopMat, -5.5, -stopZ, my, 10.5, 0.55);
  addMark(group, markGeo, stopMat, stopX, 4.1, my, 0.55, 8.2);
  addMark(group, markGeo, stopMat, -stopX, -4.1, my, 0.55, 8.2);

  for (let i = -5; i <= 5; i++) {
    addMark(group, markGeo, whiteMark, i * 1.1, INTER_HALF_Z + 0.7, my, 0.45, 2.4);
    addMark(group, markGeo, whiteMark, i * 1.1, -INTER_HALF_Z - 0.7, my, 0.45, 2.4);
    addMark(group, markGeo, whiteMark, INTER_HALF_X + 0.7, i * 0.9, my, 2.4, 0.45);
    addMark(group, markGeo, whiteMark, -INTER_HALF_X - 0.7, i * 0.9, my, 2.4, 0.45);
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const coneGeo = new THREE.ConeGeometry(0.5, 1, 8);
  geos.push(boxGeo, cylGeo, coneGeo);

  const buildings: THREE.Object3D[] = [];
  for (const foot of BUILDINGS) {
    if (overlapsRoad(foot)) continue;
    const mat = new THREE.MeshStandardMaterial({
      color: foot.tone,
      roughness: foot.kind === "glass" ? 0.28 : 0.78,
      metalness: foot.kind === "glass" ? 0.45 : 0.08,
    });
    materials.push(mat);
    if (foot.kind === "castle") {
      buildCastle(foot, boxGeo, cylGeo, coneGeo, mat, roofMat, group, buildings);
      continue;
    }
    const b = mesh(boxGeo, mat, foot.x, foot.h / 2, foot.z);
    b.scale.set(foot.sx, foot.h, foot.sz);
    b.userData.building = true;
    b.userData.name = foot.name;
    group.add(b);
    buildings.push(b);
    const win = mesh(boxGeo, windowMat, foot.x, foot.h * 0.55, foot.z);
    win.scale.set(foot.sx * (foot.kind === "glass" ? 0.92 : 0.72), foot.h * 0.55, foot.sz * 1.02);
    win.castShadow = false;
    group.add(win);
  }

  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 6.2, 8);
  const lampHead = new THREE.BoxGeometry(0.9, 0.12, 0.32);
  geos.push(poleGeo, lampHead);
  const lampXs = [MICH_CURB + 1.6, -(MICH_CURB + 1.6)];
  const lampZs = [-66, -48, -32, 32, 48, 66];
  for (const x of lampXs) {
    for (const z of lampZs) {
      group.add(mesh(poleGeo, poleMat, x, 3.1, z));
      group.add(mesh(lampHead, light, x, 6.2, z));
    }
  }

  const signals: SignalHead[] = [];
  const bulbGeo = new THREE.SphereGeometry(0.14, 10, 8);
  geos.push(bulbGeo);
  const housingGeo = new THREE.BoxGeometry(0.32, 1.05, 0.28);
  geos.push(housingGeo);
  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x1c1e22,
    roughness: 0.5,
    metalness: 0.4,
  });
  materials.push(housingMat);

  function addSignal(x: number, z: number, yaw: number, approach: "NS" | "EW") {
    const pole = mesh(poleGeo, poleMat, x, 3.1, z);
    group.add(pole);
    const house = mesh(housingGeo, housingMat, x, 5.7, z);
    house.rotation.y = yaw;
    group.add(house);
    const mk = (hex: number, ey: number) => {
      const m = new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 0.15,
        roughness: 0.35,
      });
      materials.push(m);
      const bulb = new THREE.Mesh(bulbGeo, m);
      const fx = Math.sin(yaw) * 0.16;
      const fz = Math.cos(yaw) * 0.16;
      bulb.position.set(x + fx, 5.7 + ey, z + fz);
      group.add(bulb);
      return m;
    };
    signals.push({
      approach,
      red: mk(0xa03a32, 0.32),
      yellow: mk(0xb48a2c, 0),
      green: mk(0x2e8a4a, -0.32),
    });
  }
  addSignal(MICH_CURB + 1.1, INTER_HALF_Z + 1.2, Math.PI, "NS");
  addSignal(-(MICH_CURB + 1.1), -(INTER_HALF_Z + 1.2), 0, "NS");
  addSignal(INTER_HALF_X + 1.2, -(CHI_CURB + 1.0), -Math.PI / 2, "EW");
  addSignal(-(INTER_HALF_X + 1.2), CHI_CURB + 1.0, Math.PI / 2, "EW");

  const bodyGeo = new THREE.BoxGeometry(1.7, 0.55, 4.2);
  const cabinGeo = new THREE.BoxGeometry(1.5, 0.42, 2.1);
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 14);
  const lampGeo = new THREE.BoxGeometry(0.28, 0.12, 0.08);
  geos.push(bodyGeo, cabinGeo, wheelGeo, lampGeo);
  const carMats = { body: bodyProto, glass, rubber, light };

  const sim = new TrafficSim((Date.now() ^ 0x9e3779b9) >>> 0);
  const rigFor = (c: SimCar): CarRig => {
    const built = makeCar(c.color, [bodyGeo, cabinGeo, wheelGeo, lampGeo], carMats);
    built.group.userData.car = true;
    built.group.userData.carIndex = c.id;
    built.group.position.set(c.x, 0, c.z);
    built.group.rotation.y = c.yaw;
    return {
      group: built.group,
      wheels: built.wheels,
      id: c.id,
      color: c.color,
      parked: c.parked,
    };
  };
  const spawnCar = (c: SimCar) => {
    const rig = rigFor(c);
    group.add(rig.group);
    return rig;
  };
  const cars: CarRig[] = sim.cars.map((c) => spawnCar(c));

  const kit: AgentKit = {
    box: new THREE.BoxGeometry(1, 1, 1),
    head: new THREE.SphereGeometry(0.11, 10, 8),
    wheel: new THREE.TorusGeometry(1, 0.08, 6, 16),
    skin: new THREE.MeshStandardMaterial({ color: 0xb08468, roughness: 0.8 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x2c3240, roughness: 0.85 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.5, metalness: 0.5 }),
    tire: rubber,
    shirts: SHIRTS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.82 })),
  };
  geos.push(kit.box, kit.head, kit.wheel);
  materials.push(kit.skin, kit.pants, kit.frame, ...kit.shirts);
  const spawnAgent = (agent: SimAgent): AgentRig => {
    const rig = { group: makeAgentRig(kit, agent), id: agent.id, type: agent.type };
    group.add(rig.group);
    return rig;
  };
  const agents: AgentRig[] = sim.agents.map((agent) => spawnAgent(agent));

  const debris = spawnDebris(group, geos, materials, {
    rubber,
    wood: woodMat,
    barrier: barrierMat,
    stripe: stripeMat,
    cone: coneMat,
    bark: barkMat,
    bag: bagMat,
    rubble: conc,
  });

  return {
    group,
    cars,
    agents,
    buildings,
    debris,
    materials,
    textures,
    geometries: geos,
    sim,
    signals,
    loc: MAG_MILE,
    spawnCar,
    spawnAgent,
  };
}

export function syncWorldCars(world: WorldBuild) {
  for (const rig of world.cars) world.group.remove(rig.group);
  world.cars = world.sim.cars.map((car) => world.spawnCar(car));
  syncWorldAgents(world);
}

export function syncWorldAgents(world: WorldBuild) {
  for (const rig of world.agents) world.group.remove(rig.group);
  world.agents = world.sim.agents.map((agent) => world.spawnAgent(agent));
}

function agentsInSync(world: WorldBuild): boolean {
  const { agents } = world.sim;
  if (agents.length !== world.agents.length) return false;
  for (let i = 0; i < agents.length; i++) {
    const rig = world.agents[i]!;
    if (rig.id !== agents[i]!.id || rig.type !== agents[i]!.type) return false;
  }
  return true;
}

/** Rebuilds the rigs when the sim's agent set changed (reset, scripted fleet), then poses them. */
export function poseWorldAgents(world: WorldBuild) {
  if (!agentsInSync(world)) syncWorldAgents(world);
  const agents = world.sim.agents;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]!;
    const rig = world.agents[i]!;
    rig.group.position.set(a.x, 0, a.z);
    rig.group.rotation.y = a.yaw;
  }
}

/** Pavement for the measurement loop. Not part of the default road mesh. */
export function addDetourRoads(world: WorldBuild): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.92, metalness: 0.05 });
  world.materials.push(mat);
  const group = new THREE.Group();
  group.name = "detour-roads";
  const sideLen = CHI_EB[0] - CROSS_Z + 8;
  const along = new THREE.Mesh(new THREE.PlaneGeometry(9.2, sideLen), mat);
  along.rotation.x = -Math.PI / 2;
  along.position.set((RUSH_X[0] + RUSH_X[1]) / 2, 0.03, (CHI_EB[0] + CROSS_Z) / 2);
  along.receiveShadow = true;
  const crossLen = RUSH_X[0] - MICH_NB[2] + 4;
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(crossLen, 6.2), mat);
  cross.rotation.x = -Math.PI / 2;
  cross.position.set((RUSH_X[0] + MICH_NB[2]) / 2, 0.032, CROSS_Z);
  cross.receiveShadow = true;
  group.add(along, cross);
  world.geometries.push(along.geometry, cross.geometry);
  world.group.add(group);
  return group;
}

/** Rush, Wabash, and both returns. Used by the closed-loop view. */
export function addLoopRoads(world: WorldBuild): THREE.Group {
  const group = addDetourRoads(world);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.92, metalness: 0.05 });
  world.materials.push(mat);
  const alongLen = CHI_WB[0] - CROSS_Z + 8;
  const along = new THREE.Mesh(new THREE.PlaneGeometry(9.2, alongLen), mat);
  along.rotation.x = -Math.PI / 2;
  along.position.set((WABASH_X[0] + WABASH_X[1]) / 2, 0.03, (CHI_WB[0] + CROSS_Z) / 2);
  along.receiveShadow = true;
  const crossLen = MICH_NB[0] - WABASH_X[0] + 4;
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(crossLen, 6.2), mat);
  cross.rotation.x = -Math.PI / 2;
  cross.position.set((WABASH_X[0] + MICH_NB[0]) / 2, 0.032, CROSS_Z);
  cross.receiveShadow = true;
  group.add(along, cross);
  world.geometries.push(along.geometry, cross.geometry);
  const callouts: { text: string; ink: string; plate: string; x: number; z: number }[] = [
    { text: "WABASH", ink: "#2a2118", plate: "#e09a3e", x: WABASH_X[0], z: -6 },
    { text: "RUSH", ink: "#f4f7ff", plate: "#3c7dff", x: RUSH_X[0], z: -4 },
    { text: "NB BARRIERS", ink: "#fff6f2", plate: "#d4552a", x: MICH_NB[1], z: -14 },
  ];
  for (const tag of callouts) {
    const sprite = streetLabel(tag.text, tag.ink, tag.plate);
    sprite.position.set(tag.x, 7, tag.z);
    group.add(sprite);
  }
  return group;
}

function streetLabel(text: string, ink: string, plate: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("street label canvas is unavailable");
  ctx.fillStyle = plate;
  roundRect(ctx, 4, 4, 504, 152, 28);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = "700 78px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 84);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(28, 8.8, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function addLaneBlockades(world: WorldBuild, defs: DebrisDef[]): DebrisRig[] {
  const barrier = new THREE.MeshStandardMaterial({
    color: 0xc4b08a,
    roughness: 0.84,
    metalness: 0.05,
  });
  const stripe = new THREE.MeshStandardMaterial({
    color: 0xd4552a,
    roughness: 0.6,
    metalness: 0.04,
  });
  world.materials.push(barrier, stripe);
  const box = new THREE.BoxGeometry(1, 1, 1);
  world.geometries.push(box);
  const rigs: DebrisRig[] = [];
  for (const def of defs) {
    const g = new THREE.Group();
    g.position.set(def.x, 0, def.z);
    g.rotation.y = def.yaw;
    g.userData.debrisId = def.id;
    const body = new THREE.Mesh(box, barrier);
    body.position.set(0, 0.48, 0);
    body.scale.set(3.3, 0.9, 2.4);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.debrisId = def.id;
    const band = new THREE.Mesh(box, stripe);
    band.position.set(0, 0.72, 0);
    band.scale.set(3.36, 0.12, 2.46);
    band.userData.debrisId = def.id;
    g.add(body, band);
    world.group.add(g);
    const rig: DebrisRig = { id: def.id, def, group: g, mats: [] };
    world.debris.push(rig);
    rigs.push(rig);
  }
  return rigs;
}

export function applySignalLights(signals: SignalHead[], ns: "g" | "y" | "r", ew: "g" | "y" | "r") {
  for (const s of signals) {
    const lit = s.approach === "NS" ? ns : ew;
    s.red.emissiveIntensity = lit === "r" ? 1.6 : 0.12;
    s.yellow.emissiveIntensity = lit === "y" ? 1.5 : 0.12;
    s.green.emissiveIntensity = lit === "g" ? 1.7 : 0.12;
  }
}

export function poseWorldCars(world: WorldBuild, dt: number) {
  const sim = world.sim;
  for (const rig of world.cars) {
    const c = sim.cars[rig.id];
    if (!c) continue;
    rig.group.position.set(c.x, 0, c.z);
    rig.group.rotation.y = c.yaw;
    if (c.parked || c.v < 0.05) continue;
    const spin = (c.v / 0.28) * dt;
    for (const w of rig.wheels) w.rotation.x += spin;
  }
  poseWorldAgents(world);
}

export function worldDiag(world: WorldBuild): TrafficDiag {
  return world.sim.diagnostics();
}

function spawnDebris(
  group: THREE.Group,
  geos: THREE.BufferGeometry[],
  materials: THREE.Material[],
  mats: {
    rubber: THREE.MeshStandardMaterial;
    wood: THREE.MeshStandardMaterial;
    barrier: THREE.MeshStandardMaterial;
    stripe: THREE.MeshStandardMaterial;
    cone: THREE.MeshStandardMaterial;
    bark: THREE.MeshStandardMaterial;
    bag: THREE.MeshStandardMaterial;
    rubble: THREE.MeshStandardMaterial;
  },
): DebrisRig[] {
  const torus = new THREE.TorusGeometry(0.32, 0.11, 8, 16);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cone = new THREE.CylinderGeometry(0.03, 0.16, 0.62, 10);
  const cyl = new THREE.CylinderGeometry(0.07, 0.09, 1, 8);
  const sph = new THREE.SphereGeometry(0.22, 10, 8);
  geos.push(torus, box, cone, cyl, sph);

  const items: DebrisRig[] = [];
  for (const def of DEBRIS) {
    const g = new THREE.Group();
    g.position.set(def.x, 0, def.z);
    g.rotation.y = def.yaw;
    g.userData.debrisId = def.id;
    const local: THREE.MeshStandardMaterial[] = [];
    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.MeshStandardMaterial,
      x: number,
      y: number,
      z: number,
      sx = 1,
      sy = 1,
      sz = 1,
      rx = 0,
      rz = 0,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.x = rx;
      m.rotation.z = rz;
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.debrisId = def.id;
      g.add(m);
    };
    if (def.type === "tire") {
      add(torus, mats.rubber, 0, 0.12, 0, 1, 1, 1, Math.PI / 2);
    } else if (def.type === "crate") {
      add(box, mats.wood, 0, 0.32, 0, 0.72, 0.64, 0.72);
    } else if (def.type === "barrier") {
      add(box, mats.barrier, 0, 0.42, 0, 0.42, 0.84, 2.2);
      add(box, mats.stripe, 0, 0.78, 0, 0.44, 0.08, 2.22);
    } else if (def.type === "cone") {
      add(cone, mats.cone, 0, 0.22, 0, 1, 0.7, 1, 1.1);
      add(box, mats.stripe, 0, 0.04, 0, 0.36, 0.06, 0.36);
    } else if (def.type === "branch") {
      add(cyl, mats.bark, 0, 0.12, 0, 1.1, 1.8, 1.1, 1.15, 0.2);
      add(cyl, mats.bark, 0.35, 0.18, 0.1, 0.7, 1.1, 0.7, 0.9, -0.6);
    } else if (def.type === "rubble") {
      add(box, mats.rubble, 0, 0.16, 0, 0.7, 0.32, 0.5);
      add(box, mats.rubble, 0.28, 0.12, 0.18, 0.4, 0.24, 0.36, 0.2);
      add(box, mats.rubble, -0.22, 0.1, -0.12, 0.36, 0.2, 0.3);
    } else if (def.type === "pallet") {
      add(box, mats.wood, 0, 0.07, 0, 1.2, 0.1, 0.82);
      add(box, mats.wood, 0, 0.16, -0.32, 1.18, 0.08, 0.12);
      add(box, mats.wood, 0, 0.16, 0.32, 1.18, 0.08, 0.12);
    } else {
      add(sph, mats.bag, 0, 0.22, 0, 1.15, 1.05, 1.2);
      add(sph, mats.bag, 0.22, 0.18, 0.08, 0.85, 0.8, 0.9);
    }
    group.add(g);
    items.push({ id: def.id, def, group: g, mats: local });
  }
  void materials;
  return items;
}

export function makeStudioCar(): THREE.Group {
  const geos: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(1.7, 0.55, 4.2),
    new THREE.BoxGeometry(1.5, 0.42, 2.1),
    new THREE.CylinderGeometry(0.28, 0.28, 0.22, 14),
    new THREE.BoxGeometry(0.28, 0.12, 0.08),
  ];
  const mats = {
    body: new THREE.MeshStandardMaterial({
      color: 0xd6d4ce,
      roughness: 0.38,
      metalness: 0.55,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8aa0ae,
      roughness: 0.12,
      metalness: 0.3,
      transparent: true,
      opacity: 0.55,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x161616,
      roughness: 0.8,
      metalness: 0.05,
    }),
    light: new THREE.MeshStandardMaterial({
      color: 0xf2efe4,
      emissive: 0xf2efe4,
      emissiveIntensity: 0.8,
      roughness: 0.4,
    }),
  };
  const built = makeCar(0xd6d4ce, geos, mats);
  built.group.scale.setScalar(0.18);
  built.group.userData.studioCar = true;
  built.group.userData.geos = geos;
  built.group.userData.mats = Object.values(mats);
  return built.group;
}
