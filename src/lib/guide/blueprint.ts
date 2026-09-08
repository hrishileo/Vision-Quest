import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { ASSEMBLY_BALLOONS } from "@/lib/bom";
import { ARM, SPEC, Y, armXZ } from "./specs";
import type { DroneBuild } from "./build-drone";

const INK = 0xb7e0c4;
const PAPER = 0xc4a574;

const BALLOON_POS: Record<string, [number, number, number]> = {
  frame: [0.04, 0.56, -0.78],
  motors: [0.78, 0.3, 0.68],
  props: [-0.84, 0.34, 0.68],
  escs: [0.7, -0.22, 0.14],
  fc: [-0.74, 0.16, 0.14],
  imu: [-0.64, 0.5, 0.36],
  npu: [0.74, 0.42, -0.32],
  camera: [0.12, 0.1, 0.88],
  gimbal: [0.48, -0.16, 0.72],
  gps: [0.36, 0.76, -0.48],
  mag: [-0.46, 0.7, -0.52],
  battery: [0.04, -0.48, 0.42],
  rx: [-0.76, 0.04, -0.56],
};

export type Balloon = {
  id: string;
  el: HTMLDivElement;
  skuEl: HTMLDivElement;
  obj: CSS2DObject;
};

export type Blueprint = {
  dims: THREE.Group;
  edgeLines: THREE.LineSegments[];
  balloons: Balloon[];
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  els: HTMLElement[];
};

export function buildBlueprint(drone: DroneBuild): Blueprint {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const els: HTMLElement[] = [];
  const edgeLines: THREE.LineSegments[] = [];
  const balloons: Balloon[] = [];

  const edgeMat = new THREE.LineBasicMaterial({
    color: INK,
    transparent: true,
    opacity: 0.95,
  });
  mats.push(edgeMat);

  drone.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.userData.helper) return;
    const eg = new THREE.EdgesGeometry(mesh.geometry, 18);
    geos.push(eg);
    const lines = new THREE.LineSegments(eg, edgeMat);
    lines.userData.helper = true;
    lines.userData.blueprintEdge = true;
    lines.visible = false;
    lines.raycast = () => {};
    mesh.add(lines);
    edgeLines.push(lines);
  });

  const dims = new THREE.Group();
  dims.name = "blueprint-dims";
  dims.visible = false;

  const dimMat = new THREE.LineBasicMaterial({
    color: PAPER,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  mats.push(dimMat);
  const dashMat = new THREE.LineDashedMaterial({
    color: INK,
    dashSize: 0.018,
    gapSize: 0.01,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
  });
  mats.push(dashMat);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: PAPER,
    depthTest: false,
  });
  mats.push(arrowMat);

  const [x0, z0] = armXZ(Math.PI / 4);
  const [x2, z2] = armXZ((5 * Math.PI) / 4);
  const m0 = new THREE.Vector3(x0, Y.arm + 0.02, z0);
  const m2 = new THREE.Vector3(x2, Y.arm + 0.02, z2);
  addDim(geos, dimMat, arrowMat, els, dims, m0, m2, new THREE.Vector3(0, 0.26, 0), "650 mm  WHEELBASE");

  const propR = SPEC.prop.radius;
  addDim(
    geos,
    dimMat,
    arrowMat,
    els,
    dims,
    m0.clone().add(new THREE.Vector3(propR, 0, 0)),
    m0.clone().add(new THREE.Vector3(-propR, 0, 0)),
    new THREE.Vector3(0.05, 0.1, 0.1),
    "10 × 5.5 in  ·  Ø254 mm",
  );

  const stackBot = Y.batt - SPEC.battery.y / 2;
  const stackTop = Y.helix + SPEC.gps.helixH * 0.42;
  addDim(
    geos,
    dimMat,
    arrowMat,
    els,
    dims,
    new THREE.Vector3(0, stackBot, 0),
    new THREE.Vector3(0, stackTop, 0),
    new THREE.Vector3(0.34, 0, 0),
    `${Math.round((stackTop - stackBot) * 1000)} mm  OVERALL`,
  );

  addDim(
    geos,
    dimMat,
    arrowMat,
    els,
    dims,
    new THREE.Vector3(-SPEC.frame.plate / 2, Y.topPlate, -SPEC.frame.plate / 2),
    new THREE.Vector3(SPEC.frame.plate / 2, Y.topPlate, -SPEC.frame.plate / 2),
    new THREE.Vector3(0, 0.08, -0.08),
    "160 mm  PLATE",
  );

  const xGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-ARM * 0.85, 0.002, -ARM * 0.85),
    new THREE.Vector3(ARM * 0.85, 0.002, ARM * 0.85),
    new THREE.Vector3(-ARM * 0.85, 0.002, ARM * 0.85),
    new THREE.Vector3(ARM * 0.85, 0.002, -ARM * 0.85),
  ]);
  geos.push(xGeo);
  const xLine = new THREE.LineSegments(xGeo, dashMat);
  xLine.computeLineDistances();
  xLine.userData.helper = true;
  xLine.raycast = () => {};
  dims.add(xLine);

  drone.group.updateWorldMatrix(true, true);

  for (const b of ASSEMBLY_BALLOONS) {
    const pos = BALLOON_POS[b.id];
    if (!pos) continue;
    const balloonAt = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const target = localOf(drone, b.id);

    const leadGeo = new THREE.BufferGeometry().setFromPoints([target, balloonAt]);
    geos.push(leadGeo);
    const lead = new THREE.Line(leadGeo, dashMat);
    lead.computeLineDistances();
    lead.userData.helper = true;
    lead.raycast = () => {};
    dims.add(lead);

    const wrap = document.createElement("div");
    wrap.className = "anno-call";
    const num = document.createElement("div");
    num.className = "anno-balloon";
    num.textContent = String(b.n);
    const sku = document.createElement("div");
    sku.className = "anno-sku";
    sku.textContent = b.call;
    sku.hidden = true;
    wrap.append(num, sku);
    els.push(wrap);

    const obj = new CSS2DObject(wrap);
    obj.position.copy(balloonAt);
    obj.userData.helper = true;
    obj.visible = false;
    dims.add(obj);
    balloons.push({ id: b.id, el: num, skuEl: sku, obj });
  }

  drone.group.add(dims);

  return { dims, edgeLines, balloons, geos, mats, els };
}

