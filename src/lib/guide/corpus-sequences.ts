import type { CorpusFrame } from "./corpus.ts";
import { laneById, laneIdAt, lanePose } from "./city.ts";
import type { DebrisKind, DebrisType } from "./debris.ts";

/** Appearance presets the headless recorder applies to the pursuit sun. */
export const TIME_OF_DAY = ["dawn", "noon", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIME_OF_DAY)[number];

export type SunPreset = {
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemi: number;
  hemiGround: number;
  hemiIntensity: number;
  key: number;
  keyIntensity: number;
  keyPosition: [number, number, number];
  rim: number;
  exposure: number;
  env: number;
};

export const SUN: Record<TimeOfDay, SunPreset> = {
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

export type DebrisPlacement = {
  id: number;
  x: number;
  z: number;
  yaw?: number;
};

export type BlockadePlacement = {
  id: number;
  type: DebrisType;
  kind: DebrisKind;
  x: number;
  z: number;
  yaw: number;
  laneId: string;
  s0: number;
  s1: number;
};

export type SequenceSpec = {
  id: string;
  split: "train" | "val" | "test";
  seed: number;
  /** Multiplier on the default per-lane counts. 1 is the pursuit fleet. */
  density: number;
  timeOfDay: TimeOfDay;
  frames: number;
  hz: number;
  warmupS: number;
  altitude: number;
  x: number;
  z: number;
  lookX: number;
  lookZ: number;
  pitch: number;
  roll: number;
  driftX: number;
  driftZ: number;
  lookDriftX: number;
  lookDriftZ: number;
  debris: DebrisPlacement[];
  blockades: BlockadePlacement[];
};

export type RecordedSequence = {
  id: string;
  frames: CorpusFrame[];
  /** PNG bytes, base64, one per frame. */
  pngs: string[];
};

function onLane(laneId: string, s: number): { x: number; z: number } {
  const lane = laneById(laneId);
  if (!lane) throw new Error(`unknown lane ${laneId}`);
  const pose = lanePose(lane, s);
  return { x: pose.x, z: pose.z };
}

function barrier(laneId: string, s: number, id: number, span = 12): BlockadePlacement {
  const at = onLane(laneId, s);
  return {
    id,
    type: "barrier",
    kind: "blockade",
    x: at.x,
    z: at.z,
    yaw: Math.PI / 2,
    laneId,
    s0: s,
    s1: s + span,
  };
}

const CLIP = { frames: 12, hz: 5 } as const;

/**
 * Clips split by sequence id: every frame of a clip stays in one of train,
 * val, or test. Time of day, density, debris, and the drone path change
 * between clips. The close passes sit a few metres above a cluster of
 * different debris kinds so those boxes are large enough to train.
 */
export const SEQUENCES: readonly SequenceSpec[] = [
  {
    id: "s00-noon-north",
    split: "train",
    seed: 11,
    density: 0.45,
    timeOfDay: "noon",
    ...CLIP,
    warmupS: 6,
    altitude: 8,
    x: 4,
    z: 36,
    lookX: 5.5,
    lookZ: 4,
    pitch: -0.04,
    roll: 0.03,
    driftX: 0.3,
    driftZ: -1.4,
    lookDriftX: 0.2,
    lookDriftZ: -1.4,
    debris: [{ id: 0, ...onLane("mich-nb-2", 55), yaw: 0.4 }],
    blockades: [],
  },
  {
    id: "s01-dawn-south",
    split: "train",
    seed: 23,
    density: 1,
    timeOfDay: "dawn",
    ...CLIP,
    warmupS: 8,
    altitude: 6.5,
    x: -3,
    z: -28,
    lookX: -2,
    lookZ: 8,
    pitch: 0.02,
    roll: -0.04,
    driftX: -0.2,
    driftZ: 1.1,
    lookDriftX: 0,
    lookDriftZ: 1.1,
    debris: [{ id: 3, x: -16, z: -24, yaw: 0.8 }],
    blockades: [],
  },
  {
    id: "s02-dusk-east",
    split: "train",
    seed: 37,
    density: 1.45,
    timeOfDay: "dusk",
    ...CLIP,
    warmupS: 42,
    altitude: 11,
    x: -32,
    z: 3,
    lookX: 8,
    lookZ: 2.4,
    pitch: -0.02,
    roll: 0.06,
    driftX: 1.6,
    driftZ: 0.15,
    lookDriftX: 1.6,
    lookDriftZ: 0.1,
    debris: [{ id: 1, ...onLane("chi-eb-1", 96), yaw: 0.2 }],
    blockades: [],
  },
  {
    id: "s03-night-low",
    split: "train",
    seed: 41,
    density: 0.7,
    timeOfDay: "night",
    ...CLIP,
    warmupS: 5,
    altitude: 5,
    x: 6,
    z: 22,
    lookX: 5.5,
    lookZ: 6,
    pitch: 0.05,
    roll: -0.02,
    driftX: 0.15,
    driftZ: -0.8,
    lookDriftX: 0.1,
    lookDriftZ: -0.8,
    debris: [{ id: 6, x: 18, z: -40, yaw: 0.3 }],
    blockades: [],
  },
  {
    id: "s04-noon-block",
    split: "train",
    seed: 53,
    density: 1.15,
    timeOfDay: "noon",
    ...CLIP,
    warmupS: 10,
    altitude: 9,
    x: 7,
    z: 40,
    lookX: 5.5,
    lookZ: 2,
    pitch: -0.06,
    roll: 0,
    driftX: -0.25,
    driftZ: -1.2,
    lookDriftX: -0.1,
    lookDriftZ: -1.2,
    debris: [],
    blockades: [barrier("mich-nb-1", 72, 100)],
  },
  {
    id: "s05-dawn-high",
    split: "train",
    seed: 67,
    density: 0.35,
    timeOfDay: "dawn",
    ...CLIP,
    warmupS: 4,
    altitude: 14,
    x: 2,
    z: 42,
    lookX: 4,
    lookZ: 0,
    pitch: -0.08,
    roll: 0.05,
    driftX: 0.6,
    driftZ: -0.5,
    lookDriftX: 0.4,
    lookDriftZ: -0.5,
    debris: [{ id: 4, ...onLane("mich-sb-0", 48), yaw: 1.1 }],
    blockades: [],
  },
  {
    id: "s06-dusk-west",
    split: "train",
    seed: 71,
    density: 0.85,
    timeOfDay: "dusk",
    ...CLIP,
    warmupS: 44,
    altitude: 7,
    x: 28,
    z: -1,
    lookX: -6,
    lookZ: -2.4,
    pitch: 0.03,
    roll: -0.05,
    driftX: -1.3,
    driftZ: 0.2,
    lookDriftX: -1.3,
    lookDriftZ: 0.15,
    debris: [{ id: 7, ...onLane("chi-wb-1", 70), yaw: 0.4 }],
    blockades: [],
  },
  {
    id: "s07-night-dense",
    split: "train",
    seed: 83,
    density: 1.55,
    timeOfDay: "night",
    ...CLIP,
    warmupS: 12,
    altitude: 10,
    x: -1,
    z: -22,
    lookX: -2,
    lookZ: 14,
    pitch: -0.03,
    roll: 0.04,
    driftX: 0.4,
    driftZ: 1.3,
    lookDriftX: 0.2,
    lookDriftZ: 1.3,
    debris: [
      { id: 2, x: 16, z: 8, yaw: 0.1 },
      { id: 5, ...onLane("mich-sb-2", 60), yaw: 0.5 },
    ],
    blockades: [],
  },
  {
    id: "s08-noon-val",
    split: "val",
    seed: 97,
    density: 1,
    timeOfDay: "noon",
    ...CLIP,
    warmupS: 7,
    altitude: 8.5,
    x: 3,
    z: 32,
    lookX: 6,
    lookZ: 2,
    pitch: -0.02,
    roll: -0.03,
    driftX: 0.5,
    driftZ: -1,
    lookDriftX: 0.3,
    lookDriftZ: -1,
    debris: [{ id: 9, ...onLane("mich-nb-0", 50), yaw: -0.4 }],
    blockades: [],
  },
  {
    id: "s09-dusk-val",
    split: "val",
    seed: 101,
    density: 0.55,
    timeOfDay: "dusk",
    ...CLIP,
    warmupS: 40,
    altitude: 12,
    x: -26,
    z: 6,
    lookX: 10,
    lookZ: 5.8,
    pitch: 0.01,
    roll: 0.07,
    driftX: 1.2,
    driftZ: -0.2,
    lookDriftX: 1.2,
    lookDriftZ: -0.15,
    debris: [],
    blockades: [barrier("chi-eb-0", 100, 110, 8)],
  },
  {
    id: "s10-dawn-test",
    split: "test",
    seed: 113,
    density: 1.2,
    timeOfDay: "dawn",
    ...CLIP,
    warmupS: 9,
    altitude: 7.5,
    x: 5,
    z: 38,
    lookX: 5.5,
    lookZ: 0,
    pitch: -0.05,
    roll: 0.02,
    driftX: -0.35,
    driftZ: -1.5,
    lookDriftX: -0.2,
    lookDriftZ: -1.5,
    debris: [{ id: 8, x: -18, z: 6, yaw: 1.2 }],
    blockades: [barrier("mich-nb-2", 64, 120)],
  },
  {
    id: "s11-night-test",
    split: "test",
    seed: 127,
    density: 0.6,
    timeOfDay: "night",
    ...CLIP,
    warmupS: 43,
    altitude: 9.5,
    x: 1,
    z: -30,
    lookX: -4,
    lookZ: 6,
    pitch: 0.04,
    roll: -0.06,
    driftX: 0.25,
    driftZ: 1.2,
    lookDriftX: 0.15,
    lookDriftZ: 1.2,
    debris: [{ id: 0, ...onLane("mich-sb-1", 40), yaw: 0.6 }],
    blockades: [],
  },
  {
    id: "s12-noon-close",
    split: "train",
    seed: 131,
    density: 0.35,
    timeOfDay: "noon",
    ...CLIP,
    warmupS: 4,
    altitude: 4.0,
    x: 4,
    z: 16,
    lookX: 9,
    lookZ: 20,
    pitch: -0.02,
    roll: 0.02,
    driftX: 0.15,
    driftZ: 0.2,
    lookDriftX: 0.1,
    lookDriftZ: 0.15,
    debris: [
      { id: 0, x: 10.6, z: 22, yaw: 0.4 },
      { id: 1, x: 12.2, z: 18.5, yaw: 0.2 },
      { id: 3, x: 7.4, z: 21, yaw: 1.0 },
      { id: 4, x: 11.2, z: 16.5, yaw: 0.7 },
      { id: 6, x: 8.2, z: 18, yaw: 0.15 },
    ],
    blockades: [barrier("mich-nb-2", 58, 130)],
  },
  {
    id: "s13-dawn-close",
    split: "train",
    seed: 139,
    density: 0.4,
    timeOfDay: "dawn",
    ...CLIP,
    warmupS: 5,
    altitude: 4.6,
    x: -4,
    z: -12,
    lookX: -9,
    lookZ: -20,
    pitch: 0.03,
    roll: -0.03,
    driftX: -0.1,
    driftZ: -0.25,
    lookDriftX: -0.05,
    lookDriftZ: -0.2,
    debris: [
      { id: 5, x: -12.4, z: -22, yaw: 0.2 },
      { id: 7, x: -7.2, z: -18, yaw: 0.5 },
      { id: 2, x: -10.8, z: -16, yaw: 0.1 },
      { id: 9, x: -8.5, z: -21, yaw: -0.4 },
    ],
    blockades: [barrier("mich-sb-2", 56, 131)],
  },
  {
    id: "s14-dusk-close",
    split: "train",
    seed: 149,
    density: 0.45,
    timeOfDay: "dusk",
    ...CLIP,
    warmupS: 6,
    altitude: 4.3,
    x: -10,
    z: 12,
    lookX: 6,
    lookZ: 2.4,
    pitch: 0.01,
    roll: 0.04,
    driftX: 0.4,
    driftZ: -0.1,
    lookDriftX: 0.35,
    lookDriftZ: 0,
    debris: [
      { id: 1, x: 4, z: 4.2, yaw: 0.3 },
      { id: 8, x: -6, z: 6.2, yaw: 1.2 },
      { id: 0, x: 8, z: 1.2, yaw: 0.6 },
      { id: 6, x: -2, z: 7.5, yaw: 0.2 },
    ],
    blockades: [barrier("chi-eb-0", 90, 132, 8)],
  },
  {
    id: "s15-night-close",
    split: "train",
    seed: 157,
    density: 0.3,
    timeOfDay: "night",
    ...CLIP,
    warmupS: 4,
    altitude: 5.0,
    x: 2,
    z: -8,
    lookX: -5.5,
    lookZ: -16,
    pitch: 0.04,
    roll: -0.02,
    driftX: 0.1,
    driftZ: -0.3,
    lookDriftX: 0.05,
    lookDriftZ: -0.25,
    debris: [
      { id: 3, x: -4.2, z: -18, yaw: 0.9 },
      { id: 4, x: -7.5, z: -14, yaw: 0.4 },
      { id: 7, x: -2.2, z: -15, yaw: 0.25 },
      { id: 5, x: -8.8, z: -19, yaw: 0.1 },
      { id: 9, x: -6, z: -12, yaw: -0.3 },
    ],
    blockades: [barrier("mich-sb-1", 62, 133)],
  },
  {
    id: "s16-noon-close-val",
    split: "val",
    seed: 163,
    density: 0.5,
    timeOfDay: "noon",
    ...CLIP,
    warmupS: 5,
    altitude: 4.4,
    x: 12,
    z: 8,
    lookX: 5.5,
    lookZ: 14,
    pitch: -0.03,
    roll: 0.02,
    driftX: -0.2,
    driftZ: 0.2,
    lookDriftX: -0.15,
    lookDriftZ: 0.15,
    debris: [
      { id: 0, x: 6.4, z: 16, yaw: 0.5 },
      { id: 2, x: 3.2, z: 12, yaw: 0.05 },
      { id: 6, x: 8.6, z: 13, yaw: 0.3 },
    ],
    blockades: [barrier("mich-nb-1", 64, 134)],
  },
];

export function sequencesBySplit(sequences: readonly SequenceSpec[] = SEQUENCES): {
  train: SequenceSpec[];
  val: SequenceSpec[];
  test: SequenceSpec[];
} {
  return {
    train: sequences.filter((seq) => seq.split === "train"),
    val: sequences.filter((seq) => seq.split === "val"),
    test: sequences.filter((seq) => seq.split === "test"),
  };
}

/** A moved debris rig or an added blockade should land where the spec says. */
export function placementLane(x: number, z: number): string | null {
  return laneIdAt(x, z);
}
