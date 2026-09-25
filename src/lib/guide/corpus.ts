import * as THREE from "three";
import { DEBRIS_TYPE_LABEL, type DebrisDef, type DebrisKind } from "./debris.ts";
import { VIEW_NDC } from "./visibility.ts";

/** Fixed CAM0 capture size. 16:9 matches the camera's authored aspect. */
export const CORPUS_WIDTH = 960;
export const CORPUS_HEIGHT = 540;
export const CORPUS_HZ_DEFAULT = 10;
export const CORPUS_HZ_MAX = 30;
export const CORPUS_SCHEMA = 1;

export const YOLO_CLASS_ID = { vehicle: 0, unknown: 1 } as const;

const DEBRIS_TYPES = new Set(Object.keys(DEBRIS_TYPE_LABEL));

export type Vec3 = { x: number; y: number; z: number };
export type PixelBox = { x: number; y: number; w: number; h: number };
export type LabelClass = "vehicle" | "unknown";

export type Intrinsics = {
  fovY: number;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
};

export type CorpusCamera = {
  position: Vec3;
  /** Camera world Y. Mag Mile ground plane is y = 0. */
  agl: number;
  yaw: number;
  pitch: number;
  roll: number;
  intrinsics: Intrinsics;
};

/** Ground-truth object. `class` is the training label; `type` and `kind` keep the sim's real identity. */
export type CorpusObject = {
  trackId: string;
  class: LabelClass;
  type: string;
  kind: DebrisKind | null;
  laneId: string | null;
  position: Vec3;
  /** Lane speed in m/s for vehicles. Null for debris and blockades. */
  speed: number | null;
  bbox: PixelBox;
};

export type CorpusFrame = {
  schema: number;
  groundTruth: true;
  index: number;
  /** Simulation time, seconds. */
  t: number;
  rateHz: number;
  file: string;
  labelFile: string;
  camera: CorpusCamera;
  objects: CorpusObject[];
};

export function clampCorpusHz(hz: number): number {
  if (!Number.isFinite(hz)) return CORPUS_HZ_DEFAULT;
  return Math.min(CORPUS_HZ_MAX, Math.max(1, hz));
}

export function frameStem(index: number): string {
  return String(index).padStart(6, "0");
}

/** Vertical-fov pinhole. Three.js PerspectiveCamera uses square pixels, so fx = fy. */
export function intrinsics(fovYDeg: number, width: number, height: number): Intrinsics {
  const tanHalf = Math.tan((fovYDeg * Math.PI) / 180 / 2);
  const aspect = width / Math.max(height, 1);
  const fy = height / 2 / tanHalf;
  const fx = width / 2 / (aspect * tanHalf);
  return { fovY: fovYDeg, width, height, fx, fy, cx: width / 2, cy: height / 2 };
}

const _proj = new THREE.Vector3();

export function projectToPixel(
  camera: THREE.Camera,
  point: Vec3,
  width: number,
  height: number,
): { x: number; y: number; z: number } | null {
  _proj.set(point.x, point.y, point.z).project(camera);
  if (_proj.z <= 0 || _proj.z >= 1) return null;
  return {
    x: ((_proj.x + 1) / 2) * width,
    y: ((1 - _proj.y) / 2) * height,
    z: _proj.z,
  };
}

