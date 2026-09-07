import * as THREE from "three";
import { makeAsphaltTexture } from "./textures";

export const TRACK_A = 28.8;
export const TRACK_B = 19.2;

export function trackPoint(u: number, a = TRACK_A, b = TRACK_B): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(u) * a, 0, Math.sin(u) * b);
}

export function trackTangent(u: number, a = TRACK_A, b = TRACK_B): THREE.Vector3 {
  const t = new THREE.Vector3(-Math.sin(u) * a, 0, Math.cos(u) * b);
  return t.normalize();
}

export type CarRig = {
  group: THREE.Group;
  phase: number;
  speed: number;
  color: number;
  wheels: THREE.Object3D[];
};

export type WorldBuild = {
  group: THREE.Group;
  cars: CarRig[];
  buildings: THREE.Object3D[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
};

function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
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

export function buildWorld(): WorldBuild {
  const group = new THREE.Group();
  group.name = "world";
  const geos: THREE.BufferGeometry[] = [];
  const textures = [makeAsphaltTexture()];
  const asphalt = textures[0]!;

  const groundMat = new THREE.MeshStandardMaterial({
    map: asphalt,
    roughness: 0.92,
    metalness: 0.04,
    color: 0xc8c8c4,
  });
  const ground = new THREE.Mesh(
    (() => {
      const g = new THREE.PlaneGeometry(80, 80);
      geos.push(g);
      return g;
    })(),
    groundMat,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const conc = new THREE.MeshStandardMaterial({
    color: 0x2a2d32,
    roughness: 0.86,
    metalness: 0.08,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x1a242c,
    roughness: 0.25,
    metalness: 0.4,
    emissive: 0x3a4a52,
    emissiveIntensity: 0.25,
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

  const materials: THREE.Material[] = [
    groundMat,
    conc,
    windowMat,
    rubber,
    glass,
    light,
    bodyProto,
  ];

  const buildings: THREE.Object3D[] = [];
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  geos.push(bGeo);
  const footprints: [number, number, number, number, number][] = [
    [18, 10, -32, 8, 6],
    [-22, 14, -30, 7, 7],
    [32, 7, 8, 9, 6],
    [-34, 11, 12, 6, 8],
    [24, 16, 30, 8, 7],
    [-16, 8, 34, 10, 6],
    [0, 12, -36, 12, 5],
    [36, 9, -16, 6, 9],
    [-30, 18, -8, 7, 6],
  ];
  for (const [x, h, z, sx, sz] of footprints) {
    const b = new THREE.Mesh(bGeo, conc);
    b.position.set(x, h / 2, z);
    b.scale.set(sx, h, sz);
    b.castShadow = true;
    b.receiveShadow = true;
    b.userData.building = true;
    group.add(b);
    buildings.push(b);
    const win = new THREE.Mesh(bGeo, windowMat);
    win.position.set(x, h * 0.55, z);
    win.scale.set(sx * 0.72, h * 0.55, sz * 1.02);
    group.add(win);
  }

  const bodyGeo = new THREE.BoxGeometry(1.7, 0.55, 4.2);
  const cabinGeo = new THREE.BoxGeometry(1.5, 0.42, 2.1);
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 14);
  const lampGeo = new THREE.BoxGeometry(0.28, 0.12, 0.08);
  geos.push(bodyGeo, cabinGeo, wheelGeo, lampGeo);

  const carMats = { body: bodyProto, glass, rubber, light };
  const specs: { phase: number; speed: number; color: number }[] = [
    { phase: 0.2, speed: 0.22, color: 0xd6d4ce },
    { phase: 2.4, speed: 0.18, color: 0x3a3e44 },
    { phase: 4.1, speed: 0.2, color: 0x5c6460 },
  ];

  const cars: CarRig[] = specs.map((s) => {
    const built = makeCar(s.color, [bodyGeo, cabinGeo, wheelGeo, lampGeo], carMats);
    built.group.userData.car = true;
    group.add(built.group);
    return {
      group: built.group,
      phase: s.phase,
      speed: s.speed,
      color: s.color,
      wheels: built.wheels,
    };
  });

  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.5, 8);
  const lampHead = new THREE.BoxGeometry(0.8, 0.12, 0.3);
  geos.push(poleGeo, lampHead);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x3a3c40,
    roughness: 0.5,
    metalness: 0.6,
  });
  materials.push(poleMat);
  for (let i = 0; i < 8; i++) {
    const u = (i / 8) * Math.PI * 2;
    const p = trackPoint(u, TRACK_A + 4.5, TRACK_B + 3.2);
    const pole = mesh(poleGeo, poleMat, p.x, 2.75, p.z);
    const head = mesh(lampHead, light, p.x, 5.5, p.z);
    group.add(pole, head);
  }

  return { group, cars, buildings, materials, textures, geometries: geos };
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
