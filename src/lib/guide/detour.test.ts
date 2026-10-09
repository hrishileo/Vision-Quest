import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CROSS_Z, LANES, SPAN, laneIdAt } from "./city.ts";
import {
  BLOCK_S0,
  DETOUR_LINKS,
  FINISH_S,
  HUB_NB_LANES,
  PRESETS,
  START_S,
  armFleet,
  blockedLaneDebris,
  blocksFor,
  cohortStats,
  detourHitsBuilding,
  detourRoute,
  junctionGapM,
  maxQueueLengthM,
  meanOf,
  measureCam0Rush,
  p90,
  pursuitEntryCamera,
  routedCount,
  runArm,
  sustainedSlow,
} from "./detour.ts";
import { SIM_STEP, TrafficSim, createSimCar } from "./traffic.ts";

describe("detour route following", () => {
  it("joins the side street without a pose jump and stays off the buildings", () => {
    assert.ok(junctionGapM() < 1e-6);
    const laneChange = DETOUR_LINKS.find(
      (link) => link.from === "mich-nb-1" && link.to === "mich-nb-2",
    )!;
    assert.equal(laneChange.fromS, laneChange.toS);
    assert.equal(detourHitsBuilding(), false);
    assert.deepEqual(detourRoute("mich-nb-2"), [
      "mich-nb-2",
      "chi-eb-0",
      "rush-nb-0",
      "conn-wb-0",
      "mich-nb-2",
    ]);
    assert.deepEqual(HUB_NB_LANES, ["mich-nb-1", "mich-nb-2"]);
    assert.ok(LANES.some((lane) => lane.id === "mich-nb-1"));
    assert.equal(
      LANES.some((lane) => lane.id.startsWith("rush") || lane.id.startsWith("conn")),
      false,
    );
    assert.equal(laneIdAt(60.8, 0), "rush-nb-0");
    assert.equal(laneIdAt(64.4, -10), "rush-nb-1");
  });

  it("drives the given lane sequence and reaches the finish line", () => {
    const sim = new TrafficSim(1);
    const car = createSimCar({
      id: 1,
      laneId: "mich-nb-2",
      s: 72,
      v: 8,
      v0: 11,
      route: detourRoute("mich-nb-2"),
      routed: true,
    });
    sim.loadFleet([car], { seed: 1, links: DETOUR_LINKS });
    const seen: string[] = [car.laneId];
    const route = detourRoute("mich-nb-2");
    let reached = false;
    const steps = Math.round(60 / SIM_STEP);
    for (let i = 0; i < steps; i++) {
      sim.advance(1);
      const done = sim.cars[0]!;
      if (seen[seen.length - 1] !== done.laneId) seen.push(done.laneId);
      if (
        done.laneId === "mich-nb-2" &&
        done.routeIndex === route.length - 1 &&
        done.s >= FINISH_S &&
        done.s < 160
      ) {
        reached = true;
        break;
      }
    }
    assert.deepEqual(seen, route);
    assert.equal(reached, true);
  });

  it("rejects a route that does not start on the car's lane", () => {
    const sim = new TrafficSim(1);
    sim.loadFleet([createSimCar({ id: 3, laneId: "mich-nb-1", s: 20, v: 6, v0: 9 })], {
      seed: 1,
    });
    assert.equal(sim.setRoute(3, ["chi-eb-0", "rush-nb-0"]), false);
    assert.equal(sim.setRoute(3, detourRoute("mich-nb-1")), true);
    assert.deepEqual(sim.cars[0]!.route, detourRoute("mich-nb-1"));
  });
});

describe("blocked-lane presets", () => {
  it("stops a car at the single-lane blockade and lets the open lane pass", () => {
    const sim = new TrafficSim(2);
    sim.loadFleet(
      [
        createSimCar({ id: 1, laneId: "mich-nb-1", s: 86, v: 7, v0: 9 }),
        createSimCar({ id: 2, laneId: "mich-nb-2", s: 86, v: 7, v0: 9 }),
        ...seal("mich-nb-0"),
      ],
      { seed: 2, blocks: blocksFor(PRESETS.single.lanes) },
    );
    sim.advance(Math.round(6 / SIM_STEP));
    const blocked = sim.cars.find((c) => c.id === 1)!;
    const open = sim.cars.find((c) => c.id === 2)!;
    assert.ok(blocked.s < BLOCK_S0);
    assert.ok(blocked.v < 0.5);
    assert.equal(blocked.laneId, "mich-nb-1");
    assert.ok(open.s > BLOCK_S0 + 5);
  });

  it("stops both northbound lanes the hub blocks, and merges when the inner lane is empty", () => {
    const stopped = new TrafficSim(3);
    stopped.loadFleet(
      [
        createSimCar({ id: 1, laneId: "mich-nb-1", s: 88, v: 6, v0: 9 }),
        createSimCar({ id: 2, laneId: "mich-nb-2", s: 88, v: 6, v0: 9 }),
        ...seal("mich-nb-0"),
      ],
      { seed: 3, blocks: blocksFor(PRESETS.both.lanes) },
    );
    stopped.advance(Math.round(12 / SIM_STEP));
    for (const id of [1, 2]) {
      const car = stopped.cars.find((c) => c.id === id)!;
      assert.ok(car.s < BLOCK_S0, `${id} passed the debris`);
      assert.ok(car.v < 0.5);
    }

    const merging = new TrafficSim(4);
    merging.loadFleet([createSimCar({ id: 1, laneId: "mich-nb-2", s: 80, v: 4, v0: 9 })], {
      seed: 4,
      blocks: blocksFor(PRESETS.both.lanes),
    });
    merging.advance(Math.round(8 / SIM_STEP));
    const car = merging.cars[0]!;
    assert.equal(car.laneId, "mich-nb-0");
    assert.ok(car.s > BLOCK_S0);
  });
});