/** Axis-aligned pixel box of world corners. Clipped to the image. Null when nothing falls in front of the camera. */
export function projectBox(
  camera: THREE.Camera,
  corners: readonly Vec3[],
  width: number,
  height: number,
): PixelBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const corner of corners) {
    const px = projectToPixel(camera, corner, width, height);
    if (!px) continue;
    minX = Math.min(minX, px.x);
    minY = Math.min(minY, px.y);
    maxX = Math.max(maxX, px.x);
    maxY = Math.max(maxY, px.y);
    n += 1;
  }
  if (n === 0) return null;
  const x0 = Math.max(0, minX);
  const y0 = Math.max(0, minY);
  const x1 = Math.min(width, maxX);
  const y1 = Math.min(height, maxY);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function writeBoxCorners(box: THREE.Box3, out: THREE.Vector3[]): void {
  const { min, max } = box;
  out[0]!.set(min.x, min.y, min.z);
  out[1]!.set(max.x, min.y, min.z);
  out[2]!.set(min.x, max.y, min.z);
  out[3]!.set(max.x, max.y, min.z);
  out[4]!.set(min.x, min.y, max.z);
  out[5]!.set(max.x, min.y, max.z);
  out[6]!.set(min.x, max.y, max.z);
  out[7]!.set(max.x, max.y, max.z);
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");

export function cameraRecord(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): CorpusCamera {
  camera.updateMatrixWorld();
  camera.getWorldPosition(_pos);
  camera.getWorldQuaternion(_quat);
  _euler.setFromQuaternion(_quat, "YXZ");
  return {
    position: { x: _pos.x, y: _pos.y, z: _pos.z },
    agl: _pos.y,
    yaw: _euler.y,
    pitch: _euler.x,
    roll: _euler.z,
    intrinsics: intrinsics(camera.fov, width, height),
  };
}

export function laneForVehicle(laneId: string, parked: boolean): string | null {
  if (parked || laneId === "park") return null;
  return laneId;
}

type VehiclePose = {
  id: number;
  laneId: string;
  parked: boolean;
  x: number;
  z: number;
  v: number;
};

export function vehicleRecord(
  car: VehiclePose,
  corners: readonly Vec3[],
  camera: THREE.Camera,
  width: number,
  height: number,
): CorpusObject | null {
  const bbox = projectBox(camera, corners, width, height);
  if (!bbox) return null;
  return {
    trackId: `veh-${car.id}`,
    class: "vehicle",
    type: "vehicle",
    kind: null,
    laneId: laneForVehicle(car.laneId, car.parked),
    position: { x: car.x, y: 0, z: car.z },
    speed: car.v,
    bbox,
  };
}

export function debrisRecord(
  def: Pick<DebrisDef, "id" | "type" | "kind" | "x" | "z">,
  corners: readonly Vec3[],
  camera: THREE.Camera,
  width: number,
  height: number,
): CorpusObject | null {
  const bbox = projectBox(camera, corners, width, height);
  if (!bbox) return null;
  return {
    trackId: `deb-${def.id}`,
    class: "unknown",
    type: def.type,
    kind: def.kind,
    laneId: null,
    position: { x: def.x, y: 0, z: def.z },
    speed: null,
    bbox,
  };
}

export function makeFrame(input: {
  index: number;
  t: number;
  hz: number;
  camera: CorpusCamera;
  objects: CorpusObject[];
}): CorpusFrame {
  const stem = frameStem(input.index);
  return {
    schema: CORPUS_SCHEMA,
    groundTruth: true,
    index: input.index,
    t: input.t,
    rateHz: input.hz,
    file: `images/${stem}.png`,
    labelFile: `labels/${stem}.txt`,
    camera: input.camera,
    objects: input.objects,
  };
}

export function validateFrame(frame: CorpusFrame): string[] {
  const errors: string[] = [];
  if (frame.schema !== CORPUS_SCHEMA) errors.push("schema");
  if (frame.groundTruth !== true) errors.push("groundTruth");
  if (!Number.isFinite(frame.t) || frame.t < 0) errors.push("t");
  if (frame.rateHz < 1 || frame.rateHz > CORPUS_HZ_MAX) errors.push("rateHz");
  const stem = frameStem(frame.index);
  if (frame.file !== `images/${stem}.png`) errors.push("file");
  if (frame.labelFile !== `labels/${stem}.txt`) errors.push("labelFile");
  const cam = frame.camera;
  if (!cam || !Number.isFinite(cam.agl)) errors.push("camera");
  else {
    const { intrinsics: k } = cam;
    if (!(k.width > 0 && k.height > 0)) errors.push("resolution");
    if (!(k.fx > 0 && k.fy > 0)) errors.push("focal");
    if (k.cx !== k.width / 2 || k.cy !== k.height / 2) errors.push("principal");
    for (const key of ["x", "y", "z"] as const) {
      if (!Number.isFinite(cam.position[key])) errors.push("position");
    }
    if (cam.agl !== cam.position.y) errors.push("agl");
    for (const axis of ["yaw", "pitch", "roll"] as const) {
      if (!Number.isFinite(cam[axis])) errors.push(axis);
    }
  }
  const seen = new Set<string>();
  for (const obj of frame.objects) {
    if (seen.has(obj.trackId)) errors.push(`duplicate ${obj.trackId}`);
    seen.add(obj.trackId);
    if (obj.class === "vehicle") {
      if (!obj.trackId.startsWith("veh-")) errors.push("vehicle track");
      if (obj.type !== "vehicle") errors.push("vehicle type");
      if (obj.kind !== null) errors.push("vehicle kind");
      if (obj.speed === null || !Number.isFinite(obj.speed) || obj.speed < 0) errors.push("speed");
      if (obj.laneId !== null && obj.laneId.length === 0) errors.push("lane");
    } else if (obj.class === "unknown") {
      if (!obj.trackId.startsWith("deb-")) errors.push("debris track");
      if (!DEBRIS_TYPES.has(obj.type)) errors.push(`type ${obj.type}`);
      if (obj.kind !== "debris" && obj.kind !== "blockade") errors.push("kind");
      if (obj.laneId !== null) errors.push("debris lane");
      if (obj.speed !== null) errors.push("debris speed");
    } else {
      errors.push("class");
    }
    const box = obj.bbox;
    const w = cam?.intrinsics.width ?? 0;
    const h = cam?.intrinsics.height ?? 0;
    if (!(box.w >= 1 && box.h >= 1)) errors.push("bbox size");
    if (box.x < -1e-6 || box.y < -1e-6 || box.x + box.w > w + 1e-3 || box.y + box.h > h + 1e-3) {
      errors.push("bbox bounds");
    }
    const line = toYoloLine(obj, w, h);
    const parts = line.split(" ").map(Number);
    if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) errors.push("yolo");
    const [cls, cx, cy, bw, bh] = parts;
    if (cls !== YOLO_CLASS_ID[obj.class]) errors.push("yolo class");
    if (cx! < 0 || cy! < 0 || bw! <= 0 || bh! <= 0 || cx! > 1 || cy! > 1 || bw! > 1 || bh! > 1) {
      errors.push("yolo range");
    }
  }
  return errors;
}

