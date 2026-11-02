import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  AGENT_SIZE,
  agentCorners,
  riderCorners,
  spawnAgents,
  type SimAgent,
} from "./agents.ts";
import { pointInBuilding } from "./city.ts";
import { HORIZON_TILT_TRIAL, recordLabels } from "./closed-loop.ts";
import {
  CORPUS_HEIGHT,
  CORPUS_WIDTH,
  MIN_PERSON_PX,
  RoadOutOfViewError,
  YOLO_CLASS_ID,
  agentLabels,
  agentRecord,
  assertRoadInView,
  cameraRecord,
  classCounts,
  corpusArchiveEntries,
  cullSmallPersons,
  debrisRecord,
  frameToYolo,
  framesToJsonl,
  makeFrame,
  nadirCamera,
  roadView,
  validateFrame,
  vehicleRecord,
  type CorpusFrame,
  type CorpusObject,
} from "./corpus.ts";
import { SEQUENCES, TOP_DOWN_ALTITUDES, sequenceYaw } from "./corpus-sequences.ts";
import { SIM_STEP, TrafficSim, createSimCar } from "./traffic.ts";
import { laneById, wrapS } from "./city.ts";

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

/** Headless twin of the recorder's agent labels: rig box, rider box, then the person-size cull. */
function agentLabelsRaw(agents: readonly SimAgent[], camera: THREE.Camera): CorpusObject[] {
  return agents.flatMap((agent) =>
    agentLabels(agent, agentCorners(agent), riderCorners(agent), camera, CORPUS_WIDTH, CORPUS_HEIGHT),
  );
}