describe("detour metrics", () => {
  it("computes mean, nearest-rank p90, queue length, and the jam window", () => {
    assert.equal(meanOf([]), null);
    assert.equal(meanOf([2, 4, 6]), 4);
    assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
    assert.equal(p90([4]), 4);
    assert.equal(p90([]), null);
    const stats = cohortStats([10, null, 30]);
    assert.equal(stats.n, 3);
    assert.equal(stats.completed, 2);
    assert.equal(stats.incomplete, 1);
    assert.equal(stats.meanTravelS, 20);
    assert.equal(
      maxQueueLengthM(
        [
          { laneId: "rush-nb-0", s: 4, v: 0.2, length: 4 },
          { laneId: "rush-nb-0", s: 10, v: 0.4, length: 4 },
          { laneId: "rush-nb-0", s: 28, v: 0.1, length: 4 },
          { laneId: "rush-nb-1", s: 6, v: 8, length: 4 },
        ],
        ["rush-nb-0", "rush-nb-1"],
      ),
      10,
    );
    const slow = Array.from({ length: 11 }, (_, i) => ({ t: i * 0.5, speed: 1.2 }));
    assert.equal(sustainedSlow(slow, 2.5, 5), true);
    assert.equal(
      sustainedSlow(
        [
          { t: 0, speed: 1 },
          { t: 2, speed: null },
          { t: 2.5, speed: 1 },
          { t: 7, speed: 1 },
        ],
        2.5,
        5,
      ),
      false,
    );
    assert.equal(routedCount(0, 8), 0);
    assert.equal(routedCount(0.25, 8), 2);
    assert.equal(routedCount(1, 8), 8);
  });

  it("keeps demand fixed across arms and repeats a short run", () => {
    const stay = armFleet(11, 0.5, PRESETS.single.lanes, "stay");
    const detour = armFleet(11, 0.5, PRESETS.single.lanes, "detour");
    assert.deepEqual(
      stay.cars.map((c) => [c.id, c.laneId, c.s, c.routed]),
      detour.cars.map((c) => [c.id, c.laneId, c.s, c.routed]),
    );
    assert.ok(detour.cars.some((c) => c.routed && c.route?.[1] === "mich-nb-2"));
    assert.ok(stay.cars.filter((c) => c.routed).every((c) => c.route?.length === 1));
    const a = runArm(11, 1, PRESETS.single.lanes, "detour", 8);
    const b = runArm(11, 1, PRESETS.single.lanes, "detour", 8);
    assert.deepEqual(a.cars, b.cars);
    assert.ok(a.cars.some((c) => c.laneId === "mich-nb-1"));
    assert.equal(a.routed.n > 0, true);
  });
});

function seal(laneId: string) {
  const cars = [];
  for (let s = 70; s <= 130; s += 7.2) {
    cars.push(createSimCar({ id: 100 + s, laneId, s, v: 0, v0: 8, length: 4.4 }));
  }
  return cars;
}

describe("start and finish gates", () => {
  it("uses the same Michigan s for both arms", () => {
    assert.ok(START_S < 75.6);
    assert.ok(FINISH_S > SPAN - CROSS_Z);
    assert.deepEqual(
      blocksFor(["mich-nb-1", "mich-nb-2"]).map((b) => b.laneId),
      ["mich-nb-1", "mich-nb-2"],
    );
    const debris = blockedLaneDebris(PRESETS.both.lanes);
    assert.ok(debris.length > 0);
    for (const def of debris) {
      const lane = Math.abs(def.x - 5.5) < Math.abs(def.x - 9) ? "mich-nb-1" : "mich-nb-2";
      assert.equal(laneIdAt(def.x, def.z), lane);
    }
    assert.ok(debris.some((def) => laneIdAt(def.x, def.z) === "mich-nb-1"));
    assert.ok(debris.some((def) => laneIdAt(def.x, def.z) === "mich-nb-2"));
  });
});

describe("CAM0 Rush visibility", () => {
  it("keeps the unmoved pursuit pose and reports frame fractions", () => {
    const parked = pursuitEntryCamera();
    assert.equal(parked.body.y, 8);
    assert.equal(parked.body.yaw, Math.PI);
    assert.equal(parked.body.pitch, 0);
    assert.equal(parked.body.roll, 0);
    assert.ok(Math.abs(parked.body.x - 5.5) < 1e-9);
    assert.ok(Math.abs(parked.body.z - 42) < 1e-9);
    const view = measureCam0Rush({ horizonS: 2, fraction: 1, preset: "both", seed: 7 });
    assert.equal(view.droneMoved, false);
    assert.equal(view.gimbalYaw, 0);
    assert.equal(view.gimbalPitch, 0);
    assert.equal(view.body.y, 8);
    assert.equal(view.body.z, parked.body.z);
    assert.ok(view.frames >= 20);
    assert.ok(view.rushLaneFraction === 0 || view.rushLaneFraction === 1);
    assert.equal(view.rushLaneFrames / view.frames, view.rushLaneFraction);
    assert.ok(view.rushCarFraction >= 0 && view.rushCarFraction <= 1);
    assert.equal(view.rushCarFrames / view.frames, view.rushCarFraction);
    assert.deepEqual(view.laneIds, ["rush-nb-0", "rush-nb-1"]);
    assert.equal(view.visibleSamples, 0);
    assert.equal(view.rushLaneFraction, 0);
    assert.ok(view.outsideFrustum > 0);
    assert.ok(view.occluded > 0);
    assert.ok(view.occluders.includes("Walgreens"));
    assert.match(view.routerNote, /unknown/);
    assert.match(view.routerNote, /true travel times/);
  });
});