export function toYoloLine(obj: CorpusObject, width: number, height: number): string {
  const cx = (obj.bbox.x + obj.bbox.w / 2) / width;
  const cy = (obj.bbox.y + obj.bbox.h / 2) / height;
  const w = obj.bbox.w / width;
  const h = obj.bbox.h / height;
  const id = YOLO_CLASS_ID[obj.class];
  return `${id} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`;
}

export function frameToYolo(frame: CorpusFrame): string {
  const { width, height } = frame.camera.intrinsics;
  if (frame.objects.length === 0) return "";
  return frame.objects.map((obj) => toYoloLine(obj, width, height)).join("\n") + "\n";
}

export function frameToJsonl(frame: CorpusFrame): string {
  return JSON.stringify(frame);
}

export function framesToJsonl(frames: readonly CorpusFrame[]): string {
  if (frames.length === 0) return "";
  return frames.map(frameToJsonl).join("\n") + "\n";
}

export function parseJsonl(text: string): CorpusFrame[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CorpusFrame);
}

export function achievedRate(frames: readonly { t: number }[]): number {
  if (frames.length < 2) return 0;
  const span = frames[frames.length - 1]!.t - frames[0]!.t;
  if (span <= 0) return 0;
  return (frames.length - 1) / span;
}

export class FrameClock {
  hz = CORPUS_HZ_DEFAULT;
  private armed = false;
  private next = 0;

  reset(hz: number) {
    this.hz = clampCorpusHz(hz);
    this.armed = false;
    this.next = 0;
  }

  /** At most one sample per call. The first call samples immediately. */
  due(simTime: number): boolean {
    if (!this.armed) {
      this.armed = true;
      this.next = simTime;
    }
    if (simTime + 1e-9 < this.next) return false;
    this.next = simTime + 1 / this.hz;
    return true;
  }
}

