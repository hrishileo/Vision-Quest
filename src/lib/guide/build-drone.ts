import * as THREE from "three";
import {
  makeBrushedTexture,
  makeCarbonTexture,
  makePcbTexture,
} from "./textures";

export type Piece = {
  id: string;
  object: THREE.Object3D;
  rest: THREE.Vector3;
  explode: THREE.Vector3;
};

export type DroneBuild = {
  group: THREE.Group;
  pieces: Piece[];
  propPivots: THREE.Group[];
  rotorPivots: THREE.Group[];
  thrustCones: THREE.Mesh[];
  gimbalYaw: THREE.Group;
  gimbalPitch: THREE.Group;
  droneCam: THREE.PerspectiveCamera;
  shellMeshes: THREE.Mesh[];
  clipMeshes: THREE.Mesh[];
  ledMats: THREE.MeshStandardMaterial[];
  imuObject: THREE.Object3D;
  materials: THREE.Material[];
  textures: THREE.Texture[];
  geometries: THREE.BufferGeometry[];
};

const ARM = 0.265;
const MOTOR_Z = 0.02;

type Mats = {
  carbon: THREE.MeshStandardMaterial;
  carbonArm: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  pcb: THREE.MeshStandardMaterial;
  pcbDark: THREE.MeshStandardMaterial;
  chip: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  battery: THREE.MeshStandardMaterial;
  prop: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  goldpin: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  lens: THREE.MeshPhysicalMaterial;
};

function share(
  geos: THREE.BufferGeometry[],
  geo: THREE.BufferGeometry,
): THREE.BufferGeometry {
  geos.push(geo);
  return geo;
}

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

function bladeShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.008, 0);
  s.bezierCurveTo(0.02, 0.016, 0.06, 0.022, 0.118, 0.01);
  s.lineTo(0.12, -0.006);
  s.bezierCurveTo(0.06, -0.02, 0.02, -0.012, 0.008, 0);
  return s;
}

