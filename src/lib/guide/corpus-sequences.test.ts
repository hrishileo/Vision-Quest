import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { laneIdAt } from "./city.ts";
import {
  SEQUENCES,
  SUN,
  clipSun,
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

  it("lights s00–s31 from SUN exactly and keeps the shade light to the parked-bike clips", () => {
    // Recorded values of every preset; a drift here would re-light the round 1 and 2 clips.
    assert.deepEqual(SUN, SUN_BEFORE_ROUND_3);
    const old = SEQUENCES.filter((seq) => Number(seq.id.slice(1, 3)) <= 31);
    assert.equal(old.length, 32);
    for (const seq of old) {
      assert.equal(seq.shade, undefined, seq.id);
      assert.ok(!seq.shadows, seq.id);
      assert.equal(clipSun(seq), SUN[seq.timeOfDay], seq.id);
    }
    const parked = SEQUENCES.filter((seq) => seq.park);
    assert.equal(parked.length, 4);
    for (const seq of parked) {
      const sun = clipSun(seq);
      const base = SUN[seq.timeOfDay];
      assert.ok(seq.shadows && seq.shade, seq.id);
      assert.ok(sun.hemiIntensity < base.hemiIntensity && sun.env < base.env, seq.id);
      assert.ok(sun.keyIntensity > base.keyIntensity, seq.id);
      const [x, y, z] = sun.keyPosition;
      const elev = (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
      assert.ok(elev >= seq.shade!.minElevationDeg - 1e-9, `${seq.id} sun at ${elev.toFixed(1)}°`);
      // The shared preset itself is never mutated.
      assert.notEqual(sun, base);
    }
  });
});

/** `SUN` as it stood on origin/main before round 3 (d58c3d7). */
const SUN_BEFORE_ROUND_3 = {
  dawn: {
    sky: 0xc4a48c,
    fog: 0xb09078,
    fogNear: 40,
    fogFar: 170,
    hemi: 0xffc09a,
    hemiGround: 0x6a5040,
    hemiIntensity: 0.85,
    key: 0xffb070,
    keyIntensity: 2.4,
    keyPosition: [48, 14, 36],
    rim: 0.35,
    exposure: 1.05,
    env: 0.42,
  },
  noon: {
    sky: 0x9eb6cc,
    fog: 0xb7c6d4,
    fogNear: 70,
    fogFar: 220,
    hemi: 0xfff6ea,
    hemiGround: 0xa39886,
    hemiIntensity: 1.45,
    key: 0xfff4e0,
    keyIntensity: 3.5,
    keyPosition: [16, 86, 22],
    rim: 0.45,
    exposure: 1.18,
    env: 0.62,
  },
  dusk: {
    sky: 0x3a2a40,
    fog: 0x2c2434,
    fogNear: 28,
    fogFar: 140,
    hemi: 0xff8866,
    hemiGround: 0x2a2228,
    hemiIntensity: 0.55,
    key: 0xff6633,
    keyIntensity: 1.7,
    keyPosition: [-36, 10, 18],
    rim: 0.22,
    exposure: 0.9,
    env: 0.28,
  },
  night: {
    sky: 0x10141c,
    fog: 0x10141c,
    fogNear: 22,
    fogFar: 110,
    hemi: 0x7a88a8,
    hemiGround: 0x14161c,
    hemiIntensity: 0.42,
    key: 0xc5d0e6,
    keyIntensity: 0.7,
    keyPosition: [12, 28, 8],
    rim: 0.15,
    exposure: 0.95,
    env: 0.18,
  },
};