export function corpusReadme(meta: {
  runId: string;
  frames: number;
  hz: number;
  achievedHz: number;
  t0: number;
  t1: number;
  width: number;
  height: number;
}): string {
  const span = Math.max(0, meta.t1 - meta.t0);
  return `# CAM0 ground-truth corpus

Run \`${meta.runId}\`. ${meta.frames} frames, configured ${meta.hz} Hz, achieved ${meta.achievedHz.toFixed(2)} Hz over ${span.toFixed(3)} s of simulation time.

These labels are **ground truth** from the Vision Quest Mag Mile pursuit sim (CAM0). They are not detections. Nothing in this folder was produced by a neural network.

## Layout

- \`images/000000.png\` — CAM0 render, ${meta.width}×${meta.height}, PNG
- \`labels.jsonl\` — one JSON object per frame
- \`labels/000000.txt\` — YOLO txt, same stem as the image
- \`data.yaml\` — class ids for a YOLO trainer

## Frame fields

| Field | Meaning |
| --- | --- |
| \`schema\` | ${CORPUS_SCHEMA} |
| \`groundTruth\` | always \`true\` |
| \`t\` | simulation time, seconds (\`TrafficSim.time\`) |
| \`rateHz\` | configured sample rate |
| \`camera.position\` | camera world position, meters |
| \`camera.agl\` | height above the ground plane. The ground plane is \`y = 0\`, so AGL is camera world Y |
| \`camera.yaw\` \`pitch\` \`roll\` | camera world Euler, radians, order YXZ (pitch, yaw, roll) |
| \`camera.intrinsics\` | vertical fov in degrees, resolution, focal length and principal point in pixels |
| \`objects[]\` | vehicles and debris/blockades inside the CAM0 frustum and not occluded by a building |

## Object fields

| Field | Meaning |
| --- | --- |
| \`trackId\` | \`veh-<id>\` or \`deb-<id>\`. Stable for the life of the sim. Same ids as the scene scan contacts |
| \`class\` | training class: \`vehicle\` or \`unknown\` |
| \`type\` | real sim type. \`vehicle\` for cars. Debris/blockades keep \`tire\` \`crate\` \`barrier\` \`cone\` \`branch\` \`rubble\` \`pallet\` \`bag\` |
| \`kind\` | \`null\` for vehicles. \`debris\` or \`blockade\` otherwise |
| \`laneId\` | travel-lane id, or \`null\` when the object is parked, on the curb, or off-lane. Debris is always \`null\` |
| \`position\` | rig origin on the ground plane, meters (\`y = 0\`). The same point the traffic sim and the debris table store |
| \`speed\` | vehicle lane speed in m/s (\`SimCar.v\`). \`null\` for debris and blockades |
| \`bbox\` | pixel box, origin at the top-left of the image, \`{x, y, w, h}\` |

## Class policy

Vehicles use class \`vehicle\` (YOLO id 0). Every debris or blockade object uses class \`unknown\` (YOLO id 1) in \`class\`, and stores its real \`type\` and \`kind\` beside that so a later split does not need a re-render.

## Visibility

An object is labeled only when its sample point passes the Pursuit CAM0 check: projected NDC inside ±${VIEW_NDC}, depth in (0, 1), and the ray from the camera to the sample is not blocked by a building. Vehicles use the lock's sample \`(x, 0.6, z)\` and aim \`(x, 1, z)\`. Debris uses the mesh center. The box itself is the projected mesh bounds, clipped to the image.

The 10-second scene scan is a range catalog from the airframe. It is not the camera frustum. This corpus uses the scan's object identities and the camera's visibility test.
`;
}

export const DATA_YAML = `# Ground truth from the Mag Mile sim. Not detector output.
path: .
train: images
val: images
names:
  0: vehicle
  1: unknown
`;

export type ZipEntry = { name: string; data: Uint8Array };

