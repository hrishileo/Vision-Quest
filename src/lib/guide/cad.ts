import * as THREE from "three";

export function share(geos: THREE.BufferGeometry[], geo: THREE.BufferGeometry) {
  geos.push(geo);
  return geo;
}

export function chamferRect(w: number, d: number, c: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  const k = Math.min(c, hw * 0.45, hd * 0.45);
  s.moveTo(-hw + k, -hd);
  s.lineTo(hw - k, -hd);
  s.lineTo(hw, -hd + k);
  s.lineTo(hw, hd - k);
  s.lineTo(hw - k, hd);
  s.lineTo(-hw + k, hd);
  s.lineTo(-hw, hd - k);
  s.lineTo(-hw, -hd + k);
  s.closePath();
  return s;
}

/** Creo-style osprey fuselage. +Y in the shape is +Z in world after plate extrude. */
export function ospreyOutline(len: number, wid: number): THREE.Shape {
  const s = new THREE.Shape();
  const L = len / 2;
  const W = wid / 2;
  s.moveTo(0, L);
  s.bezierCurveTo(W * 0.1, L, W * 0.26, L * 0.94, W * 0.38, L * 0.74);
  s.bezierCurveTo(W * 0.72, L * 0.46, W * 1.04, L * 0.2, W * 0.98, L * 0.02);
  s.bezierCurveTo(W * 0.94, -L * 0.12, W * 0.9, -L * 0.28, W * 0.84, -L * 0.42);
  s.bezierCurveTo(W * 0.7, -L * 0.72, W * 0.38, -L * 0.94, 0, -L);
  s.bezierCurveTo(-W * 0.38, -L * 0.94, -W * 0.7, -L * 0.72, -W * 0.84, -L * 0.42);
  s.bezierCurveTo(-W * 0.9, -L * 0.28, -W * 0.94, -L * 0.12, -W * 0.98, L * 0.02);
  s.bezierCurveTo(-W * 1.04, L * 0.2, -W * 0.72, L * 0.46, -W * 0.38, L * 0.74);
  s.bezierCurveTo(-W * 0.26, L * 0.94, -W * 0.1, L, 0, L);
  s.closePath();
  return s;
}

export function addCircleHole(shape: THREE.Shape, x: number, y: number, r: number) {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, false);
  shape.holes.push(p);
}

export function addSlotHole(
  shape: THREE.Shape,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const p = new THREE.Path();
  const hw = w / 2;
  const hh = h / 2;
  p.absellipse(x, y, hw, hh, 0, Math.PI * 2, false, 0);
  shape.holes.push(p);
}

export function extrudePlate(shape: THREE.Shape, t: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: t,
    bevelEnabled: true,
    bevelThickness: Math.min(0.0004, t * 0.18),
    bevelSize: Math.min(0.0005, t * 0.2),
    bevelSegments: 1,
    curveSegments: 18,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, t / 2, 0);
  g.computeVertexNormals();
  return g;
}

export function boxBeam(w: number, h: number, len: number, chamfer = 0.0015): THREE.ExtrudeGeometry {
  const s = chamferRect(w, h, chamfer);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: len,
    bevelEnabled: false,
    curveSegments: 4,
  });
  g.translate(0, 0, -len / 2);
  g.computeVertexNormals();
  return g;
}

/** I-section carbon boom — flanges + web, Creo loft language. */
export function iBeam(
  w: number,
  h: number,
  len: number,
  flange = 0.0024,
  web = 0.0026,
): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  const fw = Math.min(flange, h * 0.35);
  const tw = Math.min(web, w * 0.4) / 2;
  s.moveTo(-hw, -hh);
  s.lineTo(hw, -hh);
  s.lineTo(hw, -hh + fw);
  s.lineTo(tw, -hh + fw);
  s.lineTo(tw, hh - fw);
  s.lineTo(hw, hh - fw);
  s.lineTo(hw, hh);
  s.lineTo(-hw, hh);
  s.lineTo(-hw, hh - fw);
  s.lineTo(-tw, hh - fw);
  s.lineTo(-tw, -hh + fw);
  s.lineTo(-hw, -hh + fw);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -len / 2);
  g.computeVertexNormals();
  return g;
}

export function knuckleShape(): THREE.Shape {
  const s = chamferRect(0.046, 0.04, 0.006);
  addCircleHole(s, 0, 0, 0.0055);
  addCircleHole(s, 0.014, 0.01, 0.0016);
  addCircleHole(s, -0.014, 0.01, 0.0016);
  addCircleHole(s, 0.014, -0.01, 0.0016);
  addCircleHole(s, -0.014, -0.01, 0.0016);
  return s;
}

export function motorPlateShape(size: number, pattern: number): THREE.Shape {
  const s = chamferRect(size, size, 0.007);
  addCircleHole(s, 0, 0, 0.0065);
  const h = pattern / 2;
  addCircleHole(s, h, h, 0.0016);
  addCircleHole(s, -h, h, 0.0016);
  addCircleHole(s, h, -h, 0.0016);
  addCircleHole(s, -h, -h, 0.0016);
  return s;
}

export function hexHead(r: number, h: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(r, r, h, 6);
}
