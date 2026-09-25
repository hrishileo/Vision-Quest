import * as THREE from "three";

/**
 * CAM0 visibility shared with Pursuit vehicle lock (`GuideEngine.updatePursuit`).
 * A point is in view when its NDC projection sits inside the 0.92 margin and the
 * clip-space depth is in (0, 1). A building occludes it when the first building
 * hit is closer than the aim point by `OCCLUDE_PAD` meters. Calls that used to
 * inline this math should go through `isVisibleInCamera` so the corpus and the
 * lock cannot drift.
 */
export const VIEW_NDC = 0.92;
export const OCCLUDE_PAD = 1.2;
export const MIN_RANGE = 0.4;

export function ndcInView(ndc: { x: number; y: number; z: number }): boolean {
  return Math.abs(ndc.x) < VIEW_NDC && Math.abs(ndc.y) < VIEW_NDC && ndc.z > 0 && ndc.z < 1;
}

export function buildingOccludes(hits: readonly { distance: number }[], distHit: number): boolean {
  return hits.length > 0 && hits[0]!.distance < distHit - OCCLUDE_PAD;
}

export function isVisibleInCamera(
  camera: THREE.Camera,
  camPos: THREE.Vector3,
  sample: THREE.Vector3,
  aim: THREE.Vector3,
  buildings: THREE.Object3D[],
  scratch: { ndc: THREE.Vector3; to: THREE.Vector3; ray: THREE.Raycaster },
): boolean {
  const { ndc, to, ray } = scratch;
  ndc.copy(sample).project(camera);
  if (!ndcInView(ndc)) return false;
  to.copy(aim).sub(camPos);
  const distHit = to.length();
  if (distHit < MIN_RANGE) return false;
  to.multiplyScalar(1 / distHit);
  ray.set(camPos, to);
  const hits = ray.intersectObjects(buildings, false);
  return !buildingOccludes(hits, distHit);
}
