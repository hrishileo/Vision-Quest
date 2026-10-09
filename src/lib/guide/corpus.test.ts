import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  CORPUS_HEIGHT,
  CORPUS_WIDTH,
  DATA_YAML,
  FrameClock,
  YOLO_CLASS_ID,
  achievedRate,
  cameraRecord,
  clampCorpusHz,
  corpusArchiveEntries,
  corpusReadme,
  debrisRecord,
  frameToYolo,
  framesToJsonl,
  intrinsics,
  makeFrame,
  parseJsonl,
  projectBox,
  projectToPixel,
  unzipStore,
  validateFrame,
  vehicleRecord,
  writeBoxCorners,
  zipStore,
  type CorpusFrame,
} from "./corpus.ts";
import { buildingOccludes, isVisibleInCamera, ndcInView, MIN_RANGE, OCCLUDE_PAD, VIEW_NDC } from "./visibility.ts";

function cameraLookingAt(eye: THREE.Vector3, target: THREE.Vector3, fov = 70): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, CORPUS_WIDTH / CORPUS_HEIGHT, 0.04, 180);
  camera.position.copy(eye);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function cube(center: THREE.Vector3, half: number): THREE.Vector3[] {
  const box = new THREE.Box3(center.clone().addScalar(-half), center.clone().addScalar(half));
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  writeBoxCorners(box, corners);
  return corners;
}

describe("CAM0 intrinsics and box projection", () => {
  it("matches a 90 degree pinhole", () => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const k = intrinsics(90, 200, 200);
    assert.ok(Math.abs(k.fx - 100) < 1e-9);
    assert.ok(Math.abs(k.fy - 100) < 1e-9);
    assert.equal(k.cx, 100);
    assert.equal(k.cy, 100);
    const center = projectToPixel(camera, { x: 0, y: 0, z: -10 }, 200, 200);
    const right = projectToPixel(camera, { x: 1, y: 0, z: -10 }, 200, 200);
    assert.ok(center && right);
    assert.ok(Math.abs(center.x - 100) < 1e-6);
    assert.ok(Math.abs(center.y - 100) < 1e-6);
    assert.ok(Math.abs(right.x - 110) < 1e-4);
    assert.ok(Math.abs(right.y - 100) < 1e-4);
  });

  it("places an on-axis point on the principal point at the capture size", () => {
    const camera = cameraLookingAt(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, 0));
    const k = intrinsics(camera.fov, CORPUS_WIDTH, CORPUS_HEIGHT);
    assert.ok(Math.abs(k.fx - k.fy) < 1e-6);
    assert.equal(k.cx, CORPUS_WIDTH / 2);
    assert.equal(k.cy, CORPUS_HEIGHT / 2);
    const pixel = projectToPixel(camera, { x: 0, y: 0, z: 0 }, CORPUS_WIDTH, CORPUS_HEIGHT);
    assert.ok(pixel);
    assert.ok(Math.abs(pixel.x - k.cx) < 1e-4);
    assert.ok(Math.abs(pixel.y - k.cy) < 1e-4);
  });

  it("projects a box in front of the camera and drops one behind it", () => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const box = projectBox(camera, cube(new THREE.Vector3(0, 0, -10), 1), 200, 200);
    assert.ok(box);
    assert.ok(Math.abs(box.x + box.w / 2 - 100) < 0.5);
    assert.ok(Math.abs(box.w - (200 * (1 / 9)) ) < 0.5);
    assert.equal(projectBox(camera, cube(new THREE.Vector3(0, 0, 5), 0.5), 200, 200), null);
    assert.equal(projectToPixel(camera, { x: 0, y: 0, z: 4 }, 200, 200), null);
  });

  it("reads yaw pitch roll and AGL off the camera", () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.04, 180);
    camera.position.set(1, 6, 3);
    camera.rotation.order = "YXZ";
    camera.rotation.set(0.2, 0.4, 0.1);
    camera.updateMatrixWorld();
    const pose = cameraRecord(camera, CORPUS_WIDTH, CORPUS_HEIGHT);
    assert.ok(Math.abs(pose.pitch - 0.2) < 1e-6);
    assert.ok(Math.abs(pose.yaw - 0.4) < 1e-6);
    assert.ok(Math.abs(pose.roll - 0.1) < 1e-6);
    assert.equal(pose.agl, 6);
    assert.equal(pose.position.y, pose.agl);
    assert.equal(pose.intrinsics.width, CORPUS_WIDTH);
    assert.equal(pose.intrinsics.height, CORPUS_HEIGHT);
  });
});

