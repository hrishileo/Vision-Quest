import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { laneById } from "./city.ts";
import {
  HUB_LANE_TO_SCENE,
  LOOP_LINKS,
  LOOP_THRESHOLDS,
  corridorOf,
  debrisPieces,
  loopJunctionGapM,
  loopRouteHitsBuilding,
  sceneLane,
  showcaseOnDetour,
  simRouteFor,
  trialById,
  viewPoint,
  type Plan,
  type Replay,
} from "./closed-loop.ts";
import { scoreTrial } from "./closed-loop.ts";
import { SIM_STEP, TrafficSim, createSimCar } from "./traffic.ts";

describe("hub lanes map onto scene roads", () => {
  it("matches the shared fixture and the lanes exist", () => {
    const payload = JSON.parse(
      readFileSync(new URL("./__fixtures__/hub-scene-lanes.json", import.meta.url), "utf8"),
    ) as {
      lanes: Record<string, string>;
      samples: { route: string[]; corridor: string; scene: string }[];
    };
    assert.deepEqual(payload.lanes, HUB_LANE_TO_SCENE);
    for (const [hub, scene] of Object.entries(HUB_LANE_TO_SCENE)) {
      assert.equal(sceneLane(hub), scene);
      assert.ok(laneById(scene), scene);
    }
    for (const sample of payload.samples) {
      assert.equal(corridorOf(sample.route), sample.corridor);
      assert.equal(sceneLane(sample.corridor), sample.scene);
    }
    assert.equal(LOOP_THRESHOLDS.detectWithinS, 5);
    assert.equal(LOOP_THRESHOLDS.followRate, 0.95);
    assert.equal(LOOP_THRESHOLDS.herdMaxShare, 0.75);
  });

  it("joins Rush and Wabash without a pose jump or a building hit", () => {
    assert.ok(loopJunctionGapM() < 1e-6);
    assert.equal(loopRouteHitsBuilding(), false);
    assert.deepEqual(simRouteFor("mich-nb-2", "rush-nb"), [
      "mich-nb-2",
      "chi-eb-0",
      "rush-nb-0",
      "conn-wb-0",
      "mich-nb-2",
    ]);
    assert.deepEqual(simRouteFor("mich-nb-0", "wabash-nb"), [
      "mich-nb-0",
      "chi-wb-0",
      "wabash-nb-0",
      "conn-eb-0",
      "mich-nb-0",
    ]);
    assert.ok(LOOP_LINKS.some((link) => link.from === "mich-nb-1" && link.to === "mich-nb-0"));
  });
});

describe("cars follow the alert corridor", () => {
  it("drives Rush, drives Wabash, and leaves southbound on Michigan", () => {
    const rush = new TrafficSim(1);
    const rushCar = createSimCar({
      id: 1,
      laneId: "mich-nb-2",
      s: 62,
      v: 8,
      v0: 10,
      route: simRouteFor("mich-nb-2", "rush-nb"),
      routed: true,
    });
    rush.loadFleet([rushCar], { seed: 1, links: LOOP_LINKS });
    let sawRush = false;
    for (let i = 0; i < Math.round(40 / SIM_STEP); i++) {
      rush.advance(1);
      if (rush.cars[0]!.laneId === "rush-nb-0") sawRush = true;
    }
    assert.equal(sawRush, true);

    const wabash = new TrafficSim(1);
    wabash.loadFleet(
      [
        createSimCar({
          id: 2,
          laneId: "mich-nb-0",
          s: 62,
          v: 8,
          v0: 10,
          route: simRouteFor("mich-nb-0", "wabash-nb"),
          routed: true,
        }),
      ],
      { seed: 1, links: LOOP_LINKS },
    );
    let sawWabash = false;
    for (let i = 0; i < Math.round(40 / SIM_STEP); i++) {
      wabash.advance(1);
      if (wabash.cars[0]!.laneId === "wabash-nb-0") sawWabash = true;
    }
    assert.equal(sawWabash, true);

    const south = new TrafficSim(1);
    south.loadFleet([createSimCar({ id: 101, laneId: "mich-sb-0", s: 20, v: 8, v0: 10 })], {
      seed: 1,
      links: LOOP_LINKS,
    });
    south.advance(Math.round(8 / SIM_STEP));
    assert.equal(south.cars[0]!.laneId, "mich-sb-0");
    assert.equal(south.setRoute(101, simRouteFor("mich-nb-0", "wabash-nb")), false);
  });

  it("weaves a crossing platoon onto both detours", () => {
    const sim = new TrafficSim(1);
    const cars = [
      createSimCar({
        id: 1,
        laneId: "mich-nb-0",
        s: 40,
        v: 8,
        v0: 9,
        route: simRouteFor("mich-nb-0", "rush-nb"),
        routed: true,
      }),
      createSimCar({
        id: 2,
        laneId: "mich-nb-2",
        s: 46,
        v: 8,
        v0: 9,
        route: simRouteFor("mich-nb-2", "wabash-nb"),
        routed: true,
      }),
      createSimCar({
        id: 3,
        laneId: "mich-nb-1",
        s: 34,
        v: 8,
        v0: 9,
        route: simRouteFor("mich-nb-1", "rush-nb"),
        routed: true,
      }),
    ];
    sim.loadFleet(cars, { seed: 1, links: LOOP_LINKS });
    const seen = new Set<string>();
    for (let i = 0; i < Math.round(30 / SIM_STEP); i++) {
      sim.advance(1);
      for (const car of sim.cars) seen.add(`${car.id}:${car.laneId}`);
    }
    assert.equal(seen.has("1:rush-nb-0"), true);
    assert.equal(seen.has("2:wabash-nb-0"), true);
    assert.equal(seen.has("3:rush-nb-0"), true);
    assert.equal(
      sim.cars.every((car) => car.v > 0.2 || !car.laneId.startsWith("mich-nb")),
      true,
    );
  });

  it("follows a slow platoon off Rush instead of stalling at the end of the street", () => {
    const sim = new TrafficSim(2);
    sim.loadFleet(
      [
        createSimCar({
          id: 400,
          laneId: "rush-nb-0",
          s: 16,
          v: 3,
          v0: 3.2,
          route: ["rush-nb-0", "conn-wb-0", "mich-nb-2"],
          routed: true,
        }),
        createSimCar({
          id: 1,
          laneId: "mich-nb-2",
          s: 70,
          v: 8,
          v0: 9,
          route: simRouteFor("mich-nb-2", "rush-nb"),
          routed: true,
        }),
      ],
      { seed: 2, links: LOOP_LINKS },
    );
    let sawRush = false;
    let sawReturn = false;
    for (let i = 0; i < Math.round(80 / SIM_STEP); i++) {
      sim.advance(1);
      const car = sim.cars.find((item) => item.id === 1)!;
      if (car.laneId === "rush-nb-0") sawRush = true;
      if (sawRush && car.laneId === "mich-nb-2") sawReturn = true;
    }
    assert.equal(sawRush, true);
    assert.equal(sawReturn, true);
  });

  it("puts the showcase fleet on both detours", () => {
    const shot = showcaseOnDetour();
    assert.ok(shot.rush > 0, "expected a car on Rush");
    assert.ok(shot.wabash > 0, "expected a car on Wabash");
    assert.equal(shot.sbOff, true);
  });
});

