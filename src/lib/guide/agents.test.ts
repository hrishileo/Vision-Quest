import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { AGENT_SIZE, agentCorners, type SimAgent } from "./agents.ts";
import { pointInBuilding } from "./city.ts";
import { HORIZON_TILT_TRIAL, recordLabels } from "./closed-loop.ts";
import {
  CORPUS_HEIGHT,
  CORPUS_WIDTH,
  RoadOutOfViewError,
  YOLO_CLASS_ID,
  agentRecord,
  assertRoadInView,
  cameraRecord,
  classCounts,
  debrisRecord,
  frameToYolo,
  legacyFrame,
  makeFrame,
  nadirCamera,
  roadView,
  validateFrame,
  vehicleRecord,
  type CorpusFrame,
  type CorpusObject,
} from "./corpus.ts";
import { SEQUENCES, TOP_DOWN_ALTITUDES, sequenceYaw } from "./corpus-sequences.ts";
import { SIM_STEP, TrafficSim } from "./traffic.ts";

type NadirPose = {
  id: string;
  x: number;
  agl: number;
  z: number;
  heading: number;
  seed: number;
  density: number;
  warmupS: number;
};
type EulerPose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };

const fixtures = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "topdown-poses.json"),
    "utf8",
  ),
) as { nadir: NadirPose[]; aboveHorizon: EulerPose; skyOnly: EulerPose };

function eulerCamera(pose: EulerPose): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, CORPUS_WIDTH / CORPUS_HEIGHT, 0.04, 500);
  camera.rotation.order = "YXZ";
  camera.position.set(pose.x, pose.y, pose.z);
  camera.rotation.set(pose.pitch, pose.yaw, pose.roll);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function agentObjects(agents: readonly SimAgent[], camera: THREE.Camera): CorpusObject[] {
  const out: CorpusObject[] = [];
  for (const agent of agents) {
    const rec = agentRecord(agent, agentCorners(agent), camera, CORPUS_WIDTH, CORPUS_HEIGHT);
    if (rec) out.push(rec);
  }
  return out;
}

function topDownClip(pose: NadirPose, frames: number, hz: number): CorpusFrame[] {
  const sim = new TrafficSim(pose.seed);
  sim.reset(pose.seed, pose.density);
  sim.advance(Math.round(pose.warmupS / SIM_STEP));
  const camera = nadirCamera(pose.x, pose.agl, pose.z, pose.heading);
  const out: CorpusFrame[] = [];
  for (let index = 0; index < frames; index++) {
    sim.advance(Math.round(1 / hz / SIM_STEP));
    out.push(
      makeFrame({
        index,
        t: sim.time,
        hz,
        camera: cameraRecord(camera, CORPUS_WIDTH, CORPUS_HEIGHT),
        objects: agentObjects(sim.agents, camera),
      }),
    );
  }
  return out;
}

/** README inversion: pixel → camera ray → YXZ rotation → ground plane. */
function pixelToGround(frame: CorpusFrame, u: number, v: number): { x: number; z: number } {
  const { position, yaw, pitch, roll, intrinsics: k } = frame.camera;
  const dir = new THREE.Vector3((u - k.cx) / k.fx, (k.cy - v) / k.fy, -1).applyEuler(
    new THREE.Euler(pitch, yaw, roll, "YXZ"),
  );
  const t = -position.y / dir.y;
  return { x: position.x + dir.x * t, z: position.z + dir.z * t };
}