describe("Pursuit visibility contract", () => {
  it("keeps the in-view margin and the building clearance", () => {
    assert.equal(VIEW_NDC, 0.92);
    assert.equal(OCCLUDE_PAD, 1.2);
    assert.equal(MIN_RANGE, 0.4);
    assert.equal(ndcInView({ x: 0.91, y: -0.91, z: 0.5 }), true);
    assert.equal(ndcInView({ x: 0.92, y: 0, z: 0.5 }), false);
    assert.equal(ndcInView({ x: 0, y: 0, z: 0 }), false);
    assert.equal(ndcInView({ x: 0, y: 0, z: 1 }), false);
    assert.equal(buildingOccludes([{ distance: 9.99 }], 11.2), true);
    assert.equal(buildingOccludes([{ distance: 10 }], 11.2), false);
    assert.equal(buildingOccludes([], 11.2), false);
  });

  it("rejects a building-blocked aim point and accepts a clear one", () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.04, 200);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 1, -12);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const building = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 1));
    building.position.set(0, 2, -5);
    building.updateMatrixWorld();
    const clear = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    clear.position.set(30, 2, -5);
    clear.updateMatrixWorld();
    const scratch = () => ({
      ndc: new THREE.Vector3(),
      to: new THREE.Vector3(),
      ray: new THREE.Raycaster(),
    });
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const sample = new THREE.Vector3(0, 0.6, -12);
    const aim = new THREE.Vector3(0, 1, -12);
    assert.equal(isVisibleInCamera(camera, camPos, sample, aim, [building], scratch()), false);
    assert.equal(isVisibleInCamera(camera, camPos, sample, aim, [clear], scratch()), true);
    const beside = new THREE.Vector3(40, 0.6, -12);
    assert.equal(isVisibleInCamera(camera, camPos, beside, beside, [clear], scratch()), false);
    const tooClose = new THREE.Vector3(0, 2, -0.05);
    assert.equal(isVisibleInCamera(camera, camPos, tooClose, tooClose, [], scratch()), false);
  });
});

describe("label policy and export schema", () => {
  const camera = cameraLookingAt(new THREE.Vector3(0, 8, 14), new THREE.Vector3(0, 0.5, 0));
  const corners = cube(new THREE.Vector3(0, 0.6, 0), 1.2);

  it("labels vehicles as vehicle and debris as unknown while keeping the real type", () => {
    const vehicle = vehicleRecord(
      { id: 4, laneId: "mich-nb-0", parked: false, x: 2, z: -3, v: 6.5 },
      corners,
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    );
    const parked = vehicleRecord(
      { id: 9, laneId: "park", parked: true, x: 12, z: 4, v: 0 },
      corners,
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    );
    const tire = debrisRecord(
      { id: 0, type: "tire", kind: "debris", x: 10.6, z: 22 },
      corners,
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    );
    const barrier = debrisRecord(
      { id: 2, type: "barrier", kind: "blockade", x: 14.4, z: -20 },
      corners,
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    );
    assert.ok(vehicle && parked && tire && barrier);
    assert.equal(vehicle.class, "vehicle");
    assert.equal(vehicle.type, "vehicle");
    assert.equal(vehicle.kind, null);
    assert.equal(vehicle.trackId, "veh-4");
    assert.equal(vehicle.laneId, "mich-nb-0");
    assert.equal(vehicle.speed, 6.5);
    assert.deepEqual(vehicle.position, { x: 2, y: 0, z: -3 });
    assert.equal(parked.laneId, null);
    assert.equal(tire.class, "unknown");
    assert.equal(tire.type, "tire");
    assert.equal(tire.kind, "debris");
    assert.equal(tire.trackId, "deb-0");
    assert.equal(tire.laneId, null);
    assert.equal(tire.speed, null);
    assert.equal(barrier.class, "unknown");
    assert.equal(barrier.type, "barrier");
    assert.equal(barrier.kind, "blockade");
    assert.equal(YOLO_CLASS_ID[vehicle.class], 0);
    assert.equal(YOLO_CLASS_ID[tire.class], 1);

    const pose = cameraRecord(camera, CORPUS_WIDTH, CORPUS_HEIGHT);
    const frame = makeFrame({
      index: 3,
      t: 1.25,
      hz: 10,
      camera: pose,
      objects: [vehicle, tire, barrier],
    });
    assert.deepEqual(validateFrame(frame), []);
    const raw = JSON.stringify(frame);
    assert.equal(raw.includes('"class":"tire"'), false);
    assert.equal(raw.includes('"class":"unknown"'), true);
    assert.equal(raw.includes('"type":"tire"'), true);
    assert.equal(raw.includes("score"), false);
    const yolo = frameToYolo(frame).trim().split("\n");
    assert.equal(yolo.length, 3);
    assert.equal(yolo[0]!.startsWith("0 "), true);
    assert.equal(yolo[1]!.startsWith("1 "), true);
    assert.equal(yolo[2]!.startsWith("1 "), true);
  });

  it("round-trips jsonl and a stored zip with the YOLO layout", () => {
    const pose = cameraRecord(camera, CORPUS_WIDTH, CORPUS_HEIGHT);
    const vehicle = vehicleRecord(
      { id: 1, laneId: "chi-eb-1", parked: false, x: 0, z: 0, v: 3 },
      corners,
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    );
    assert.ok(vehicle);
    const frames: CorpusFrame[] = [0, 1].map((index) =>
      makeFrame({ index, t: index / 10, hz: 10, camera: pose, objects: [vehicle] }),
    );
    const text = framesToJsonl(frames);
    const parsed = parseJsonl(text);
    assert.equal(parsed.length, 2);
    for (const frame of parsed) assert.deepEqual(validateFrame(frame), []);
    assert.equal(achievedRate(parsed), 10);

    const png = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
    const entries = corpusArchiveEntries("cam0-corpus-test", frames, [png, png]);
    const names = entries.map((entry) => entry.name);
    assert.deepEqual(names, [
      "cam0-corpus-test/README.md",
      "cam0-corpus-test/labels.jsonl",
      "cam0-corpus-test/data.yaml",
      "cam0-corpus-test/images/000000.png",
      "cam0-corpus-test/labels/000000.txt",
      "cam0-corpus-test/images/000001.png",
      "cam0-corpus-test/labels/000001.txt",
    ]);
    const restored = unzipStore(zipStore(entries));
    assert.deepEqual(
      restored.map((entry) => entry.name),
      names,
    );
    const readme = new TextDecoder().decode(restored[0]!.data);
    assert.match(readme, /ground truth/i);
    assert.match(readme, /not detections/i);
    assert.match(readme, /unknown/);
    assert.match(readme, /\+X is east/);
    assert.match(readme, /YXZ/);
    assert.match(readme, /pinhole centre/);
    assert.match(readme, /top-left corner/);
    assert.match(readme, /mich-nb-0/);
    const yaml = new TextDecoder().decode(restored[2]!.data);
    assert.equal(yaml, DATA_YAML);
    assert.match(yaml, /0: vehicle/);
    assert.match(yaml, /1: unknown/);
    const jsonl = new TextDecoder().decode(restored[1]!.data);
    assert.equal(jsonl, text);
    assert.deepEqual(restored[3]!.data, png);
    const yolo = new TextDecoder().decode(restored[4]!.data);
    assert.equal(yolo.startsWith("0 "), true);
    assert.equal(yolo.endsWith("\n"), true);
  });
});