export function buildDrone(): DroneBuild {
  const geos: THREE.BufferGeometry[] = [];
  const textures = [
    makeCarbonTexture(),
    makeBrushedTexture(),
    makePcbTexture(),
  ];
  const [carbonMap, brushedMap, pcbMap] = textures;

  const mats: Mats = {
    carbon: new THREE.MeshStandardMaterial({
      map: carbonMap,
      color: 0x9a9da4,
      roughness: 0.42,
      metalness: 0.35,
    }),
    carbonArm: new THREE.MeshStandardMaterial({
      map: carbonMap,
      color: 0x8e929a,
      roughness: 0.4,
      metalness: 0.38,
    }),
    alu: new THREE.MeshStandardMaterial({
      map: brushedMap,
      color: 0xc5c9d0,
      roughness: 0.28,
      metalness: 0.86,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0x6a6e76,
      roughness: 0.32,
      metalness: 0.78,
    }),
    copper: new THREE.MeshStandardMaterial({
      color: 0xb06a38,
      roughness: 0.38,
      metalness: 0.9,
    }),
    pcb: new THREE.MeshStandardMaterial({
      map: pcbMap,
      color: 0x8fbf9a,
      roughness: 0.55,
      metalness: 0.08,
    }),
    pcbDark: new THREE.MeshStandardMaterial({
      color: 0x1c2428,
      roughness: 0.5,
      metalness: 0.12,
    }),
    chip: new THREE.MeshStandardMaterial({
      color: 0x2a2b2e,
      roughness: 0.48,
      metalness: 0.22,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0c1016,
      roughness: 0.06,
      metalness: 0.15,
      transparent: true,
      opacity: 0.72,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x1a1a1c,
      roughness: 0.85,
      metalness: 0.05,
    }),
    battery: new THREE.MeshStandardMaterial({
      color: 0x26221c,
      roughness: 0.72,
      metalness: 0.08,
    }),
    prop: new THREE.MeshStandardMaterial({
      color: 0x1c1e22,
      roughness: 0.38,
      metalness: 0.22,
    }),
    plastic: new THREE.MeshStandardMaterial({
      color: 0x2c3036,
      roughness: 0.55,
      metalness: 0.1,
    }),
    goldpin: new THREE.MeshStandardMaterial({
      color: 0x8a7348,
      roughness: 0.35,
      metalness: 0.85,
    }),
    ceramic: new THREE.MeshStandardMaterial({
      color: 0xd8d4cc,
      roughness: 0.45,
      metalness: 0.05,
    }),
    lens: new THREE.MeshPhysicalMaterial({
      color: 0x0a1220,
      roughness: 0.04,
      metalness: 0.15,
      transmission: 0.35,
      thickness: 0.01,
      transparent: true,
      opacity: 0.92,
    }),
  };

  const materials: THREE.Material[] = Object.values(mats);
  const ledMats: THREE.MeshStandardMaterial[] = [];

  const group = new THREE.Group();
  group.name = "osprey";
  const pieces: Piece[] = [];
  const shellMeshes: THREE.Mesh[] = [];
  const clipMeshes: THREE.Mesh[] = [];
  const propPivots: THREE.Group[] = [];
  const rotorPivots: THREE.Group[] = [];
  const thrustCones: THREE.Mesh[] = [];
  let imuObject: THREE.Object3D = group;

  const tag = (obj: THREE.Object3D, id: string) => {
    obj.traverse((c) => {
      c.userData.partId = id;
    });
    obj.userData.partId = id;
  };

  const register = (
    id: string,
    object: THREE.Object3D,
    explode: THREE.Vector3,
  ) => {
    tag(object, id);
    group.add(object);
    pieces.push({
      id,
      object,
      rest: object.position.clone(),
      explode,
    });
  };

  const plateGeo = share(geos, new THREE.BoxGeometry(0.168, 0.006, 0.168));
  const topPlate = mesh(plateGeo, mats.carbon, 0, 0.038, 0);
  const botPlate = mesh(plateGeo, mats.carbon, 0, 0.0, 0);
  shellMeshes.push(topPlate, botPlate);
  clipMeshes.push(topPlate, botPlate);
  register("frame", topPlate, new THREE.Vector3(0, 0.16, 0));
  register("frame", botPlate, new THREE.Vector3(0, -0.02, 0));

  const standGeo = share(geos, new THREE.CylinderGeometry(0.005, 0.005, 0.038, 10));
  const standPos = [
    [0.062, 0.019, 0.062],
    [-0.062, 0.019, 0.062],
    [0.062, 0.019, -0.062],
    [-0.062, 0.019, -0.062],
  ] as const;
  for (const [x, y, z] of standPos) {
    const s = mesh(standGeo, mats.alu, x, y, z);
    register("frame", s, new THREE.Vector3(0, 0.08, 0));
  }

  const armGeo = share(geos, new THREE.BoxGeometry(0.038, 0.012, 0.22));
  const mountGeo = share(geos, new THREE.CylinderGeometry(0.028, 0.03, 0.008, 20));
  const wireGeo = share(geos, new THREE.CylinderGeometry(0.0032, 0.0032, 0.2, 8));

  const arms: { id: "fl" | "fr" | "bl" | "br"; θ: number; cw: boolean }[] = [
    { id: "fr", θ: Math.PI / 4, cw: false },
    { id: "fl", θ: -Math.PI / 4, cw: true },
    { id: "br", θ: (3 * Math.PI) / 4, cw: true },
    { id: "bl", θ: (-3 * Math.PI) / 4, cw: false },
  ];

  const bellGeo = share(geos, new THREE.CylinderGeometry(0.021, 0.022, 0.016, 28));
  const statorGeo = share(geos, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16));
  const windGeo = share(geos, new THREE.TorusGeometry(0.015, 0.0032, 8, 20));
  const shaftGeo = share(geos, new THREE.CylinderGeometry(0.003, 0.003, 0.028, 10));
  const capGeo = share(geos, new THREE.CylinderGeometry(0.018, 0.02, 0.004, 20));
  const hubGeo = share(geos, new THREE.CylinderGeometry(0.01, 0.012, 0.008, 12));
  const magGeo = share(geos, new THREE.BoxGeometry(0.006, 0.012, 0.008));
  const coneGeo = share(geos, new THREE.ConeGeometry(0.038, 0.18, 12, 1, true));
  coneGeo.rotateX(Math.PI);
  const bladeGeo = share(
    geos,
    new THREE.ExtrudeGeometry(bladeShape(), {
      depth: 0.0024,
      bevelEnabled: true,
      bevelThickness: 0.0006,
      bevelSize: 0.0008,
      bevelSegments: 1,
    }),
  );
  bladeGeo.rotateX(Math.PI / 2);

  const footGeo = share(geos, new THREE.CylinderGeometry(0.01, 0.014, 0.016, 10));
  const ledGeo = share(geos, new THREE.BoxGeometry(0.018, 0.004, 0.006));
  const thrustMat = new THREE.MeshBasicMaterial({
    color: 0x8fbf9a,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  materials.push(thrustMat);

  for (const arm of arms) {
    const dirX = Math.sin(arm.θ);
    const dirZ = Math.cos(arm.θ);
    const explode = new THREE.Vector3(dirX, 0, dirZ).multiplyScalar(0.22);

    const armMesh = mesh(armGeo, mats.carbonArm);
    armMesh.position.set(dirX * ARM * 0.48, 0.006, dirZ * ARM * 0.48);
    armMesh.rotation.y = arm.θ;
    clipMeshes.push(armMesh);
    register("frame", armMesh, explode.clone().multiplyScalar(0.7));

    const mount = mesh(
      mountGeo,
      mats.alu,
      dirX * ARM,
      MOTOR_Z - 0.004,
      dirZ * ARM,
    );
    register("frame", mount, explode.clone());

    const wire = mesh(wireGeo, mats.plastic);
    wire.position.set(dirX * ARM * 0.5, 0.015, dirZ * ARM * 0.5);
    wire.rotation.z = Math.PI / 2;
    wire.rotation.y = arm.θ;
    register("escs", wire, explode.clone().multiplyScalar(0.5));

    const motorG = new THREE.Group();
    motorG.position.set(dirX * ARM, MOTOR_Z + 0.01, dirZ * ARM);
    const stator = mesh(statorGeo, mats.alu, 0, -0.002, 0);
    const wind = mesh(windGeo, mats.copper, 0, -0.001, 0);
    wind.rotation.x = Math.PI / 2;
    motorG.add(stator, wind);

    const rotor = new THREE.Group();
    const bell = mesh(bellGeo, mats.steel);
    const shaft = mesh(shaftGeo, mats.steel, 0, 0.01, 0);
    const cap = mesh(capGeo, mats.alu, 0, 0.01, 0);
    rotor.add(bell, shaft, cap);
    for (let m = 0; m < 8; m++) {
      const mag = mesh(magGeo, mats.goldpin);
      const a = (m / 8) * Math.PI * 2;
      mag.position.set(Math.cos(a) * 0.017, 0, Math.sin(a) * 0.017);
      mag.rotation.y = a;
      rotor.add(mag);
    }
    rotor.userData.cw = arm.cw;
    rotorPivots.push(rotor);
    motorG.add(rotor);
    register("motors", motorG, explode.clone().add(new THREE.Vector3(0, 0.05, 0)));

    const prop = new THREE.Group();
    prop.position.set(dirX * ARM, MOTOR_Z + 0.03, dirZ * ARM);
    const hub = mesh(hubGeo, mats.prop);
    const b1 = mesh(bladeGeo, mats.prop);
    const b2 = mesh(bladeGeo, mats.prop);
    b2.rotation.y = Math.PI;
    const pitch = arm.cw ? -0.12 : 0.12;
    b1.rotation.z = pitch;
    b2.rotation.z = pitch;
    prop.add(hub, b1, b2);
    prop.userData.cw = arm.cw;
    propPivots.push(prop);
    register("props", prop, explode.clone().add(new THREE.Vector3(0, 0.14, 0)));

    const cone = new THREE.Mesh(coneGeo, thrustMat);
    cone.position.set(dirX * ARM, MOTOR_Z - 0.09, dirZ * ARM);
    cone.renderOrder = 2;
    group.add(cone);
    thrustCones.push(cone);

    const foot = mesh(
      footGeo,
      mats.rubber,
      dirX * ARM * 0.72,
      -0.028,
      dirZ * ARM * 0.72,
    );
    register("frame", foot, new THREE.Vector3(0, -0.08, 0).add(explode.clone().multiplyScalar(0.3)));

    const ledMat = new THREE.MeshStandardMaterial({
      color: dirX < 0 ? 0xc4786a : 0x8fbf9a,
      emissive: dirX < 0 ? 0xc4786a : 0x8fbf9a,
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.1,
    });
    materials.push(ledMat);
    ledMats.push(ledMat);
    const led = mesh(ledGeo, ledMat, dirX * ARM * 0.55, 0.014, dirZ * ARM * 0.55);
    led.rotation.y = arm.θ;
    register("frame", led, explode.clone().multiplyScalar(0.6));
  }

  const esc = mesh(
    share(geos, new THREE.BoxGeometry(0.078, 0.006, 0.078)),
    mats.pcbDark,
    0,
    0.008,
    0,
  );
  register("escs", esc, new THREE.Vector3(0, 0.04, 0));

  const fc = new THREE.Group();
  fc.position.set(0, 0.018, 0);
  const fcBoard = mesh(
    share(geos, new THREE.BoxGeometry(0.072, 0.004, 0.048)),
    mats.pcb,
  );
  const mcu = mesh(
    share(geos, new THREE.BoxGeometry(0.018, 0.003, 0.018)),
    mats.chip,
    0.006,
    0.0035,
    0,
  );
  const usb = mesh(
    share(geos, new THREE.BoxGeometry(0.01, 0.004, 0.014)),
    mats.steel,
    0.04,
    0.001,
    0,
  );
  const crystal = mesh(
    share(geos, new THREE.BoxGeometry(0.008, 0.0022, 0.004)),
    mats.alu,
    0.02,
    0.003,
    0.014,
  );
  const capGeoSmall = share(geos, new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 10));
  const capPos = [
    [-0.028, 0.004, 0.016],
    [-0.028, 0.004, 0.008],
    [-0.028, 0.004, -0.008],
    [0.022, 0.004, -0.016],
  ] as const;
  fc.add(fcBoard, mcu, usb, crystal);
  for (const [x, y, z] of capPos) {
    fc.add(mesh(capGeoSmall, mats.goldpin, x, y, z));
  }
  const pinGeo = share(geos, new THREE.BoxGeometry(0.0016, 0.006, 0.0016));
  for (let i = 0; i < 8; i++) {
    fc.add(mesh(pinGeo, mats.goldpin, -0.032, 0.005, -0.014 + i * 0.004));
  }
  register("fc", fc, new THREE.Vector3(0, 0.09, 0));

  const imuChip = mesh(
    share(geos, new THREE.BoxGeometry(0.008, 0.0025, 0.008)),
    mats.chip,
  );
  const imuG = new THREE.Group();
  imuG.add(imuChip);
  imuG.position.set(-0.022, 0.0212, 0.01);
  imuObject = imuG;
  register("imu", imuG, new THREE.Vector3(-0.08, 0.12, 0.04));

  const magChip = mesh(
    share(geos, new THREE.BoxGeometry(0.007, 0.0022, 0.007)),
    mats.chip,
  );
  magChip.position.set(0, 0.118, 0);
  register("mag", magChip, new THREE.Vector3(0, 0.22, 0));

  const npu = new THREE.Group();
  npu.position.set(0, 0.028, 0);
  const npuBoard = mesh(
    share(geos, new THREE.BoxGeometry(0.07, 0.004, 0.07)),
    mats.pcbDark,
  );
  const npuChip = mesh(
    share(geos, new THREE.BoxGeometry(0.024, 0.004, 0.024)),
    mats.chip,
    0,
    0.004,
    0,
  );
  npu.add(npuBoard, npuChip);
  const finGeo = share(geos, new THREE.BoxGeometry(0.026, 0.008, 0.0022));
  for (let i = 0; i < 7; i++) {
    npu.add(mesh(finGeo, mats.alu, 0, 0.01, -0.012 + i * 0.004));
  }
  register("npu", npu, new THREE.Vector3(0, 0.13, 0));

  const batt = new THREE.Group();
  batt.position.set(0, -0.022, 0);
  const pack = mesh(
    share(geos, new THREE.BoxGeometry(0.13, 0.028, 0.07)),
    mats.battery,
  );
  const strapGeo = share(geos, new THREE.BoxGeometry(0.01, 0.002, 0.074));
  const s1 = mesh(strapGeo, mats.rubber, 0.03, 0.015, 0);
  const s2 = mesh(strapGeo, mats.rubber, -0.03, 0.015, 0);
  const xt = mesh(
    share(geos, new THREE.BoxGeometry(0.016, 0.012, 0.018)),
    mats.goldpin,
    0.074,
    0,
    0,
  );
  batt.add(pack, s1, s2, xt);
  register("battery", batt, new THREE.Vector3(0, -0.14, 0));

  const gps = new THREE.Group();
  gps.position.set(0, 0.072, -0.02);
  const mast = mesh(
    share(geos, new THREE.CylinderGeometry(0.004, 0.004, 0.05, 10)),
    mats.alu,
    0,
    0.02,
    0,
  );
  const puck = mesh(
    share(geos, new THREE.CylinderGeometry(0.022, 0.022, 0.01, 20)),
    mats.plastic,
    0,
    0.048,
    0,
  );
  const ceramic = mesh(
    share(geos, new THREE.CylinderGeometry(0.018, 0.018, 0.004, 20)),
    mats.ceramic,
    0,
    0.055,
    0,
  );
  gps.add(mast, puck, ceramic);
  register("gps", gps, new THREE.Vector3(0, 0.24, -0.04));

  const rx = new THREE.Group();
  rx.position.set(0, 0.02, -0.09);
  const rxBody = mesh(
    share(geos, new THREE.BoxGeometry(0.028, 0.01, 0.018)),
    mats.plastic,
  );
  const antGeo = share(geos, new THREE.CylinderGeometry(0.0016, 0.0016, 0.09, 8));
  const a1 = mesh(antGeo, mats.steel, 0.01, 0.04, -0.01);
  a1.rotation.x = 0.35;
  const a2 = mesh(antGeo, mats.steel, -0.01, 0.04, -0.01);
  a2.rotation.x = 0.35;
  rx.add(rxBody, a1, a2);
  register("rx", rx, new THREE.Vector3(0, 0.08, -0.16));

  const gimbalYaw = new THREE.Group();
  gimbalYaw.position.set(0, -0.01, 0.095);
  const yawRing = mesh(
    share(geos, new THREE.TorusGeometry(0.028, 0.003, 8, 24)),
    mats.alu,
  );
  yawRing.rotation.x = Math.PI / 2;
  const yawArm = mesh(
    share(geos, new THREE.BoxGeometry(0.006, 0.006, 0.03)),
    mats.alu,
    0,
    0,
    -0.02,
  );
  gimbalYaw.add(yawRing, yawArm);

  const gimbalPitch = new THREE.Group();
  gimbalPitch.position.set(0, 0, 0.012);
  const pitchBracket = mesh(
    share(geos, new THREE.BoxGeometry(0.044, 0.006, 0.006)),
    mats.alu,
    0,
    0.018,
    0,
  );
  const sideGeo = share(geos, new THREE.BoxGeometry(0.005, 0.032, 0.005));
  const sideL = mesh(sideGeo, mats.alu, -0.02, 0.004, 0);
  const sideR = mesh(sideGeo, mats.alu, 0.02, 0.004, 0);
  gimbalPitch.add(pitchBracket, sideL, sideR);

  const camBody = new THREE.Group();
  camBody.position.set(0, 0, 0.01);
  const body = mesh(
    share(geos, new THREE.BoxGeometry(0.032, 0.026, 0.024)),
    mats.plastic,
  );
  const barrel = mesh(
    share(geos, new THREE.CylinderGeometry(0.01, 0.011, 0.016, 20)),
    mats.steel,
    0,
    0,
    0.018,
  );
  barrel.rotation.x = Math.PI / 2;
  const glass = mesh(
    share(geos, new THREE.CylinderGeometry(0.008, 0.008, 0.004, 20)),
    mats.lens,
    0,
    0,
    0.028,
  );
  glass.rotation.x = Math.PI / 2;
  const hood = mesh(
    share(geos, new THREE.CylinderGeometry(0.012, 0.01, 0.006, 16)),
    mats.rubber,
    0,
    0,
    0.034,
  );
  hood.rotation.x = Math.PI / 2;
  camBody.add(body, barrel, glass, hood);

  const droneCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.04, 90);
  droneCam.position.set(0, 0, 0.03);
  camBody.add(droneCam);

  gimbalPitch.add(camBody);
  gimbalYaw.add(gimbalPitch);
  register("gimbal", gimbalYaw, new THREE.Vector3(0, -0.04, 0.16));

  tag(camBody, "camera");
  pieces.push({
    id: "camera",
    object: camBody,
    rest: camBody.position.clone(),
    explode: new THREE.Vector3(0, 0, 0.08),
  });

  return {
    group,
    pieces,
    propPivots,
    rotorPivots,
    thrustCones,
    gimbalYaw,
    gimbalPitch,
    droneCam,
    shellMeshes,
    clipMeshes,
    ledMats,
    imuObject,
    materials,
    textures,
    geometries: geos,
  };
}