describe("trial score", () => {
  it("names a false block, a missed follow, and a southbound alert", () => {
    const trial = trialById("control-queue");
    const plans: Plan[] = [
      {
        t: 2,
        blocked: ["mich-nb-1"],
        alerts: [
          {
            driver_id: "veh-101",
            reason: "mich-nb-1:blocked",
            old_eta_s: null,
            new_eta_s: 40,
            saved_s: null,
            route: ["wabash-nb@ohio--ontario"],
            t: 2,
          },
        ],
      },
    ];
    const empty = new Map<number, string[]>();
    const travel = new Map<number, number | null>();
    const replay: Replay = { visits: empty, travel, endLane: new Map(), endRoute: new Map() };
    const score = scoreTrial(trial, plans, replay, replay);
    assert.equal(score.pass, false);
    assert.ok(score.failed.includes("false-block"));
    assert.ok(score.failed.includes("southbound"));
  });

  it("rejects a herd that piles every car onto one street", () => {
    const trial = trialById("nominal-all-lanes");
    const alerts = Array.from({ length: 8 }, (_, index) => ({
      driver_id: `veh-${index + 1}`,
      reason: "mich-nb-0:blocked",
      old_eta_s: null,
      new_eta_s: 40,
      saved_s: null,
      route: ["rush-nb@ohio--ontario"],
      t: 2,
    }));
    const plans: Plan[] = [{ t: 2, blocked: ["mich-nb-0", "mich-nb-1", "mich-nb-2"], alerts }];
    const visits = new Map<number, string[]>();
    const travel = new Map<number, number | null>();
    for (let id = 1; id <= 8; id++) {
      visits.set(id, ["mich-nb-0", "rush-nb-0"]);
      travel.set(id, 30);
    }
    const stayTravel = new Map<number, number | null>();
    for (let id = 1; id <= 8; id++) stayTravel.set(id, null);
    const score = scoreTrial(
      trial,
      plans,
      { visits, travel, endLane: new Map(), endRoute: new Map() },
      { visits, travel: stayTravel, endLane: new Map(), endRoute: new Map() },
    );
    assert.ok(score.failed.includes("herd"));
    assert.equal(score.herdShare, 1);
    assert.ok(score.followRate >= LOOP_THRESHOLDS.followRate);
    assert.ok((score.travelRerouteS ?? 999) < (score.travelBaseS ?? 0));
  });
});

describe("recorder visibility", () => {
  it("sees nominal debris and distinguishes the frame-edge margin", () => {
    const nominal = trialById("nominal-all-lanes");
    const piece = debrisPieces(nominal.debris, 0)[0]!;
    const center = { x: piece.x, y: 0.55, z: piece.z };
    const seen = viewPoint(nominal.pose, center, 0.995);
    assert.equal(seen.inFrame, true, `ndc ${seen.ndcX.toFixed(2)}, ${seen.ndcY.toFixed(2)}`);
    assert.equal(seen.occluded, false);

    const edge = trialById("frame-edge");
    const edgePiece = debrisPieces(edge.debris, 1)[0]!;
    const edgeCenter = { x: edgePiece.x, y: 0.55, z: edgePiece.z };
    const lock = viewPoint(edge.pose, edgeCenter, 0.92);
    const full = viewPoint(edge.pose, edgeCenter, 0.995);
    assert.equal(full.inFrame, true, `edge ndc ${full.ndcX.toFixed(2)}, ${full.ndcY.toFixed(2)}`);
    assert.equal(full.occluded, false);
    assert.equal(lock.inFrame, false);

    const hidden = trialById("partial-occlusion");
    const barrier = debrisPieces(hidden.debris, 0)[0]!;
    const mid = { x: barrier.x, y: 0.55, z: barrier.z };
    const hiddenCenter = viewPoint(hidden.pose, mid, 0.995);
    assert.equal(hiddenCenter.inFrame, true);
    assert.equal(hiddenCenter.occluded, true, "barrier center stays behind the building");
  });
});