describe("published CAM0 sample", () => {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "__fixtures__",
    "cam0-sample.labels.jsonl",
  );

  it("parses the fixture against the current schema", () => {
    const frames = parseJsonl(readFileSync(fixturePath, "utf8"));
    assert.ok(frames.length >= 20 && frames.length <= 50);
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;
      assert.equal(frame.index, i);
      assert.equal(frame.rateHz, 10);
      assert.deepEqual(validateFrame(frame), [], `frame ${i}`);
      if (i > 0) assert.ok(frame.t > frames[i - 1]!.t);
    }
    assert.ok(Math.abs(achievedRate(frames) - 10) < 1e-9);
    const classes = new Set(frames.flatMap((frame) => frame.objects.map((obj) => obj.class)));
    assert.ok(classes.has("vehicle"));
    assert.ok(classes.has("unknown"));
  });

  it("documents how to invert the projection", () => {
    const readme = corpusReadme({
      runId: "cam0-corpus-test",
      frames: 1,
      hz: 10,
      achievedHz: 10,
      t0: 0,
      t1: 0,
      width: CORPUS_WIDTH,
      height: CORPUS_HEIGHT,
    });
    assert.match(readme, /ground plane is y = 0/);
    assert.match(readme, /\+Z is south/);
    assert.match(readme, /radians/);
    assert.match(readme, /order `YXZ`/);
    assert.match(readme, /Positive pitch rotates the look direction toward \+Y/);
    assert.match(readme, /dir_camera = \(X, Y, -1\)/);
    assert.match(readme, /not its centre/);
    assert.match(readme, /scalar lane speed/);
    assert.match(readme, /mich-sb-2/);
    assert.match(readme, /chi-eb-0/);
    assert.match(readme, /internal parked id `park` is not written/);
  });
});

describe("sample clock", () => {
  it("clamps the rate and samples at 10 Hz of sim time", () => {
    assert.equal(clampCorpusHz(Number.NaN), 10);
    assert.equal(clampCorpusHz(0), 1);
    assert.equal(clampCorpusHz(30), 30);
    assert.equal(clampCorpusHz(48), 30);
    const clock = new FrameClock();
    clock.reset(10);
    const times: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      if (clock.due(t)) times.push(t);
    }
    assert.equal(times.length, 11);
    assert.equal(times[0], 0);
    assert.equal(times[1], 0.1);
    assert.equal(times[10], 1);
    assert.equal(clock.due(1), false);
    assert.equal(clock.due(0.05), false);
    assert.equal(achievedRate(times.map((t) => ({ t }))), 10);
  });
});
