import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { laneIdAt } from "./city.ts";
import {
  SEQUENCES,
  SUN,
  TIME_OF_DAY,
  placementLane,
  sequencesBySplit,
} from "./corpus-sequences.ts";
import { TrafficSim } from "./traffic.ts";

describe("CAM0 training sequences", () => {
  it("splits by sequence and covers time of day, density, altitude, and debris", () => {
    const ids = SEQUENCES.map((seq) => seq.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.length >= 8);
    const split = sequencesBySplit();
    assert.ok(split.train.length >= 4);
    assert.ok(split.val.length >= 1);
    assert.ok(split.test.length >= 1);
    const seen = new Set([...split.train, ...split.val, ...split.test].map((seq) => seq.id));
    assert.equal(seen.size, ids.length);

    const tod = new Set(SEQUENCES.map((seq) => seq.timeOfDay));
    for (const name of TIME_OF_DAY) assert.ok(tod.has(name), name);
    const altitudes = SEQUENCES.map((seq) => seq.altitude);
    assert.ok(Math.max(...altitudes) - Math.min(...altitudes) >= 6);
    const density = SEQUENCES.map((seq) => seq.density);
    assert.ok(Math.min(...density) < 0.6);
    assert.ok(Math.max(...density) > 1.3);

    const moved = SEQUENCES.reduce((n, seq) => n + seq.debris.length, 0);
    assert.ok(moved >= 4);
    const close = split.train.filter((seq) => seq.altitude <= 5 && seq.debris.length >= 4);
    assert.ok(close.length >= 3, "close debris passes");
    const closeIds = new Set(close.flatMap((seq) => seq.debris.map((item) => item.id)));
    assert.ok(closeIds.size >= 8, "close passes should move most debris kinds");
    assert.ok(split.train.some((seq) => seq.blockades.length > 0));
    assert.ok(split.test.some((seq) => seq.blockades.length > 0));

    for (const seq of SEQUENCES) {
      assert.ok(seq.frames / seq.hz >= 2, seq.id);
      assert.ok(seq.hz >= 1 && seq.hz <= 30);
      assert.ok(SUN[seq.timeOfDay]);
      for (const block of seq.blockades) {
        assert.equal(placementLane(block.x, block.z), block.laneId, seq.id);
        assert.ok(block.id >= 100);
      }
    }
  });

  it("keeps noon brighter than night and scales the fleet with density", () => {
    assert.ok(SUN.noon.keyIntensity > SUN.night.keyIntensity);
    assert.ok(SUN.noon.exposure > SUN.dusk.exposure);
    const sparse = new TrafficSim(7);
    sparse.reset(7, 0.4);
    const dense = new TrafficSim(7);
    dense.reset(7, 1.6);
    assert.ok(dense.cars.length > sparse.cars.length);
    const same = new TrafficSim(7);
    const once = same.cars.length;
    same.reset(7, 1);
    assert.equal(same.cars.length, once);
  });

  it("places a Michigan blockade on that lane's centerline", () => {
    const block = SEQUENCES.find((seq) => seq.id === "s04-noon-block")!.blockades[0]!;
    assert.equal(laneIdAt(block.x, block.z), "mich-nb-1");
    assert.equal(block.kind, "blockade");
    assert.equal(block.type, "barrier");
  });
});