function agentObjects(agents: readonly SimAgent[], camera: THREE.Camera): CorpusObject[] {
  return cullSmallPersons(agentLabelsRaw(agents, camera)).kept;
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
      [...new Set(top.map((seq) => seq.altitude))].sort((a, b) => a - b),
      [...TOP_DOWN_ALTITUDES],
    );
    for (const seq of top) {
      const camera = nadirCamera(seq.x, seq.altitude, seq.z, sequenceYaw(seq));
      const view = assertRoadInView(camera, seq.id);
      assert.ok(view.roadHits > 10, `${seq.id} ${view.roadHits}`);
    }
  });

  it("keeps vehicle and debris records unchanged next to the new classes", () => {
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
    const entries = corpusArchiveEntries("run", [frame], [Uint8Array.from([137, 80, 78, 71])]);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      [
        "run/README.md",
        "run/labels.jsonl",
        "run/data.yaml",
        "run/images/000000.png",
        "run/labels/000000.txt",
      ],
    );
    const jsonl = new TextDecoder().decode(entries[1]!.data);
    assert.equal(jsonl, framesToJsonl([frame]));
    for (const cls of ["vehicle", "unknown", "motor"])
      assert.ok(jsonl.includes(`"class":"${cls}"`), cls);
    const wrong = { ...frame, objects: [{ ...bike, type: "bicycle" }] };
    assert.ok(validateFrame(wrong).includes("type bicycle"));
  });

  it("spawns the same car fleet with or without agents and keeps agents out of buildings", () => {
    const withAgents = new TrafficSim(37);
    withAgents.reset(37, 1.45);
    const without = new TrafficSim(37);
    without.reset(37, 1.45);
    without.agents = [];
    assert.ok(withAgents.agents.length > 0);
    assert.deepEqual(
      withAgents.cars.map((c) => [c.laneId, c.s, c.v]),
      without.cars.map((c) => [c.laneId, c.s, c.v]),
    );
    for (let k = 0; k < 64 * 30; k++) {
      withAgents.advance(1);
      for (const agent of withAgents.agents) {
        assert.equal(pointInBuilding(agent.x, agent.z), false, `agent ${agent.id}`);
      }
    }
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

describe("riders as their own person box", () => {
  const pose = () => fixtures.nadir.find((p) => p.id === "top30")!;

  /** One 30 m frame before the person-size cull, so every rider box is present. */
  function rawFrame(index: number, sim: TrafficSim, camera: THREE.PerspectiveCamera): CorpusFrame {
    return makeFrame({
      index,
      t: sim.time,
      hz: 5,
      camera: cameraRecord(camera, CORPUS_WIDTH, CORPUS_HEIGHT),
      objects: agentLabelsRaw(sim.agents, camera),
    });
  }

  /** Vehicle box fully inside the image; one cut by the border may have its rider out of frame. */
  const inside = (o: CorpusObject) =>
    o.bbox.x > 0.5 &&
    o.bbox.y > 0.5 &&
    o.bbox.x + o.bbox.w < CORPUS_WIDTH - 0.5 &&
    o.bbox.y + o.bbox.h < CORPUS_HEIGHT - 0.5;

  function rawClip(frames: number): CorpusFrame[] {
    const p = pose();
    const sim = new TrafficSim(p.seed);
    sim.reset(p.seed, p.density);
    sim.advance(Math.round(p.warmupS / SIM_STEP));
    const camera = nadirCamera(p.x, p.agl, p.z, p.heading);
    const out: CorpusFrame[] = [];
    for (let i = 0; i < frames; i++) {
      sim.advance(Math.round(1 / 5 / SIM_STEP));
      out.push(rawFrame(i, sim, camera));
    }
    return out;
  }

  it("gives every visible bicycle and motor a separate person box for its rider", () => {
    const frame = rawClip(1)[0]!;
    assert.deepEqual(validateFrame(frame), []);
    const vehicles = frame.objects.filter(
      (o) => (o.class === "bicycle" || o.class === "motor") && inside(o),
    );
    assert.ok(vehicles.length >= 1, "a rider in view");
    for (const ride of vehicles) {
      const riders = frame.objects.filter((o) => o.riding === ride.trackId);
      assert.equal(riders.length, 1, `${ride.trackId} has one rider`);
      const rider = riders[0]!;
      assert.equal(rider.class, "person");
      assert.equal(rider.type, "person");
      assert.equal(rider.kind, null);
      assert.equal(rider.laneId, ride.laneId);
      assert.notEqual(rider.trackId, ride.trackId);
      // The rider sits on the vehicle: its box centre falls inside the vehicle box.
      const cx = rider.bbox.x + rider.bbox.w / 2;
      const cy = rider.bbox.y + rider.bbox.h / 2;
      assert.ok(cx >= ride.bbox.x && cx <= ride.bbox.x + ride.bbox.w, rider.trackId);
      assert.ok(cy >= ride.bbox.y && cy <= ride.bbox.y + ride.bbox.h, rider.trackId);
      assert.ok(rider.bbox.w * rider.bbox.h < ride.bbox.w * ride.bbox.h, "rider box is the body only");
    }
    // Riders show up as YOLO class 2 lines next to their class 3/4 lines.
    const lines = frameToYolo(frame).trim().split("\n");
    const persons = lines.filter((line) => line.startsWith(`${YOLO_CLASS_ID.person} `)).length;
    assert.equal(persons, frame.objects.filter((o) => o.class === "person").length);
    assert.ok(persons >= vehicles.length);
  });

  it("keeps each rider's track id for as long as its vehicle stays in view", () => {
    const frames = rawClip(12);
    const owner = new Map<string, string>();
    let seen = 0;
    for (const frame of frames) {
      assert.deepEqual(validateFrame(frame), []);
      const ids = new Set(frame.objects.map((o) => o.trackId));
      for (const obj of frame.objects) {
        if ((obj.class !== "bicycle" && obj.class !== "motor") || !inside(obj)) continue;
        const rider = frame.objects.find((o) => o.riding === obj.trackId);
        assert.ok(rider, `${obj.trackId} lost its rider`);
        const before = owner.get(obj.trackId);
        if (before) assert.equal(rider.trackId, before, `${obj.trackId} rider id changed`);
        owner.set(obj.trackId, rider.trackId);
        seen += 1;
      }
      for (const obj of frame.objects) {
        if (obj.riding) assert.ok(ids.has(obj.riding));
      }
    }
    assert.ok(seen >= 12);
    const riderIds = new Set(owner.values());
    assert.equal(riderIds.size, owner.size, "one rider id per vehicle");
  });

  it("rejects a rider box whose vehicle is not in the frame", () => {
    const [frame] = rawClip(1);
    const rider = frame!.objects.find((o) => o.riding)!;
    const orphan = { ...frame!, objects: [rider] };
    assert.ok(validateFrame(orphan).includes("riding track"));
  });
});

describe("minimum pedestrian size", () => {
  it("drops person boxes under MIN_PERSON_PX on the shorter side and nothing else", () => {
    const camera = nadirCamera(0, 30, 0, Math.PI);
    const box = (w: number, h: number) => ({ x: 100, y: 100, w, h });
    const base = agentRecord(
      { id: 1, type: "person", x: 0, z: 0, v: 1, laneId: null },
      agentCorners({ x: 0, z: 0, yaw: 0, type: "person" }),
      camera,
      CORPUS_WIDTH,
      CORPUS_HEIGHT,
    )!;
    const small = { ...base, trackId: "ped-1", bbox: box(MIN_PERSON_PX - 0.1, 20) };
    const edge = { ...base, trackId: "ped-2", bbox: box(MIN_PERSON_PX, MIN_PERSON_PX) };
    const bike = { ...base, trackId: "bike-3", class: "bicycle" as const, type: "bicycle", bbox: box(2, 2) };
    const { kept, culled } = cullSmallPersons([small, edge, bike]);
    assert.deepEqual(
      culled.map((o) => o.trackId),
      ["ped-1"],
    );
    assert.deepEqual(
      kept.map((o) => o.trackId),
      ["ped-2", "bike-3"],
    );
  });

  it("skips the tiny 120 m pedestrians and keeps the 30 m ones", () => {
    for (const id of ["top30", "top60", "top120"]) {
      const p = fixtures.nadir.find((n) => n.id === id)!;
      const sim = new TrafficSim(p.seed);
      sim.reset(p.seed, p.density);
      sim.advance(Math.round(p.warmupS / SIM_STEP));
      const camera = nadirCamera(p.x, p.agl, p.z, p.heading);
      const raw = agentLabelsRaw(sim.agents, camera);
      const { kept, culled } = cullSmallPersons(raw);
      const persons = kept.filter((o) => o.class === "person");
      for (const o of persons) assert.ok(Math.min(o.bbox.w, o.bbox.h) >= MIN_PERSON_PX, o.trackId);
      const rawPersons = raw.filter((o) => o.class === "person").length;
      assert.equal(persons.length + culled.length, rawPersons, id);
      // Riders' vehicles are never culled.
      assert.equal(
        kept.filter((o) => o.class !== "person").length,
        raw.filter((o) => o.class !== "person").length,
      );
      if (id === "top30") {
        assert.ok(persons.length >= 1, "30 m keeps pedestrians");
        assert.equal(
          culled.filter((o) => !o.riding).length,
          0,
          "no 30 m pedestrian is under the floor",
        );
        // Most 30 m riders clear the floor too, so the person box survives into labels.
        const riders = raw.filter((o) => o.riding);
        assert.ok(
          kept.filter((o) => o.riding).length >= riders.length / 2,
          `${kept.filter((o) => o.riding).length}/${riders.length} riders kept`,
        );
      }
      if (id === "top120") {
        assert.ok(rawPersons >= 5, "120 m frame has pedestrians to cull");
        assert.equal(persons.length, 0, "every 120 m pedestrian is under the floor");
      }
    }
  });
});

describe("cars yield to riders", () => {
  function bikeOn(laneId: string, s: number, v0: number): SimAgent {
    const [template] = spawnAgents(1, 1, {
      crossers: 0,
      strollers: 0,
      bicycle: 1,
      scooter: 0,
      motorbike: 0,
    });
    assert.ok(template && template.type === "bicycle");
    return { ...template, id: 900, laneId, s, v: v0, v0 };
  }

  it("a car behind a slow bicycle in its lane slows to the bike's speed and keeps a gap", () => {
    const sim = new TrafficSim(5);
    const car = createSimCar({ id: 0, laneId: "mich-nb-2", s: 20, v: 10, v0: 11 });
    const bike = bikeOn("mich-nb-2", 45, 3);
    sim.loadFleet([car], { agents: [bike] });
    const lane = laneById("mich-nb-2")!;
    let minGap = Infinity;
    // 20 s, starting on the NS green so the signal does not stop either of them.
    for (let k = 0; k < 20 * 30; k++) {
      sim.advance(1);
      const gap = wrapS(bike.s - car.s, lane.length) - (car.length + AGENT_SIZE.bicycle.length) / 2;
      minGap = Math.min(minGap, gap);
    }
    assert.ok(minGap > 0.5, `min gap ${minGap.toFixed(2)} m`);
    assert.ok(car.v <= bike.v + 0.5, `car ${car.v.toFixed(2)} vs bike ${bike.v.toFixed(2)} m/s`);

    // Same car with the bike one lane over (no rider ahead) keeps cruising.
    const free = new TrafficSim(5);
    const other = createSimCar({ id: 0, laneId: "mich-nb-1", s: 20, v: 10, v0: 11 });
    free.loadFleet([other], { agents: [bikeOn("mich-nb-2", 45, 3)] });
    free.advance(10 * 30);
    assert.ok(other.v > 7, `free car ${other.v.toFixed(2)} m/s`);
  });

  it("never lets a car drive into a curb-lane rider it was behind", () => {
    for (const seed of [37, 211, 233]) {
      const sim = new TrafficSim(seed);
      sim.reset(seed, 1.6, { bicycle: 14, scooter: 6, motorbike: 4 });
      const riders = sim.agents.filter((a) => a.laneId && a.type !== "person");
      assert.ok(riders.length >= 10);
      const gapOf = (carS: number, len: number, rider: SimAgent) => {
        const lane = laneById(rider.laneId!)!;
        let ds = wrapS(rider.s - carS, lane.length);
        if (ds > lane.length / 2) ds -= lane.length;
        return ds - (len + AGENT_SIZE[rider.type].length) / 2;
      };
      let followed = 0;
      for (let k = 0; k < 64 * 30; k++) {
        const before = new Map<string, number>();
        for (const car of sim.cars) {
          if (car.parked) continue;
          for (const r of riders) {
            if (r.laneId === car.laneId) before.set(`${car.id}:${r.id}`, gapOf(car.s, car.length, r));
          }
        }
        sim.advance(1);
        for (const car of sim.cars) {
          if (car.parked) continue;
          for (const r of riders) {
            const prev = before.get(`${car.id}:${r.id}`);
            if (prev === undefined || r.laneId !== car.laneId) continue;
            const now = gapOf(car.s, car.length, r);
            // Close behind only; a far-side gap flips sign when the wrapped lane passes its half.
            if (prev < 0 || prev > 20) continue;
            if (prev < 8) followed += 1;
            assert.ok(
              now >= 0,
              `seed ${seed} t=${sim.time.toFixed(2)} car ${car.id} ran into rider ${r.id}`,
            );
          }
        }
      }
      assert.ok(followed > 0, `seed ${seed}: some car ends up following a rider`);
    }
  });
});