export function corpusArchiveEntries(
  runId: string,
  frames: readonly CorpusFrame[],
  pngs: readonly Uint8Array[],
): ZipEntry[] {
  const root = `${runId}/`;
  const enc = new TextEncoder();
  const t0 = frames[0]?.t ?? 0;
  const t1 = frames[frames.length - 1]?.t ?? t0;
  const hz = frames[0]?.rateHz ?? CORPUS_HZ_DEFAULT;
  const entries: ZipEntry[] = [
    {
      name: `${root}README.md`,
      data: enc.encode(
        corpusReadme({
          runId,
          frames: frames.length,
          hz,
          achievedHz: achievedRate(frames),
          t0,
          t1,
          width: CORPUS_WIDTH,
          height: CORPUS_HEIGHT,
        }),
      ),
    },
    { name: `${root}labels.jsonl`, data: enc.encode(framesToJsonl(frames)) },
    { name: `${root}data.yaml`, data: enc.encode(DATA_YAML) },
  ];
  frames.forEach((frame, i) => {
    const stem = frameStem(frame.index);
    const png = pngs[i];
    if (!png) throw new Error(`missing png for frame ${frame.index}`);
    entries.push({ name: `${root}images/${stem}.png`, data: png });
    entries.push({ name: `${root}labels/${stem}.txt`, data: enc.encode(frameToYolo(frame)) });
  });
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Stored (uncompressed) zip so a run can be downloaded without a compression dependency. */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const names = entries.map((entry) => enc.encode(entry.name));
  let localSize = 0;
  let centralSize = 0;
  for (let i = 0; i < entries.length; i++) {
    localSize += 30 + names[i]!.length + entries[i]!.data.length;
    centralSize += 46 + names[i]!.length;
  }
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const locals: number[] = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const name = names[i]!;
    const data = entries[i]!.data;
    const crc = crc32(data);
    locals.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, data.length, true);
    view.setUint32(offset + 22, data.length, true);
    view.setUint16(offset + 26, name.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(name, offset + 30);
    out.set(data, offset + 30 + name.length);
    offset += 30 + name.length + data.length;
  }
  const centralStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const name = names[i]!;
    const data = entries[i]!.data;
    const crc = crc32(data);
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0, true);
    view.setUint32(offset + 16, crc, true);
    view.setUint32(offset + 20, data.length, true);
    view.setUint32(offset + 24, data.length, true);
    view.setUint16(offset + 28, name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, locals[i]!, true);
    out.set(name, offset + 46);
    offset += 46 + name.length;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - centralStart, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);
  return out;
}

export function unzipStore(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  if (eocd < 0 || view.getUint32(eocd, true) !== 0x06054b50) throw new Error("bad zip");
  const count = view.getUint16(eocd + 8, true);
  let offset = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("bad central directory");
    if (view.getUint16(offset + 10, true) !== 0) throw new Error("unexpected compression");
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = dec.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    const localNameLen = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localNameLen + localExtra;
    out.push({ name, data: bytes.slice(dataStart, dataStart + size) });
    offset += 46 + nameLen + extra + comment;
  }
  return out;
}

export function flipRgbaBottomUp(src: Uint8Array, width: number, height: number): Uint8Array {
  const dst = new Uint8Array(src.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const srcOff = (height - 1 - y) * row;
    dst.set(src.subarray(srcOff, srcOff + row), y * row);
  }
  return dst;
}

export function rgbaToPng(rgbaTopLeft: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("2d context unavailable"));
  const clamped = new Uint8ClampedArray(rgbaTopLeft);
  ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("png encode failed"));
        return;
      }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, "image/png");
  });
}

function makeRunId(): string {
  return `cam0-corpus-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export class CorpusSession {
  open = false;
  runId = "";
  hz = CORPUS_HZ_DEFAULT;
  frames: CorpusFrame[] = [];
  private pngs: Promise<Uint8Array>[] = [];
  private clock = new FrameClock();

  start(hz: number) {
    this.hz = clampCorpusHz(hz);
    this.clock.reset(this.hz);
    this.frames = [];
    this.pngs = [];
    this.open = true;
    this.runId = makeRunId();
  }

  stop() {
    this.open = false;
  }

  due(simTime: number): boolean {
    this.clock.hz = this.hz;
    return this.clock.due(simTime);
  }

  push(frame: CorpusFrame, png: Promise<Uint8Array>) {
    this.frames.push(frame);
    this.pngs.push(png);
  }

  achievedHz(): number {
    return achievedRate(this.frames);
  }

  async zip(): Promise<Uint8Array> {
    const pngs = await Promise.all(this.pngs);
    return zipStore(corpusArchiveEntries(this.runId || "cam0-corpus", this.frames, pngs));
  }
}

export type CorpusStatus = {
  recording: boolean;
  frames: number;
  hz: number;
  achievedHz: number;
  t: number;
  runId: string;
};

export type CorpusApi = {
  start: (hz?: number) => void;
  stop: () => void;
  download: () => Promise<void>;
  zip: () => Promise<Uint8Array>;
  status: () => CorpusStatus;
};

declare global {
  interface Window {
    __corpus?: CorpusApi;
  }
}