export function setBlueprintVisible(bp: Blueprint, on: boolean) {
  bp.dims.visible = on;
  for (const line of bp.edgeLines) line.visible = on;
  if (!on) setBlueprintFocus(bp, null);
}

export function setBlueprintFocus(bp: Blueprint, id: string | null) {
  for (const b of bp.balloons) {
    const on = !!id && b.id === id;
    b.obj.visible = on;
    b.el.classList.toggle("is-active", on);
    b.skuEl.hidden = !on;
  }
}

function localOf(drone: DroneBuild, id: string) {
  if (id === "frame") return new THREE.Vector3(0, Y.topPlate, 0);
  const piece = drone.pieces.find((p) => p.id === id);
  if (!piece) return new THREE.Vector3();
  const w = new THREE.Vector3();
  piece.object.getWorldPosition(w);
  return drone.group.worldToLocal(w);
}

function addDim(
  geos: THREE.BufferGeometry[],
  lineMat: THREE.LineBasicMaterial,
  arrowMat: THREE.MeshBasicMaterial,
  els: HTMLElement[],
  parent: THREE.Group,
  a: THREE.Vector3,
  b: THREE.Vector3,
  offset: THREE.Vector3,
  label: string,
) {
  const p1 = a.clone().add(offset);
  const p2 = b.clone().add(offset);
  const geo = new THREE.BufferGeometry().setFromPoints([a.clone(), p1, p2, b.clone()]);
  geos.push(geo);
  const line = new THREE.Line(geo, lineMat);
  line.userData.helper = true;
  line.raycast = () => {};
  parent.add(line);

  addArrow(geos, arrowMat, parent, p1, p2);
  addArrow(geos, arrowMat, parent, p2, p1);

  const el = document.createElement("div");
  el.className = "anno anno-dim";
  el.textContent = label;
  els.push(el);
  const tag = new CSS2DObject(el);
  tag.position.copy(p1).lerp(p2, 0.5);
  tag.userData.helper = true;
  parent.add(tag);
}

function addArrow(
  geos: THREE.BufferGeometry[],
  mat: THREE.MeshBasicMaterial,
  parent: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
) {
  const dir = to.clone().sub(from);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  const cone = new THREE.ConeGeometry(0.007, 0.02, 8);
  geos.push(cone);
  const mesh = new THREE.Mesh(cone, mat);
  mesh.position.copy(to);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  mesh.userData.helper = true;
  mesh.raycast = () => {};
  parent.add(mesh);
}
