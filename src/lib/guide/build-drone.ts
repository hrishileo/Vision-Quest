import * as THREE from "three";
import { ARM, SPEC, Y, armXZ } from "./specs";
import {
  addCircleHole,
  addSlotHole,
  boxBeam,
  chamferRect,
  extrudePlate,
  hexHead,
  iBeam,
  knuckleShape,
  motorPlateShape,
  ospreyOutline,
  share,
} from "./cad";
import {
  carbonPhotoMat,
  makeBrushedTexture,
  makeCarbonTexture,
  makeMotorLabel,
  makePcbTexture,
  makePetgTexture,
  makePlateMark,
  photoMat,
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
  finishGroup: THREE.Group;
  skeletonOnly: THREE.Object3D[];
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

function bladeShape(): THREE.Shape {
  const r = SPEC.prop.radius;
  const s = new THREE.Shape();
  s.moveTo(0.008, 0.004);
  s.bezierCurveTo(0.028, 0.022, r * 0.38, 0.034, r * 0.62, 0.022);
  s.bezierCurveTo(r * 0.82, 0.012, r * 0.94, 0.006, r, 0.001);
  s.lineTo(r, -0.006);
  s.bezierCurveTo(r * 0.78, -0.024, r * 0.36, -0.03, 0.03, -0.016);
  s.bezierCurveTo(0.016, -0.008, 0.008, -0.002, 0.008, 0.004);
  return s;
}

export function buildDrone(): DroneBuild {
  const geos: THREE.BufferGeometry[] = [];
  const textures = [
    makeCarbonTexture(),
    makeBrushedTexture(),
    makePcbTexture(),
    makePetgTexture(),
    makePlateMark(),
    makeMotorLabel(),
  ];
  const [carbonMap, brushedMap, pcbMap, petgMap, plateMark, motorLabel] = textures;

  const photoFc = photoMat("/bom/tex/fc.jpg", 0.42);
  const photoEsc = photoMat("/bom/tex/esc.jpg", 0.5);
  const photoOrin = photoMat("/bom/tex/orin.jpg", 0.4);
  const photoCam = photoMat("/bom/tex/camera.jpg", 0.45);
  const photoBatt = photoMat("/bom/tex/battery.jpg", 0.55);
  const photoGps = photoMat("/bom/tex/gps.jpg", 0.48);
  const photoGimbal = photoMat("/bom/tex/gimbal.jpg", 0.4);
  const photoMotor = photoMat("/bom/tex/motor.jpg", 0.38);
  const carbonPhoto = carbonPhotoMat();

  const mats = {
    carbon: carbonPhoto,
    carbonArm: new THREE.MeshStandardMaterial({
      map: carbonPhoto.map,
      color: 0xa8adb6,
      roughness: 0.36,
      metalness: 0.44,
    }),
    carbonDark: new THREE.MeshStandardMaterial({
      map: carbonPhoto.map,
      color: 0x6a6e76,
      roughness: 0.4,
      metalness: 0.38,
    }),
    alu: new THREE.MeshStandardMaterial({
      map: brushedMap,
      color: 0xcfd3da,
      roughness: 0.24,
      metalness: 0.9,
    }),
    aluGold: new THREE.MeshStandardMaterial({
      map: brushedMap,
      color: 0xb89a5a,
      roughness: 0.28,
      metalness: 0.85,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0x5c6068,
      roughness: 0.3,
      metalness: 0.82,
    }),
    copper: new THREE.MeshStandardMaterial({
      color: 0xc07838,
      roughness: 0.34,
      metalness: 0.92,
    }),
    pcb: new THREE.MeshStandardMaterial({
      map: pcbMap,
      color: 0x8fbf9a,
      roughness: 0.55,
      metalness: 0.08,
    }),
    pcbDark: new THREE.MeshStandardMaterial({
      color: 0x161c20,
      roughness: 0.48,
      metalness: 0.12,
    }),
    chip: new THREE.MeshStandardMaterial({
      color: 0x222326,
      roughness: 0.46,
      metalness: 0.22,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x1a1a1c,
      roughness: 0.85,
      metalness: 0.05,
    }),
    battery: new THREE.MeshStandardMaterial({
      color: 0x1c1a16,
      roughness: 0.7,
      metalness: 0.08,
    }),
    tattu: new THREE.MeshStandardMaterial({
      color: 0xe8b84a,
      roughness: 0.48,
      metalness: 0.12,
    }),
    prop: new THREE.MeshStandardMaterial({
      map: carbonMap,
      color: 0x1a1c20,
      roughness: 0.34,
      metalness: 0.28,
    }),
    plastic: new THREE.MeshStandardMaterial({
      color: 0x1e2024,
      roughness: 0.5,
      metalness: 0.12,
    }),
    goldpin: new THREE.MeshStandardMaterial({
      color: 0x8a7348,
      roughness: 0.35,
      metalness: 0.85,
    }),
    ceramic: new THREE.MeshStandardMaterial({
      color: 0xe8e4da,
      roughness: 0.45,
      metalness: 0.04,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x8fbf9a,
      roughness: 0.32,
      metalness: 0.4,
      emissive: 0x8fbf9a,
      emissiveIntensity: 0.18,
    }),
    petg: new THREE.MeshStandardMaterial({
      map: petgMap,
      color: 0x8a9890,
      roughness: 0.52,
      metalness: 0.06,
    }),
    tpu: new THREE.MeshStandardMaterial({
      color: 0x2c2c28,
      roughness: 0.94,
      metalness: 0.02,
    }),
    holybro: new THREE.MeshStandardMaterial({
      color: 0xd2652a,
      roughness: 0.4,
      metalness: 0.16,
    }),
    helix: new THREE.MeshStandardMaterial({
      color: 0xf0ebe0,
      roughness: 0.52,
      metalness: 0.04,
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
    motorBell: new THREE.MeshStandardMaterial({
      color: 0x16181c,
      roughness: 0.28,
      metalness: 0.62,
    }),
    motorLabel: new THREE.MeshStandardMaterial({
      map: motorLabel,
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.2,
    }),
    plateMark: new THREE.MeshBasicMaterial({
      map: plateMark,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  };

  const materials: THREE.Material[] = [
    ...Object.values(mats),
    photoFc,
    photoEsc,
    photoOrin,
    photoCam,
    photoBatt,
    photoGps,
    photoGimbal,
    photoMotor,
  ];
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

  const register = (id: string, object: THREE.Object3D, explode: THREE.Vector3) => {
    tag(object, id);
    group.add(object);
    pieces.push({ id, object, rest: object.position.clone(), explode });
  };

  const F = SPEC.frame;
  const boltGeo = share(geos, hexHead(0.0024, 0.0026));
  const bolt = (x: number, y: number, z: number, mat = mats.steel) => mesh(boltGeo, mat, x, y, z);

  const topShape = ospreyOutline(F.plateZ, F.plateX);
  addCircleHole(topShape, 0.01525, 0.01525, 0.0018);
  addCircleHole(topShape, -0.01525, 0.01525, 0.0018);
  addCircleHole(topShape, 0.01525, -0.01525, 0.0018);
  addCircleHole(topShape, -0.01525, -0.01525, 0.0018);
  addCircleHole(topShape, 0.055, 0.048, 0.0032);
  addCircleHole(topShape, -0.055, 0.048, 0.0032);
  addCircleHole(topShape, 0.055, -0.048, 0.0032);
  addCircleHole(topShape, -0.055, -0.048, 0.0032);
  addCircleHole(topShape, 0.0, 0.086, 0.007);
  addCircleHole(topShape, 0.028, 0.07, 0.005);
  addCircleHole(topShape, -0.028, 0.07, 0.005);
  addCircleHole(topShape, 0.032, -0.08, 0.006);
  addCircleHole(topShape, -0.032, -0.08, 0.006);
  addCircleHole(topShape, 0.0, -0.096, 0.008);
  addSlotHole(topShape, 0.038, 0.0, 0.01, 0.046);
  addSlotHole(topShape, -0.038, 0.0, 0.01, 0.046);
  addSlotHole(topShape, 0.0, 0.048, 0.028, 0.014);
  addSlotHole(topShape, 0.0, -0.052, 0.026, 0.016);
  const topGeo = share(geos, extrudePlate(topShape, F.plateT));
  const topPlate = mesh(topGeo, mats.carbon, 0, Y.topPlate, 0);
  shellMeshes.push(topPlate);
  clipMeshes.push(topPlate);
  register("frame", topPlate, new THREE.Vector3(0, 0.16, 0));
  const mark = mesh(share(geos, new THREE.PlaneGeometry(0.11, 0.11)), mats.plateMark, 0, Y.topPlate + F.plateT / 2 + 0.0003, -0.012);
  mark.rotation.x = -Math.PI / 2;
  mark.castShadow = false;
  register("frame", mark, new THREE.Vector3(0, 0.165, 0));

  const botShape = ospreyOutline(F.plateZ * 0.92, F.plateX * 0.94);
  addSlotHole(botShape, 0.0, 0.0, 0.072, 0.048);
  addCircleHole(botShape, 0.055, 0.044, 0.0032);
  addCircleHole(botShape, -0.055, 0.044, 0.0032);
  addCircleHole(botShape, 0.055, -0.044, 0.0032);
  addCircleHole(botShape, -0.055, -0.044, 0.0032);
  const botGeo = share(geos, extrudePlate(botShape, F.plateT));
  const botPlate = mesh(botGeo, mats.carbon, 0, Y.botPlate, 0);
  shellMeshes.push(botPlate);
  clipMeshes.push(botPlate);
  register("frame", botPlate, new THREE.Vector3(0, -0.02, 0));

  const standGeo = share(
    geos,
    new THREE.CylinderGeometry(F.standoffR, F.standoffR, F.standoffH, 8),
  );
  for (const [x, z] of [
    [0.055, 0.048],
    [-0.055, 0.048],
    [0.055, -0.048],
    [-0.055, -0.048],
  ] as const) {
    const s = mesh(standGeo, mats.alu, x, (Y.botPlate + Y.topPlate) / 2, z);
    register("frame", s, new THREE.Vector3(0, 0.08, 0));
    register("frame", bolt(x, Y.topPlate + F.plateT / 2 + 0.0014, z, mats.aluGold), new THREE.Vector3(0, 0.17, 0));
  }

  const ribShape = chamferRect(0.01, 0.09, 0.002);
  const ribGeo = share(geos, extrudePlate(ribShape, 0.034));
  for (const x of [-0.028, 0.028]) {
    const rib = mesh(ribGeo, mats.carbonDark, x, (Y.botPlate + Y.topPlate) / 2, 0.004);
    clipMeshes.push(rib);
    register("frame", rib, new THREE.Vector3(x * 0.4, 0.09, 0));
  }
  const spine = mesh(share(geos, boxBeam(0.008, 0.006, 0.16, 0.001)), mats.alu, 0, Y.topPlate + 0.005, -0.01);
  register("frame", spine, new THREE.Vector3(0, 0.14, 0));

  const railGeo = share(
    geos,
    new THREE.CylinderGeometry(F.railOd / 2, F.railOd / 2, F.railLen, 14),
  );
  railGeo.rotateX(Math.PI / 2);
  const railSpread = F.railSpread / 2;
  for (const x of [-railSpread, railSpread]) {
    const rail = mesh(railGeo, mats.carbonArm, x, Y.rail, -0.01);
    shellMeshes.push(rail);
    clipMeshes.push(rail);
    register("frame", rail, new THREE.Vector3(x * 0.45, 0.12, 0));
  }
  const clampShape = chamferRect(0.02, 0.018, 0.002);
  const clampGeo = share(geos, extrudePlate(clampShape, 0.01));
  for (const x of [-railSpread, railSpread]) {
    for (const z of [-0.055, 0.045]) {
      const c = mesh(clampGeo, mats.alu, x, Y.rail, z);
      register("frame", c, new THREE.Vector3(x * 0.3, 0.1, z * 0.2));
    }
  }

  const boomShape = chamferRect(0.028, 0.055, 0.004);
  const boomGeo = share(geos, extrudePlate(boomShape, 0.008));
  const boom = mesh(boomGeo, mats.carbonDark, 0, Y.arm + 0.002, 0.128);
  shellMeshes.push(boom);
  clipMeshes.push(boom);
  register("frame", boom, new THREE.Vector3(0, 0.06, 0.1));

  const keelShape = chamferRect(0.036, 0.11, 0.006);
  const keelGeo = share(geos, extrudePlate(keelShape, 0.004));
  const keel = mesh(keelGeo, mats.carbonDark, 0, Y.battPlate, 0.01);
  shellMeshes.push(keel);
  register("frame", keel, new THREE.Vector3(0, -0.05, 0));

  const arms: { id: "fl" | "fr" | "bl" | "br"; θ: number; cw: boolean }[] = [
    { id: "fr", θ: Math.PI / 4, cw: false },
    { id: "fl", θ: -Math.PI / 4, cw: true },
    { id: "br", θ: (3 * Math.PI) / 4, cw: true },
    { id: "bl", θ: (-3 * Math.PI) / 4, cw: false },
  ];

  const jointR = 0.078;
  const tubeLen = ARM - jointR - 0.024;
  const armGeo = share(geos, iBeam(F.armW, F.armH, tubeLen, 0.0026, 0.0028));
  const webGeo = share(geos, boxBeam(F.armW * 0.18, 0.002, tubeLen * 0.55, 0.0004));
  const jointGeo = share(geos, extrudePlate(knuckleShape(), F.joint.y));
  const mountGeo = share(geos, extrudePlate(motorPlateShape(F.motorPlate, F.motorMount), 0.005));
  const hingeGeo = share(geos, new THREE.CylinderGeometry(0.005, 0.005, 0.032, 12));
  const wireGeo = share(geos, new THREE.CylinderGeometry(0.0022, 0.0022, tubeLen * 0.88, 8));
  const pocketGeo = share(geos, new THREE.BoxGeometry(0.012, 0.007, 0.022));

  const bellGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.motor.od / 2 - 0.0004, SPEC.motor.od / 2 + 0.0006, 0.018, 32),
  );
  const statorGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.motor.statorD / 2, SPEC.motor.statorD / 2, SPEC.motor.statorH, 24),
  );
  const windGeo = share(geos, new THREE.TorusGeometry(SPEC.motor.statorD / 2 + 0.0014, 0.0038, 8, 24));
  const shaftGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.motor.shaftD / 2, SPEC.motor.shaftD / 2, SPEC.motor.shaftL + 0.012, 12),
  );
  const threadGeo = share(geos, new THREE.TorusGeometry(SPEC.motor.shaftD / 2 + 0.0003, 0.00035, 6, 12));
  const capGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.motor.od / 2 - 0.006, SPEC.motor.od / 2 - 0.002, 0.0028, 28),
  );
  const baseGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.motor.od / 2 - 0.001, SPEC.motor.od / 2 + 0.001, 0.004, 24),
  );
  const tabEx = share(geos, extrudePlate(chamferRect(0.01, 0.008, 0.0015), 0.003));
  const hubGeo = share(geos, new THREE.CylinderGeometry(SPEC.prop.hubR, SPEC.prop.hubR + 0.002, 0.008, 16));
  const magGeo = share(geos, new THREE.BoxGeometry(0.0046, 0.011, 0.007));
  const ventGeo = share(geos, new THREE.BoxGeometry(0.011, 0.012, 0.004));
  const labelGeo = share(geos, new THREE.CircleGeometry(SPEC.motor.od / 2 - 0.007, 24));
  const coneGeo = share(geos, new THREE.ConeGeometry(0.04, 0.2, 12, 1, true));
  coneGeo.rotateX(Math.PI);
  const bladeGeo = share(
    geos,
    new THREE.ExtrudeGeometry(bladeShape(), {
      depth: SPEC.prop.thick,
      bevelEnabled: true,
      bevelThickness: 0.0005,
      bevelSize: 0.0008,
      bevelSegments: 1,
    }),
  );
  bladeGeo.rotateX(Math.PI / 2);
  const nutGeo = share(geos, new THREE.CylinderGeometry(0.0052, 0.0052, 0.005, 6));
  const footShape = chamferRect(SPEC.print.foot.xy, SPEC.print.foot.xy, 0.004);
  const footGeo = share(geos, extrudePlate(footShape, SPEC.print.foot.h));
  const vertGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.landing.vertOd / 2, SPEC.landing.skidOd / 2, SPEC.landing.vertH, 12),
  );
  const skidGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.landing.skidOd / 2, SPEC.landing.skidOd / 2, SPEC.landing.skidL, 10),
  );
  skidGeo.rotateX(Math.PI / 2);
  const teeShape = chamferRect(0.03, 0.028, 0.004);
  const teeGeo = share(geos, extrudePlate(teeShape, 0.012));
  const ledGeo = share(geos, new THREE.BoxGeometry(F.led.x, F.led.y, F.led.z));
  const clipGeo = share(geos, new THREE.TorusGeometry(F.armW / 2 + 0.001, 0.003, 8, 14, Math.PI));
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
    const [dirX, dirZ] = armXZ(arm.θ);
    const explode = new THREE.Vector3(dirX, 0, dirZ).normalize().multiplyScalar(0.28);

    const joint = mesh(jointGeo, mats.alu);
    joint.position.set(Math.sin(arm.θ) * jointR, Y.arm, Math.cos(arm.θ) * jointR);
    joint.rotation.y = arm.θ;
    clipMeshes.push(joint);
    register("frame", joint, explode.clone().multiplyScalar(0.45));

    const hinge = mesh(hingeGeo, mats.steel);
    hinge.position.copy(joint.position);
    hinge.rotation.z = Math.PI / 2;
    hinge.rotation.y = arm.θ;
    register("frame", hinge, explode.clone().multiplyScalar(0.45));

    const tubeMid = jointR + tubeLen * 0.5;
    const armMesh = mesh(armGeo, mats.carbonArm);
    armMesh.position.set(Math.sin(arm.θ) * tubeMid, Y.arm, Math.cos(arm.θ) * tubeMid);
    armMesh.rotation.y = arm.θ;
    shellMeshes.push(armMesh);
    clipMeshes.push(armMesh);
    register("frame", armMesh, explode.clone().multiplyScalar(0.7));

    const web = mesh(webGeo, mats.carbonDark);
    web.position.set(Math.sin(arm.θ) * tubeMid, Y.arm + F.armH / 2 + 0.0006, Math.cos(arm.θ) * tubeMid);
    web.rotation.y = arm.θ;
    register("frame", web, explode.clone().multiplyScalar(0.7));
    for (const k of [-0.32, 0, 0.32]) {
      const pk = mesh(pocketGeo, mats.chip);
      pk.position.set(
        Math.sin(arm.θ) * (tubeMid + k * tubeLen * 0.28),
        Y.arm,
        Math.cos(arm.θ) * (tubeMid + k * tubeLen * 0.28),
      );
      pk.rotation.y = arm.θ;
      register("frame", pk, explode.clone().multiplyScalar(0.7));
    }

    const mount = mesh(mountGeo, mats.alu, dirX, Y.arm + 0.004, dirZ);
    mount.rotation.y = arm.θ;
    register("frame", mount, explode.clone());
    for (const [sx, sz] of [
      [0.0095, 0.0095],
      [-0.0095, 0.0095],
      [0.0095, -0.0095],
      [-0.0095, -0.0095],
    ] as const) {
      const worldX = dirX + Math.cos(arm.θ) * sx - Math.sin(arm.θ) * sz;
      const worldZ = dirZ + Math.sin(arm.θ) * sx + Math.cos(arm.θ) * sz;
      register(
        "frame",
        bolt(worldX, Y.arm + 0.008, worldZ, mats.aluGold),
        explode.clone().add(new THREE.Vector3(0, 0.02, 0)),
      );
    }

    const wire = mesh(wireGeo, mats.copper);
    wire.position.set(Math.sin(arm.θ) * tubeMid, Y.arm - 0.007, Math.cos(arm.θ) * tubeMid);
    wire.rotation.y = arm.θ;
    register("escs", wire, explode.clone().multiplyScalar(0.5));

    const motorG = new THREE.Group();
    motorG.position.set(dirX, Y.arm + 0.026, dirZ);
    const stator = mesh(statorGeo, mats.alu, 0, 0, 0);
    const wind = mesh(windGeo, mats.copper, 0, 0.001, 0);
    wind.rotation.x = Math.PI / 2;
    const base = mesh(baseGeo, mats.steel, 0, -0.011, 0);
    motorG.add(stator, wind, base);
    for (let t = 0; t < 4; t++) {
      const a = (t / 4) * Math.PI * 2 + Math.PI / 4;
      const tab = mesh(tabEx, mats.steel);
      tab.position.set(Math.cos(a) * 0.018, -0.013, Math.sin(a) * 0.018);
      tab.rotation.y = a;
      motorG.add(tab);
    }

    const rotor = new THREE.Group();
    const bell = mesh(bellGeo, mats.motorBell, 0, 0.004, 0);
    const shaft = mesh(shaftGeo, mats.steel, 0, 0.022, 0);
    const cap = mesh(capGeo, mats.alu, 0, 0.014, 0);
    const label = mesh(labelGeo, mats.motorLabel, 0, 0.0156, 0);
    label.rotation.x = -Math.PI / 2;
    label.castShadow = false;
    rotor.add(bell, shaft, cap, label);
    for (let i = 0; i < 3; i++) {
      const th = mesh(threadGeo, mats.steel, 0, 0.03 + i * 0.002, 0);
      th.rotation.x = Math.PI / 2;
      rotor.add(th);
    }
    const poleR = SPEC.motor.od / 2 - 0.004;
    for (let i = 0; i < SPEC.motor.poles; i++) {
      const mag = mesh(magGeo, mats.aluGold);
      const a = (i / SPEC.motor.poles) * Math.PI * 2;
      mag.position.set(Math.cos(a) * poleR, 0.002, Math.sin(a) * poleR);
      mag.rotation.y = a;
      rotor.add(mag);
    }
    for (let i = 0; i < 6; i++) {
      const vent = mesh(ventGeo, mats.chip);
      const a = (i / 6) * Math.PI * 2;
      vent.position.set(Math.cos(a) * (SPEC.motor.od / 2 - 0.0004), 0.004, Math.sin(a) * (SPEC.motor.od / 2 - 0.0004));
      vent.rotation.y = a;
      rotor.add(vent);
    }
    rotor.userData.cw = arm.cw;
    rotorPivots.push(rotor);
    motorG.add(rotor);
    register("motors", motorG, explode.clone().add(new THREE.Vector3(0, 0.06, 0)));

    const prop = new THREE.Group();
    prop.position.set(dirX, Y.arm + 0.052, dirZ);
    const hub = mesh(hubGeo, mats.prop);
    const nut = mesh(nutGeo, mats.steel, 0, 0.007, 0);
    const b1 = mesh(bladeGeo, mats.prop);
    const b2 = mesh(bladeGeo, mats.prop);
    b2.rotation.y = Math.PI;
    const pitch = arm.cw ? -0.16 : 0.16;
    b1.rotation.z = pitch;
    b2.rotation.z = pitch;
    prop.add(hub, nut, b1, b2);
    prop.userData.cw = arm.cw;
    propPivots.push(prop);
    register("props", prop, explode.clone().add(new THREE.Vector3(0, 0.16, 0)));

    const cone = new THREE.Mesh(coneGeo, thrustMat);
    cone.position.set(dirX, Y.arm - 0.1, dirZ);
    cone.renderOrder = 2;
    group.add(cone);
    thrustCones.push(cone);

    const gearR = ARM * 0.58;
    const gx = Math.sin(arm.θ) * gearR;
    const gz = Math.cos(arm.θ) * gearR;
    const tee = mesh(teeGeo, mats.alu, gx, Y.arm - 0.006, gz);
    tee.rotation.y = arm.θ;
    register("frame", tee, explode.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -0.04, 0)));
    const vert = mesh(vertGeo, mats.carbonArm, gx, Y.arm - SPEC.landing.vertH / 2 - 0.01, gz);
    clipMeshes.push(vert);
    register("frame", vert, new THREE.Vector3(0, -0.1, 0).add(explode.clone().multiplyScalar(0.3)));
    const skid = mesh(skidGeo, mats.carbonArm, gx, Y.foot + 0.018, gz);
    skid.rotation.y = arm.θ + Math.PI / 2;
    register("frame", skid, new THREE.Vector3(0, -0.12, 0).add(explode.clone().multiplyScalar(0.25)));
    const foot = mesh(footGeo, mats.tpu, gx, Y.foot, gz);
    register("frame", foot, new THREE.Vector3(0, -0.14, 0).add(explode.clone().multiplyScalar(0.25)));

    const ledMat = new THREE.MeshStandardMaterial({
      color: dirX < 0 ? 0xc4786a : 0x8fbf9a,
      emissive: dirX < 0 ? 0xc4786a : 0x8fbf9a,
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.1,
    });
    materials.push(ledMat);
    ledMats.push(ledMat);
    const led = mesh(ledGeo, ledMat, Math.sin(arm.θ) * ARM * 0.42, Y.arm + 0.008, Math.cos(arm.θ) * ARM * 0.42);
    led.rotation.y = arm.θ;
    register("frame", led, explode.clone().multiplyScalar(0.55));

    if (arm.id === "br" || arm.id === "bl") {
      const clip = mesh(clipGeo, mats.petg);
      clip.position.set(Math.sin(arm.θ) * ARM * 0.5, Y.arm, Math.cos(arm.θ) * ARM * 0.5);
      clip.rotation.y = arm.θ;
      clip.rotation.z = Math.PI / 2;
      register("rx", clip, explode.clone().multiplyScalar(0.4));
    }
  }

  const escBody = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.esc.x, SPEC.esc.y, SPEC.esc.z)),
    mats.pcbDark,
    0,
    Y.esc,
    0,
  );
  register("escs", escBody, new THREE.Vector3(0, 0.05, 0));
  const escFace = mesh(
    share(geos, new THREE.PlaneGeometry(SPEC.esc.x * 0.98, SPEC.esc.z * 0.98)),
    photoEsc,
    0,
    Y.esc + SPEC.esc.y / 2 + 0.0004,
    0,
  );
  escFace.rotation.x = -Math.PI / 2;
  escFace.castShadow = false;
  register("escs", escFace, new THREE.Vector3(0, 0.05, 0));
  const mosGeo = share(geos, new THREE.BoxGeometry(0.008, 0.003, 0.01));
  for (let i = 0; i < 4; i++) {
    const mx = -0.014 + (i % 2) * 0.028;
    const mz = -0.012 + Math.floor(i / 2) * 0.024;
    const mos = mesh(mosGeo, mats.steel, mx, Y.esc + 0.006, mz);
    register("escs", mos, new THREE.Vector3(0, 0.05, 0));
  }

  const fc = new THREE.Group();
  fc.position.set(0, Y.fc, 0);
  const fcCase = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.fc.x, SPEC.fc.y, SPEC.fc.z)),
    mats.plastic,
  );
  const fcFace = mesh(
    share(geos, new THREE.PlaneGeometry(SPEC.fc.x * 0.98, SPEC.fc.z * 0.92)),
    photoFc,
    0,
    SPEC.fc.y / 2 + 0.0005,
    -0.002,
  );
  fcFace.rotation.x = -Math.PI / 2;
  fcFace.castShadow = false;
  const fcStripe = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.fc.x + 0.0004, 0.0032, 0.007)),
    mats.holybro,
    0,
    SPEC.fc.y / 2 + 0.0006,
    0.014,
  );
  const usb = mesh(
    share(geos, new THREE.BoxGeometry(0.012, 0.005, 0.008)),
    mats.steel,
    SPEC.fc.x / 2 - 0.002,
    -0.002,
    0.01,
  );
  const pwm = mesh(
    share(geos, new THREE.BoxGeometry(0.028, 0.004, 0.008)),
    mats.goldpin,
    0,
    -SPEC.fc.y / 2 + 0.002,
    SPEC.fc.z / 2 - 0.004,
  );
  fc.add(fcCase, fcFace, fcStripe, usb, pwm);
  const gromGeo = share(geos, new THREE.CylinderGeometry(0.004, 0.004, 0.006, 10));
  for (const [x, z] of [
    [0.01525, 0.01525],
    [-0.01525, 0.01525],
    [0.01525, -0.01525],
    [-0.01525, -0.01525],
  ] as const) {
    fc.add(mesh(gromGeo, mats.rubber, x, -SPEC.fc.y / 2 - 0.004, z));
  }
  register("fc", fc, new THREE.Vector3(0, 0.1, 0));

  const imuG = new THREE.Group();
  imuG.position.set(-0.012, Y.imu, 0.008);
  const imuChip = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.imu.x, SPEC.imu.y, SPEC.imu.z)),
    mats.chip,
  );
  const imuMark = mesh(
    share(geos, new THREE.BoxGeometry(0.003, 0.0006, 0.003)),
    mats.accent,
    0,
    SPEC.imu.y / 2 + 0.0004,
    0,
  );
  imuG.add(imuChip, imuMark);
  imuObject = imuG;
  register("imu", imuG, new THREE.Vector3(-0.08, 0.14, 0.04));

  const camMountShape = chamferRect(SPEC.print.camMount.x, SPEC.print.camMount.z, 0.006);
  addCircleHole(camMountShape, 0.015, 0.01, 0.0016);
  addCircleHole(camMountShape, -0.015, 0.01, 0.0016);
  const camMount = mesh(
    share(geos, extrudePlate(camMountShape, SPEC.print.camMount.y)),
    mats.petg,
    0.0,
    Y.topPlate + 0.006,
    0.055,
  );
  register("imu", camMount, new THREE.Vector3(0, 0.12, 0.08));

  const magChip = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.mag.x, SPEC.mag.y, SPEC.mag.z)),
    mats.chip,
    0,
    Y.gpsBoard + 0.014,
    -0.072,
  );
  register("mag", magChip, new THREE.Vector3(0, 0.24, -0.04));

  const npu = new THREE.Group();
  npu.position.set(0, Y.orin, -0.035);
  const trayShape = chamferRect(SPEC.print.orinTray.x, SPEC.print.orinTray.z, 0.008);
  addSlotHole(trayShape, 0, 0.012, 0.05, 0.028);
  addSlotHole(trayShape, 0, -0.018, 0.05, 0.022);
  const tray = mesh(
    share(geos, extrudePlate(trayShape, SPEC.print.orinTray.y)),
    mats.petg,
    0,
    -0.01,
    0,
  );
  const carrier = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.npu.pcbX, SPEC.npu.pcbY, SPEC.npu.pcbZ)),
    mats.pcbDark,
    0,
    0.0,
    0,
  );
  const module = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.npu.moduleX, SPEC.npu.moduleY, SPEC.npu.moduleZ)),
    mats.chip,
    0,
    0.004,
    -0.004,
  );
  const orinFace = mesh(
    share(geos, new THREE.PlaneGeometry(SPEC.npu.moduleX * 0.98, SPEC.npu.moduleZ * 0.96)),
    photoOrin,
    0,
    0.0072,
    -0.004,
  );
  orinFace.rotation.x = -Math.PI / 2;
  orinFace.castShadow = false;
  const sink = mesh(
    share(geos, new THREE.BoxGeometry(0.058, 0.004, 0.038)),
    mats.alu,
    0,
    0.012,
    -0.004,
  );
  npu.add(tray, carrier, module, orinFace, sink);
  const finGeo = share(geos, new THREE.BoxGeometry(0.056, 0.014, 0.0016));
  for (let i = 0; i < 11; i++) {
    npu.add(mesh(finGeo, mats.alu, 0, 0.02, -0.022 + i * 0.004));
  }
  const usbc = mesh(
    share(geos, new THREE.BoxGeometry(0.01, 0.004, 0.014)),
    mats.steel,
    0,
    0.002,
    -SPEC.npu.pcbZ / 2,
  );
  const csi = mesh(
    share(geos, new THREE.BoxGeometry(0.018, 0.003, 0.008)),
    mats.goldpin,
    0,
    0.004,
    SPEC.npu.pcbZ / 2 - 0.004,
  );
  npu.add(usbc, csi);
  register("npu", npu, new THREE.Vector3(0, 0.16, -0.04));

  const buck = mesh(
    share(geos, new THREE.BoxGeometry(0.04, 0.012, 0.025)),
    mats.pcb,
    0.05,
    Y.orin - 0.008,
    0.04,
  );
  register("battery", buck, new THREE.Vector3(0.08, 0.08, 0.04));
  const ubec = mesh(
    share(geos, new THREE.BoxGeometry(0.03, 0.008, 0.016)),
    mats.pcbDark,
    -0.05,
    Y.esc + 0.01,
    -0.05,
  );
  register("battery", ubec, new THREE.Vector3(-0.08, 0.06, -0.04));

  const batt = new THREE.Group();
  batt.position.set(0, Y.batt, 0);
  const trayBShape = chamferRect(SPEC.print.battTray.x, SPEC.print.battTray.z, 0.008);
  addSlotHole(trayBShape, 0.04, 0, 0.018, 0.036);
  addSlotHole(trayBShape, -0.04, 0, 0.018, 0.036);
  const trayB = mesh(
    share(geos, extrudePlate(trayBShape, SPEC.print.battTray.y)),
    mats.petg,
    0,
    -SPEC.battery.y / 2 - SPEC.print.battTray.y / 2,
    0,
  );
  const pack = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.battery.x, SPEC.battery.y, SPEC.battery.z)),
    mats.battery,
  );
  const battFace = mesh(
    share(geos, new THREE.PlaneGeometry(SPEC.battery.x * 0.94, SPEC.battery.y * 0.88)),
    photoBatt,
    0,
    0.004,
    SPEC.battery.z / 2 + 0.0004,
  );
  battFace.castShadow = false;
  const stripe = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.battery.x + 0.0004, 0.01, SPEC.battery.z + 0.0006)),
    mats.tattu,
    0,
    0.012,
    0,
  );
  const strapGeo = share(geos, new THREE.BoxGeometry(0.014, 0.003, SPEC.print.battTray.z + 0.006));
  const s1 = mesh(strapGeo, mats.rubber, 0.04, SPEC.battery.y / 2 + 0.006, 0);
  const s2 = mesh(strapGeo, mats.rubber, -0.04, SPEC.battery.y / 2 + 0.006, 0);
  const xt = mesh(
    share(geos, new THREE.BoxGeometry(0.018, 0.014, 0.02)),
    mats.goldpin,
    SPEC.battery.x / 2 + 0.006,
    0.004,
    0,
  );
  batt.add(trayB, pack, battFace, stripe, s1, s2, xt);
  register("battery", batt, new THREE.Vector3(0, -0.16, 0));

  const gps = new THREE.Group();
  gps.position.set(0, 0, -0.078);
  const collar = mesh(
    share(
      geos,
      new THREE.CylinderGeometry(
        SPEC.print.gpsCollar.od / 2,
        SPEC.print.gpsCollar.od / 2,
        SPEC.print.gpsCollar.h,
        14,
      ),
    ),
    mats.tpu,
    0,
    Y.platform + 0.008,
    0,
  );
  const mast = mesh(
    share(
      geos,
      new THREE.CylinderGeometry(SPEC.gps.mastR, SPEC.gps.mastR, SPEC.gps.mastH, 10),
    ),
    mats.alu,
    0,
    Y.platform + SPEC.gps.mastH / 2,
    0,
  );
  const board = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.gps.boardX, SPEC.gps.boardY, SPEC.gps.boardZ)),
    mats.plastic,
    0,
    Y.gpsBoard,
    0,
  );
  const gpsFace = mesh(
    share(geos, new THREE.PlaneGeometry(SPEC.gps.boardX * 0.94, SPEC.gps.boardZ * 0.88)),
    photoGps,
    0,
    Y.gpsBoard + SPEC.gps.boardY / 2 + 0.0004,
    0,
  );
  gpsFace.rotation.x = -Math.PI / 2;
  gpsFace.castShadow = false;
  const helix = mesh(
    share(
      geos,
      new THREE.CylinderGeometry(SPEC.gps.helixD / 2 * 0.42, SPEC.gps.helixD / 2, SPEC.gps.helixH * 0.85, 20),
    ),
    mats.helix,
    0,
    Y.helix,
    0,
  );
  const helixCap = mesh(
    share(geos, new THREE.SphereGeometry(SPEC.gps.helixD / 2 * 0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
    mats.helix,
    0,
    Y.helix + SPEC.gps.helixH * 0.42,
    0,
  );
  const ringGeo = share(geos, new THREE.TorusGeometry(SPEC.gps.helixD / 2 - 0.002, 0.0016, 6, 16));
  gps.add(collar, mast, board, gpsFace, helix, helixCap);
  for (let i = 0; i < 7; i++) {
    const ring = mesh(ringGeo, mats.ceramic, 0, Y.gpsBoard + SPEC.gps.boardY / 2 + 0.008 + i * 0.0075, 0);
    ring.rotation.x = 0.35;
    gps.add(ring);
  }
  register("gps", gps, new THREE.Vector3(0, 0.26, -0.06));

  const rx = new THREE.Group();
  rx.position.set(-0.038, Y.topPlate + 0.01, -0.082);
  const rxBody = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.rx.x, SPEC.rx.y, SPEC.rx.z)),
    mats.plastic,
  );
  const antGeo = share(
    geos,
    new THREE.CylinderGeometry(SPEC.ant.r, SPEC.ant.r, SPEC.ant.l, 8),
  );
  const a1 = mesh(antGeo, mats.steel, 0.008, SPEC.ant.l / 2 - 0.01, -0.004);
  a1.rotation.x = 0.4;
  const a2 = mesh(antGeo, mats.steel, -0.008, SPEC.ant.l / 2 - 0.01, -0.004);
  a2.rotation.x = 0.4;
  rx.add(rxBody, a1, a2);
  register("rx", rx, new THREE.Vector3(-0.08, 0.1, -0.16));

  const gimbalYaw = new THREE.Group();
  gimbalYaw.position.set(0, Y.gimbal, 0.152);
  const yawMotor = mesh(
    share(geos, new THREE.CylinderGeometry(0.018, 0.018, 0.016, 20)),
    mats.alu,
    0,
    0.018,
    -0.022,
  );
  const yawCan = mesh(
    share(geos, new THREE.CylinderGeometry(0.0182, 0.0182, 0.01, 20, 1, true)),
    photoGimbal,
    0,
    0.018,
    -0.022,
  );
  yawCan.castShadow = false;
  const yawArm = mesh(
    share(geos, boxBeam(0.01, 0.008, 0.046, 0.001)),
    mats.alu,
    0,
    0.018,
    0.004,
  );
  const yawRing = mesh(
    share(geos, new THREE.TorusGeometry(SPEC.gimbal.yawR, 0.0032, 8, 28)),
    mats.alu,
  );
  yawRing.rotation.x = Math.PI / 2;
  gimbalYaw.add(yawMotor, yawCan, yawArm, yawRing);

  const gimbalPitch = new THREE.Group();
  gimbalPitch.position.set(0, 0, 0.018);
  const pitchMotor = mesh(
    share(geos, new THREE.CylinderGeometry(0.014, 0.014, 0.014, 18)),
    mats.alu,
    0.032,
    0.0,
    0,
  );
  pitchMotor.rotation.z = Math.PI / 2;
  const pitchBracket = mesh(
    share(geos, boxBeam(SPEC.gimbal.span, 0.007, 0.01, 0.001)),
    mats.alu,
    0,
    0.024,
    0,
  );
  const sideGeo = share(geos, boxBeam(0.006, 0.04, 0.008, 0.001));
  const sideL = mesh(sideGeo, mats.alu, -0.03, 0.004, 0);
  const sideR = mesh(sideGeo, mats.alu, 0.03, 0.004, 0);
  const ballGeo = share(geos, new THREE.SphereGeometry(0.004, 10, 8));
  gimbalPitch.add(pitchMotor, pitchBracket, sideL, sideR);
  for (const [x, y] of [
    [-0.018, 0.016],
    [0.018, 0.016],
    [-0.018, -0.01],
    [0.018, -0.01],
  ] as const) {
    gimbalPitch.add(mesh(ballGeo, mats.rubber, x, y, -0.006));
  }

  const camBody = new THREE.Group();
  camBody.position.set(0, 0, 0.012);
  const adapterShape = chamferRect(SPEC.print.gimbalAdapter.xy, SPEC.print.gimbalAdapter.xy, 0.004);
  addCircleHole(adapterShape, 0, 0, SPEC.print.gimbalAdapter.bore / 2);
  const adapter = mesh(
    share(geos, extrudePlate(adapterShape, SPEC.print.gimbalAdapter.t)),
    mats.petg,
    0,
    0.016,
    0,
  );
  const boardCam = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.camera.board, SPEC.camera.boardT, SPEC.camera.board)),
    mats.pcbDark,
    0,
    0,
    0,
  );
  const camFace = mesh(
    share(geos, new THREE.PlaneGeometry(SPEC.camera.board * 0.96, SPEC.camera.board * 0.96)),
    photoCam,
    0,
    SPEC.camera.boardT / 2 + 0.0004,
    0,
  );
  camFace.rotation.x = -Math.PI / 2;
  camFace.castShadow = false;
  const barrel = mesh(
    share(geos, new THREE.CylinderGeometry(SPEC.camera.barrelR, SPEC.camera.barrelR + 0.001, SPEC.camera.barrelL, 20)),
    mats.steel,
    0,
    0,
    SPEC.camera.board / 2 + SPEC.camera.barrelL / 2 - 0.004,
  );
  barrel.rotation.x = Math.PI / 2;
  const glass = mesh(
    share(geos, new THREE.CylinderGeometry(SPEC.camera.lensR, SPEC.camera.lensR, 0.004, 20)),
    mats.lens,
    0,
    0,
    SPEC.camera.board / 2 + SPEC.camera.barrelL - 0.002,
  );
  glass.rotation.x = Math.PI / 2;
  const hood = mesh(
    share(geos, new THREE.CylinderGeometry(0.011, 0.009, 0.006, 16)),
    mats.rubber,
    0,
    0,
    SPEC.camera.board / 2 + SPEC.camera.barrelL + 0.004,
  );
  hood.rotation.x = Math.PI / 2;
  const csiClamp = mesh(
    share(geos, new THREE.BoxGeometry(SPEC.print.csi.x, SPEC.print.csi.y, SPEC.print.csi.z)),
    mats.tpu,
    0,
    -0.016,
    -0.012,
  );
  const ribbon = mesh(
    share(geos, new THREE.BoxGeometry(0.012, 0.0012, 0.09)),
    mats.chip,
    0,
    0.03,
    -0.05,
  );
  ribbon.rotation.x = -0.35;
  camBody.add(adapter, boardCam, camFace, barrel, glass, hood, csiClamp);

  const droneCam = new THREE.PerspectiveCamera(70, 16 / 9, 0.04, 90);
  droneCam.position.set(0, 0, 0.034);
  droneCam.rotation.y = Math.PI;
  camBody.add(droneCam);

  gimbalPitch.add(camBody);
  gimbalYaw.add(gimbalPitch);
  register("gimbal", gimbalYaw, new THREE.Vector3(0, -0.04, 0.18));

  tag(camBody, "camera");
  pieces.push({
    id: "camera",
    object: camBody,
    rest: camBody.position.clone(),
    explode: new THREE.Vector3(0, 0, 0.1),
  });
  register("camera", ribbon, new THREE.Vector3(0, 0.08, 0.12));

  const finishGroup = new THREE.Group();
  finishGroup.name = "finish-body";
  finishGroup.visible = false;
  group.add(finishGroup);

  const hideIds = new Set(["fc", "imu", "npu", "mag", "escs", "gps", "rx"]);
  const skeletonOnly = pieces.filter((p) => hideIds.has(p.id)).map((p) => p.object);

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
    finishGroup,
    skeletonOnly,
    materials,
    textures,
    geometries: geos,
  };
}
