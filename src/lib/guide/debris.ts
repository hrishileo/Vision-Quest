/** Curb and sidewalk debris on Mag Mile — off travel lanes so traffic stays legal. */

export const SCAN_PERIOD = 10;
export const SCAN_RANGE = 48;
export const SCAN_PULSE = 1.35;

export type DebrisType =
  | "tire"
  | "crate"
  | "barrier"
  | "cone"
  | "branch"
  | "rubble"
  | "pallet"
  | "bag";

export type DebrisKind = "debris" | "blockade";
export type DebrisOrigin = "manmade" | "natural";

export type DebrisDef = {
  id: number;
  type: DebrisType;
  kind: DebrisKind;
  origin: DebrisOrigin;
  label: string;
  x: number;
  z: number;
  yaw: number;
};

export type ScanContact = {
  id: string;
  cls: "vehicle" | "building" | "debris";
  type: string;
  kind?: DebrisKind;
  origin?: DebrisOrigin;
  label: string;
  range: number;
  anomaly: boolean;
  novel: boolean;
};

export type ScanSnapshot = {
  cycle: number;
  period: number;
  age: number;
  nextIn: number;
  sweeping: boolean;
  rangeM: number;
  contacts: number;
  vehicles: number;
  buildings: number;
  debris: number;
  blockades: number;
  anomalies: number;
  novel: number;
  learned: number;
  hits: ScanContact[];
};

export const DEBRIS: DebrisDef[] = [
  { id: 0, type: "tire", kind: "debris", origin: "manmade", label: "Discarded tire", x: 10.6, z: 22, yaw: 0.4 },
  { id: 1, type: "crate", kind: "debris", origin: "manmade", label: "Wood crate", x: -14.5, z: 26, yaw: 0.25 },
  { id: 2, type: "barrier", kind: "blockade", origin: "manmade", label: "Jersey barrier", x: 14.4, z: -20, yaw: 0.02 },
  { id: 3, type: "cone", kind: "debris", origin: "manmade", label: "Fallen cone", x: -10.5, z: -24, yaw: 1.15 },
  { id: 4, type: "branch", kind: "debris", origin: "natural", label: "Fallen limb", x: 14.8, z: 54, yaw: 0.65 },
  { id: 5, type: "rubble", kind: "debris", origin: "manmade", label: "Concrete rubble", x: -14.6, z: -54, yaw: 0.12 },
  { id: 6, type: "pallet", kind: "debris", origin: "manmade", label: "Wood pallet", x: 15.0, z: -62, yaw: 0.18 },
  { id: 7, type: "bag", kind: "debris", origin: "manmade", label: "Refuse bags", x: -14.3, z: 56, yaw: 0.3 },
  { id: 8, type: "barrier", kind: "blockade", origin: "manmade", label: "Work-zone barrier", x: -14.8, z: -18, yaw: Math.PI / 2 },
  { id: 9, type: "branch", kind: "blockade", origin: "natural", label: "Downed limb", x: 14.5, z: 16, yaw: -0.5 },
];

export const DEBRIS_TYPE_LABEL: Record<DebrisType, string> = {
  tire: "tire",
  crate: "wood crate",
  barrier: "jersey barrier",
  cone: "traffic cone",
  branch: "fallen limb",
  rubble: "concrete rubble",
  pallet: "wood pallet",
  bag: "refuse bag",
};

export function emptyScan(): ScanSnapshot {
  return {
    cycle: 0,
    period: SCAN_PERIOD,
    age: 0,
    nextIn: SCAN_PERIOD,
    sweeping: false,
    rangeM: SCAN_RANGE,
    contacts: 0,
    vehicles: 0,
    buildings: 0,
    debris: 0,
    blockades: 0,
    anomalies: 0,
    novel: 0,
    learned: 0,
    hits: [],
  };
}