describe("pedestrians, bicycles, and motors", () => {
  it("a 30 m top-down frame boxes at least one person and one bicycle", () => {
    const pose = fixtures.nadir.find((p) => p.id === "top30")!;
    const [frame] = topDownClip(pose, 1, 5);
    assert.ok(frame);
    assert.deepEqual(validateFrame(frame), []);
    const counts = classCounts([frame]);
    assert.ok(counts.person >= 1, `persons ${counts.person}`);
    assert.ok(counts.bicycle >= 1, `bicycles ${counts.bicycle}`);
    for (const obj of frame.objects) {
      assert.equal(obj.kind, null);
      assert.ok(obj.zone === null || obj.zone!.length > 0);
      if (obj.class === "bicycle") assert.match(obj.zone ?? "", /^(mich|chi)-/);
      if (obj.class === "person") assert.ok(obj.zone, `${obj.trackId} has a zone`);
    }
    const yolo = frameToYolo(frame).trim().split("\n");
    const ids = new Set(yolo.map((line) => Number(line.split(" ")[0])));
    assert.ok(ids.has(YOLO_CLASS_ID.person));
    assert.ok(ids.has(YOLO_CLASS_ID.bicycle));
  });

  it("keeps person, bicycle, and motor track ids stable across consecutive frames", () => {
    const pose = fixtures.nadir.find((p) => p.id === "top30")!;
    const hz = 5;
    const frames = topDownClip(pose, 12, hz);
    const vmax = 9;
    for (let i = 1; i < frames.length; i++) {
      const prev = new Map(frames[i - 1]!.objects.map((obj) => [obj.trackId, obj]));
      const cur = frames[i]!.objects;
      assert.deepEqual(validateFrame(frames[i]!), []);
      const shared = cur.filter((obj) => prev.has(obj.trackId));
      assert.ok(
        shared.length >= Math.min(cur.length, prev.size) * 0.8,
        `frame ${i} kept ${shared.length}`,
      );
      for (const obj of shared) {
        const before = prev.get(obj.trackId)!;
        assert.equal(obj.class, before.class, obj.trackId);
        assert.equal(obj.type, before.type, obj.trackId);
        const step = Math.hypot(
          obj.position.x - before.position.x,
          obj.position.z - before.position.z,
        );
        assert.ok(step <= vmax / hz + 1e-6, `${obj.trackId} jumped ${step.toFixed(2)} m`);
      }
    }
    const ids = new Set(frames.flatMap((frame) => frame.objects.map((obj) => obj.trackId)));
    assert.ok([...ids].some((id) => id.startsWith("ped-")));
    assert.ok([...ids].some((id) => id.startsWith("bike-")));
  });

  it("records a straight-down pose and intrinsics that invert back to the ground", () => {
    for (const pose of fixtures.nadir) {
      const [frame] = topDownClip(pose, 1, 5);
      const cam = frame!.camera;
      assert.ok(Math.abs(cam.pitch + Math.PI / 2) < 1e-6, `${pose.id} pitch ${cam.pitch}`);
      assert.equal(cam.agl, pose.agl);
      assert.equal(cam.intrinsics.width, CORPUS_WIDTH);
      assert.ok(
        Math.abs(cam.intrinsics.fy - CORPUS_HEIGHT / 2 / Math.tan((35 * Math.PI) / 180)) < 1e-9,
      );
      const centre = pixelToGround(frame!, cam.intrinsics.cx, cam.intrinsics.cy);
      assert.ok(Math.hypot(centre.x - pose.x, centre.z - pose.z) < 1e-6, pose.id);
      // Image-up is the heading: a pixel above centre lands north of the camera.
      const up = pixelToGround(frame!, cam.intrinsics.cx, cam.intrinsics.cy - 100);
      assert.ok(up.z < pose.z - 1, `${pose.id} image-up should be north`);
      for (const obj of frame!.objects) {
        const ground = pixelToGround(
          frame!,
          obj.bbox.x + obj.bbox.w / 2,
          obj.bbox.y + obj.bbox.h / 2,
        );
        const near = Math.hypot(ground.x - obj.position.x, ground.z - obj.position.z);
        // The box centre sits on the rig's top half, so parallax grows off-axis. Bound it loosely.
        assert.ok(near < 2.5, `${pose.id} ${obj.trackId} ground hit ${near.toFixed(2)} m off`);
      }
    }
  });

  it("covers 30, 60, and 120 m nadir passes in the recorder sequences", () => {
    const top = SEQUENCES.filter((seq) => seq.topDown);
    assert.deepEqual(
      top.map((seq) => seq.altitude).sort((a, b) => a - b),
      [...TOP_DOWN_ALTITUDES],
    );
    for (const seq of top) {
      const camera = nadirCamera(seq.x, seq.altitude, seq.z, sequenceYaw(seq));
      const view = assertRoadInView(camera, seq.id);
      assert.ok(view.roadHits > 10, `${seq.id} ${view.roadHits}`);
    }
  });

  it("keeps vehicle and debris records on the two-class contract", () => {
    const camera = nadirCamera(0, 30, 0, Math.PI);
    const corners = [
      { x: -1, y: 0, z: -2 },
      { x: 1, y: 1.4, z: 2 },
    ];
    const car = vehicleRecord(
      { id: 3, laneId: "mich-nb-1", parked: false, x: 0, z: 0, v: 4 },
      corners,
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    )!;
    const deb = debrisRecord(
      { id: 1, type: "tire", kind: "debris", x: 0, z: 0 },
      corners,
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    )!;
    assert.equal("zone" in car, false);
    assert.equal("zone" in deb, false);
    assert.equal(deb.class, "unknown");
    assert.equal(deb.type, "tire");
    assert.equal(YOLO_CLASS_ID.vehicle, 0);
    assert.equal(YOLO_CLASS_ID.unknown, 1);
    const bike = agentRecord(
      { id: 40, type: "scooter", x: 9, z: 20, v: 4, laneId: "mich-nb-2" },
      agentCorners({ x: 9, z: 20, yaw: Math.PI, type: "scooter" }),
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    )!;
    assert.equal(bike.class, "motor");
    assert.equal(bike.type, "scooter");
    assert.equal(bike.trackId, "motor-40");
    const frame = makeFrame({
      index: 0,
      t: 0,
      hz: 5,
      camera: cameraRecord(camera, CORPUS_WIDTH, CORPUS_HEIGHT),
      objects: [car, deb, bike],
    });
    assert.deepEqual(validateFrame(frame), []);
    assert.deepEqual(
      legacyFrame(frame).objects.map((obj) => obj.class),
      ["vehicle", "unknown"],
    );
    const wrong = { ...frame, objects: [{ ...bike, type: "bicycle" }] };
    assert.ok(validateFrame(wrong).includes("type bicycle"));
  });

  it("leaves the car fleet unchanged and keeps agents out of buildings", () => {
    const withAgents = new TrafficSim(37);
    withAgents.reset(37, 1.45);
    const without = new TrafficSim(37);
    without.reset(37, 1.45);
    without.agents = [];
    assert.ok(withAgents.agents.length > 0);
    for (let k = 0; k < 64 * 30; k++) {
      withAgents.advance(1);
      without.advance(1);
      for (const agent of withAgents.agents) {
        assert.equal(pointInBuilding(agent.x, agent.z), false, `agent ${agent.id}`);
      }
    }
    assert.deepEqual(
      withAgents.cars.map((c) => [c.laneId, c.s, c.v]),
      without.cars.map((c) => [c.laneId, c.s, c.v]),
    );
    for (const type of Object.keys(AGENT_SIZE)) {
      assert.ok(
        withAgents.agents.some((agent) => agent.type === type),
        type,
      );
    }
  });
});

describe("road-view guard", () => {
  it("rejects a camera pitched above the horizon", () => {
    for (const pose of [fixtures.aboveHorizon, fixtures.skyOnly]) {
      const camera = eulerCamera(pose);
      const view = roadView(camera);
      assert.equal(view.descends, false);
      assert.throws(() => assertRoadInView(camera, "above"), RoadOutOfViewError);
    }
  });

  it("refuses to record the horizon-tilt trial", () => {
    assert.throws(() => recordLabels(HORIZON_TILT_TRIAL, "loop"), /leaves the road out of view/);
  });

  it("rejects a descending camera that only sees rooftops and lots", () => {
    // Looking down into the NE lots, away from both streets.
    const camera = nadirCamera(45, 6, -45, Math.PI);
    assert.throws(() => assertRoadInView(camera, "lots"), RoadOutOfViewError);
  });
});
