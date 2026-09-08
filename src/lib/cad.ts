export type CadPrim =
  | { t: "rect"; x: number; y: number; w: number; h: number }
  | { t: "circle"; x: number; y: number; r: number; hole?: boolean }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; style?: "object" | "hidden" | "center" }
  | { t: "poly"; pts: [number, number][]; close?: boolean }
  | { t: "arc"; x: number; y: number; r: number; a0: number; a1: number }
  | { t: "dimH"; y: number; x1: number; x2: number; text: string; offset: number }
  | { t: "dimV"; x: number; y1: number; y2: number; text: string; offset: number };

export type CadView = {
  name: string;
  w: number;
  h: number;
  prims: CadPrim[];
};

export type CadDoc = {
  id: string;
  number: string;
  title: string;
  rev: string;
  scale: string;
  material: string;
  process: string;
  qty: string;
  mass: string;
  finish: string;
  projection: string;
  notes: string[];
  views: CadView[];
};

const M3 = 1.6;
const M2 = 1.1;
const M25 = 1.35;

export const CAD_DOCS: Record<string, CadDoc> = {
  "cam-mount": {
    id: "cam-mount",
    number: "HV-1-CAM-01",
    title: "CAMERA-TO-IMU RIGID MOUNT",
    rev: "A",
    scale: "1:1",
    material: "PETG",
    process: "FDM 0.20 / 6 WALL / 40% GYROID",
    qty: "1",
    mass: "11 g",
    finish: "AS PRINTED · DEBURR HOLES",
    projection: "THIRD ANGLE",
    notes: [
      "4× Ø3.2 THRU ON 30.5 SQ — PIXHAWK MINI PATTERN",
      "4× Ø2.2 THRU — CSI BOARD EARS, 24 SQ",
      "KEEP CAMERA_LINK COAXIAL WITH BMI088 X",
      "DO NOT SUBSTITUTE PLA",
    ],
    views: [
      {
        name: "TOP",
        w: 80,
        h: 36,
        prims: [
          { t: "rect", x: 0, y: 0, w: 80, h: 36 },
          { t: "rect", x: 8, y: 6, w: 28, h: 24 },
          { t: "line", x1: 40, y1: 0, x2: 40, y2: 36, style: "center" },
          { t: "line", x1: 0, y1: 18, x2: 80, y2: 18, style: "center" },
          { t: "circle", x: 24.75, y: 2.75, r: M3, hole: true },
          { t: "circle", x: 55.25, y: 2.75, r: M3, hole: true },
          { t: "circle", x: 24.75, y: 33.25, r: M3, hole: true },
          { t: "circle", x: 55.25, y: 33.25, r: M3, hole: true },
          { t: "circle", x: 10, y: 6, r: M2, hole: true },
          { t: "circle", x: 34, y: 6, r: M2, hole: true },
          { t: "circle", x: 10, y: 30, r: M2, hole: true },
          { t: "circle", x: 34, y: 30, r: M2, hole: true },
          { t: "dimH", y: 36, x1: 0, x2: 80, text: "80", offset: 8 },
          { t: "dimH", y: 36, x1: 24.75, x2: 55.25, text: "30.5", offset: 14 },
          { t: "dimV", x: 0, y1: 0, y2: 36, text: "36", offset: -8 },
          { t: "dimV", x: 0, y1: 2.75, y2: 33.25, text: "30.5", offset: -14 },
        ],
      },
      {
        name: "FRONT",
        w: 80,
        h: 6,
        prims: [
          { t: "rect", x: 0, y: 0, w: 80, h: 6 },
          { t: "rect", x: 8, y: 0, w: 28, h: 3 },
          { t: "line", x1: 24.75, y1: 0, x2: 24.75, y2: 6, style: "hidden" },
          { t: "line", x1: 55.25, y1: 0, x2: 55.25, y2: 6, style: "hidden" },
          { t: "dimH", y: 6, x1: 0, x2: 80, text: "80", offset: 7 },
          { t: "dimV", x: 80, y1: 0, y2: 6, text: "6", offset: 7 },
        ],
      },
      {
        name: "RIGHT",
        w: 36,
        h: 6,
        prims: [
          { t: "rect", x: 0, y: 0, w: 36, h: 6 },
          { t: "line", x1: 2.75, y1: 0, x2: 2.75, y2: 6, style: "hidden" },
          { t: "line", x1: 33.25, y1: 0, x2: 33.25, y2: 6, style: "hidden" },
          { t: "dimH", y: 6, x1: 0, x2: 36, text: "36", offset: 7 },
          { t: "dimV", x: 36, y1: 0, y2: 6, text: "6", offset: 7 },
        ],
      },
    ],
  },
  "orin-tray": {
    id: "orin-tray",
    number: "HV-1-ORIN-02",
    title: "ORIN CARRIER TRAY",
    rev: "A",
    scale: "1:2",
    material: "PETG",
    process: "FDM 0.20 / 5 WALL / 35% GYROID",
    qty: "1",
    mass: "18 g",
    finish: "AS PRINTED · TAP M2.5 BOSSES",
    projection: "THIRD ANGLE",
    notes: [
      "4× M2.5 × 6 BOSSES ON 80 × 58",
      "VENT SLOTS 4 × 48 ALIGNED WITH SoC",
      "BOLTS TO X650 PAYLOAD  —  M3 × 4 ON 70 SQ",
      "KEEP 2230 SLOT CLEAR OF THE BELLY PLATE",
    ],
    views: [
      {
        name: "TOP",
        w: 90,
        h: 70,
        prims: [
          { t: "rect", x: 0, y: 0, w: 90, h: 70 },
          { t: "rect", x: 8, y: 11, w: 48, h: 4 },
          { t: "rect", x: 8, y: 22, w: 48, h: 4 },
          { t: "rect", x: 8, y: 33, w: 48, h: 4 },
          { t: "rect", x: 8, y: 44, w: 48, h: 4 },
          { t: "circle", x: 5, y: 6, r: M25, hole: true },
          { t: "circle", x: 85, y: 6, r: M25, hole: true },
          { t: "circle", x: 5, y: 64, r: M25, hole: true },
          { t: "circle", x: 85, y: 64, r: M25, hole: true },
          { t: "circle", x: 10, y: 10, r: M3, hole: true },
          { t: "circle", x: 80, y: 10, r: M3, hole: true },
          { t: "circle", x: 10, y: 60, r: M3, hole: true },
          { t: "circle", x: 80, y: 60, r: M3, hole: true },
          { t: "line", x1: 45, y1: 0, x2: 45, y2: 70, style: "center" },
          { t: "line", x1: 0, y1: 35, x2: 90, y2: 35, style: "center" },
          { t: "dimH", y: 70, x1: 0, x2: 90, text: "90", offset: 8 },
          { t: "dimH", y: 70, x1: 10, x2: 80, text: "70", offset: 14 },
          { t: "dimV", x: 0, y1: 0, y2: 70, text: "70", offset: -8 },
        ],
      },
      {
        name: "FRONT",
        w: 90,
        h: 8,
        prims: [
          { t: "rect", x: 0, y: 0, w: 90, h: 3 },
          { t: "rect", x: 3, y: 3, w: 4, h: 5 },
          { t: "rect", x: 83, y: 3, w: 4, h: 5 },
          { t: "dimH", y: 8, x1: 0, x2: 90, text: "90", offset: 7 },
          { t: "dimV", x: 90, y1: 0, y2: 8, text: "8", offset: 7 },
        ],
      },
      {
        name: "RIGHT",
        w: 70,
        h: 8,
        prims: [
          { t: "rect", x: 0, y: 0, w: 70, h: 3 },
          { t: "rect", x: 4, y: 3, w: 4, h: 5 },
          { t: "rect", x: 62, y: 3, w: 4, h: 5 },
          { t: "dimH", y: 8, x1: 0, x2: 70, text: "70", offset: 7 },
          { t: "dimV", x: 70, y1: 0, y2: 8, text: "8", offset: 7 },
        ],
      },
    ],
  },
  "gimbal-adapter": {
    id: "gimbal-adapter",
    number: "HV-1-GIM-03",
    title: "CSI GIMBAL ADAPTER",
    rev: "A",
    scale: "2:1",
    material: "PETG",
    process: "FDM 0.12 / 6 WALL / 100% INFILL",
    qty: "1",
    mass: "4 g",
    finish: "REAM Ø16 · CHAMFER 0.3",
    projection: "THIRD ANGLE",
    notes: [
      "OPTICAL AXIS ON PITCH PIVOT ±0.3 mm",
      "4× Ø2.2 ON 20 SQ — CSI BOARD",
      "4× Ø2.5 ON 24 SQ — TAROT T-2D TRAY",
      "PRINT FLAT, NO SUPPORTS",
    ],
    views: [
      {
        name: "TOP",
        w: 32,
        h: 32,
        prims: [
          { t: "rect", x: 0, y: 0, w: 32, h: 32 },
          { t: "circle", x: 16, y: 16, r: 8, hole: true },
          { t: "circle", x: 16, y: 16, r: 9.5 },
          { t: "circle", x: 6, y: 6, r: M2, hole: true },
          { t: "circle", x: 26, y: 6, r: M2, hole: true },
          { t: "circle", x: 6, y: 26, r: M2, hole: true },
          { t: "circle", x: 26, y: 26, r: M2, hole: true },
          { t: "circle", x: 4, y: 4, r: 1.25, hole: true },
          { t: "circle", x: 28, y: 4, r: 1.25, hole: true },
          { t: "circle", x: 4, y: 28, r: 1.25, hole: true },
          { t: "circle", x: 28, y: 28, r: 1.25, hole: true },
          { t: "line", x1: 16, y1: 0, x2: 16, y2: 32, style: "center" },
          { t: "line", x1: 0, y1: 16, x2: 32, y2: 16, style: "center" },
          { t: "dimH", y: 32, x1: 0, x2: 32, text: "32", offset: 7 },
          { t: "dimH", y: 32, x1: 6, x2: 26, text: "20", offset: 13 },
          { t: "dimV", x: 0, y1: 0, y2: 32, text: "32", offset: -7 },
        ],
      },
      {
        name: "FRONT",
        w: 32,
        h: 3,
        prims: [
          { t: "rect", x: 0, y: 0, w: 32, h: 3 },
          { t: "line", x1: 8, y1: 0, x2: 8, y2: 3, style: "hidden" },
          { t: "line", x1: 24, y1: 0, x2: 24, y2: 3, style: "hidden" },
          { t: "dimH", y: 3, x1: 0, x2: 32, text: "32", offset: 6 },
          { t: "dimV", x: 32, y1: 0, y2: 3, text: "3", offset: 6 },
        ],
      },
      {
        name: "RIGHT",
        w: 32,
        h: 3,
        prims: [
          { t: "rect", x: 0, y: 0, w: 32, h: 3 },
          { t: "dimH", y: 3, x1: 0, x2: 32, text: "32", offset: 6 },
          { t: "dimV", x: 32, y1: 0, y2: 3, text: "3", offset: 6 },
        ],
      },
    ],
  },
  "batt-tray": {
    id: "batt-tray",
    number: "HV-1-BATT-06",
    title: "UNDER-PLATE BATTERY TRAY",
    rev: "A",
    scale: "1:2",
    material: "PETG",
    process: "FDM 0.24 / 4 WALL / 30% GYROID",
    qty: "1",
    mass: "22 g",
    finish: "AS PRINTED",
    projection: "THIRD ANGLE",
    notes: [
      "TWO 20 × 3 STRAP SLOTS ON 110 SPACING",
      "XT90 WINDOW 18 × 12 ON NOSE FACE",
      "CG MARK ALIGNED WITH X650 CROSS",
      "DO NOT SUBSTITUTE PLA — BENCH HEAT",
    ],
    views: [
      {
        name: "TOP",
        w: 155,
        h: 50,
        prims: [
          { t: "rect", x: 0, y: 0, w: 155, h: 50 },
          { t: "rect", x: 18, y: 6, w: 20, h: 38 },
          { t: "rect", x: 117, y: 6, w: 20, h: 38 },
          { t: "rect", x: 137, y: 19, w: 18, h: 12 },
          { t: "circle", x: 10, y: 10, r: M3, hole: true },
          { t: "circle", x: 10, y: 40, r: M3, hole: true },
          { t: "circle", x: 145, y: 10, r: M3, hole: true },
          { t: "circle", x: 145, y: 40, r: M3, hole: true },
          { t: "line", x1: 77.5, y1: 0, x2: 77.5, y2: 50, style: "center" },
          { t: "line", x1: 0, y1: 25, x2: 155, y2: 25, style: "center" },
          { t: "dimH", y: 50, x1: 0, x2: 155, text: "155", offset: 8 },
          { t: "dimH", y: 50, x1: 18, x2: 137, text: "119", offset: 14 },
          { t: "dimV", x: 0, y1: 0, y2: 50, text: "50", offset: -8 },
        ],
      },
      {
        name: "FRONT",
        w: 155,
        h: 10,
        prims: [
          { t: "rect", x: 0, y: 0, w: 155, h: 10 },
          { t: "rect", x: 18, y: 3, w: 20, h: 4 },
          { t: "rect", x: 117, y: 3, w: 20, h: 4 },
          { t: "dimH", y: 10, x1: 0, x2: 155, text: "155", offset: 7 },
          { t: "dimV", x: 155, y1: 0, y2: 10, text: "10", offset: 7 },
        ],
      },
      {
        name: "RIGHT",
        w: 50,
        h: 10,
        prims: [
          { t: "rect", x: 0, y: 0, w: 50, h: 10 },
          { t: "rect", x: 19, y: 0, w: 12, h: 8 },
          { t: "dimH", y: 10, x1: 0, x2: 50, text: "50", offset: 7 },
          { t: "dimV", x: 50, y1: 0, y2: 10, text: "10", offset: 7 },
        ],
      },
    ],
  },
  "ant-clip": {
    id: "ant-clip",
    number: "HV-1-ANT-05",
    title: "900 MHz ANTENNA CLIP",
    rev: "A",
    scale: "2:1",
    material: "PETG",
    process: "FDM 0.16 / 4 WALL / 100% INFILL",
    qty: "2",
    mass: "2 g EA",
    finish: "AS PRINTED · SNAP FIT ON Ø20 TUBE",
    projection: "THIRD ANGLE",
    notes: [
      "SNAP ONTO 20 mm CARBON ARM",
      "Ø4 DIPOLE SEAT, 90° FROM ARM AXIS",
      "PRINT TWO — OPPOSITE REAR ARMS",
      "LAYER LINES AROUND THE SNAP, NOT ACROSS",
    ],
    views: [
      {
        name: "FRONT",
        w: 28,
        h: 24,
        prims: [
          { t: "circle", x: 12, y: 12, r: 10 },
          { t: "circle", x: 12, y: 12, r: 10.4 },
          { t: "circle", x: 12, y: 12, r: 10, hole: true },
          { t: "line", x1: 20.5, y1: 4, x2: 26, y2: 1 },
          { t: "line", x1: 20.5, y1: 20, x2: 26, y2: 23 },
          { t: "line", x1: 26, y1: 1, x2: 26, y2: 23 },
          { t: "circle", x: 24, y: 12, r: 2, hole: true },
          { t: "line", x1: 12, y1: 0, x2: 12, y2: 24, style: "center" },
          { t: "line", x1: 0, y1: 12, x2: 28, y2: 12, style: "center" },
          { t: "dimH", y: 24, x1: 2, x2: 22, text: "Ø20", offset: 7 },
          { t: "dimV", x: 28, y1: 10, y2: 14, text: "Ø4", offset: 8 },
        ],
      },
      {
        name: "TOP",
        w: 28,
        h: 12,
        prims: [
          { t: "rect", x: 2, y: 1, w: 20, h: 10 },
          { t: "rect", x: 22, y: 4, w: 6, h: 4 },
          { t: "dimH", y: 12, x1: 2, x2: 22, text: "20", offset: 6 },
          { t: "dimV", x: 2, y1: 1, y2: 11, text: "10", offset: -6 },
        ],
      },
      {
        name: "RIGHT",
        w: 12,
        h: 24,
        prims: [
          { t: "rect", x: 1, y: 1, w: 10, h: 22 },
          { t: "circle", x: 6, y: 12, r: 2, hole: true },
          { t: "dimV", x: 12, y1: 1, y2: 23, text: "22", offset: 6 },
        ],
      },
    ],
  },
  "gps-collar": {
    id: "gps-collar",
    number: "HV-1-GPS-04",
    title: "GPS MAST ISOLATION COLLAR",
    rev: "A",
    scale: "2:1",
    material: "TPU 95A",
    process: "FDM 0.16 / 3 WALL / 20% INFILL",
    qty: "1",
    mass: "3 g",
    finish: "AS PRINTED",
    projection: "THIRD ANGLE",
    notes: [
      "PRESS ONTO 8 mm MAST BEFORE THE PUCK",
      "SITS BETWEEN F9P AND CARBON PLATE",
      "KILLS 10-INCH VIBRATION INTO RM3100",
    ],
    views: [
      {
        name: "TOP",
        w: 18,
        h: 18,
        prims: [
          { t: "circle", x: 9, y: 9, r: 9 },
          { t: "circle", x: 9, y: 9, r: 4, hole: true },
          { t: "line", x1: 9, y1: 0, x2: 9, y2: 18, style: "center" },
          { t: "line", x1: 0, y1: 9, x2: 18, y2: 9, style: "center" },
          { t: "dimH", y: 18, x1: 0, x2: 18, text: "Ø18", offset: 7 },
          { t: "dimH", y: 18, x1: 5, x2: 13, text: "Ø8", offset: 13 },
        ],
      },
      {
        name: "FRONT",
        w: 18,
        h: 12,
        prims: [
          { t: "rect", x: 0, y: 0, w: 18, h: 12 },
          { t: "line", x1: 5, y1: 0, x2: 5, y2: 12, style: "hidden" },
          { t: "line", x1: 13, y1: 0, x2: 13, y2: 12, style: "hidden" },
          { t: "dimH", y: 12, x1: 0, x2: 18, text: "Ø18", offset: 6 },
          { t: "dimV", x: 18, y1: 0, y2: 12, text: "12", offset: 6 },
        ],
      },
      {
        name: "RIGHT",
        w: 18,
        h: 12,
        prims: [
          { t: "rect", x: 0, y: 0, w: 18, h: 12 },
          { t: "dimV", x: 18, y1: 0, y2: 12, text: "12", offset: 6 },
        ],
      },
    ],
  },
  "csi-clamp": {
    id: "csi-clamp",
    number: "HV-1-CSI-07",
    title: "CSI STRAIN RELIEF",
    rev: "A",
    scale: "4:1",
    material: "TPU 95A",
    process: "FDM 0.12 / 3 WALL / 100% INFILL",
    qty: "1",
    mass: "1 g",
    finish: "AS PRINTED",
    projection: "THIRD ANGLE",
    notes: [
      "CLIPS ON GIMBAL YAW HORN",
      "RIBBON PASSES 1 mm SLOT",
      "TAKES THE BEND, NOT THE CONNECTOR",
    ],
    views: [
      {
        name: "FRONT",
        w: 12,
        h: 8,
        prims: [
          { t: "rect", x: 0, y: 0, w: 12, h: 8 },
          { t: "rect", x: 2, y: 3, w: 8, h: 1.2 },
          { t: "dimH", y: 8, x1: 0, x2: 12, text: "12", offset: 5 },
          { t: "dimV", x: 0, y1: 0, y2: 8, text: "8", offset: -5 },
        ],
      },
      {
        name: "TOP",
        w: 12,
        h: 6,
        prims: [
          { t: "rect", x: 0, y: 0, w: 12, h: 6 },
          { t: "rect", x: 2, y: 2.4, w: 8, h: 1.2 },
          { t: "dimH", y: 6, x1: 0, x2: 12, text: "12", offset: 5 },
          { t: "dimV", x: 12, y1: 0, y2: 6, text: "6", offset: 5 },
        ],
      },
      {
        name: "RIGHT",
        w: 6,
        h: 8,
        prims: [
          { t: "rect", x: 0, y: 0, w: 6, h: 8 },
          { t: "rect", x: 2.4, y: 3, w: 1.2, h: 2 },
          { t: "dimV", x: 6, y1: 0, y2: 8, text: "8", offset: 5 },
        ],
      },
    ],
  },
  "landing-foot": {
    id: "landing-foot",
    number: "HV-1-LG-08",
    title: "TPU LANDING FOOT",
    rev: "A",
    scale: "2:1",
    material: "TPU 95A",
    process: "FDM 0.20 / 3 WALL / 15% INFILL",
    qty: "4",
    mass: "4 g EA",
    finish: "AS PRINTED · PAD DOWN",
    projection: "THIRD ANGLE",
    notes: [
      "PRESSES ONTO X650 TUBE END Ø20",
      "12 mm STACK TAKES THE LAST 10 cm",
      "PRINT FOUR, PAD ON THE BED",
    ],
    views: [
      {
        name: "TOP",
        w: 22,
        h: 22,
        prims: [
          { t: "rect", x: 0, y: 0, w: 22, h: 22 },
          { t: "circle", x: 11, y: 11, r: 10 },
          { t: "circle", x: 11, y: 11, r: 10, hole: true },
          { t: "line", x1: 11, y1: 0, x2: 11, y2: 22, style: "center" },
          { t: "line", x1: 0, y1: 11, x2: 22, y2: 11, style: "center" },
          { t: "dimH", y: 22, x1: 0, x2: 22, text: "22", offset: 6 },
          { t: "dimH", y: 22, x1: 1, x2: 21, text: "Ø20", offset: 12 },
        ],
      },
      {
        name: "FRONT",
        w: 22,
        h: 12,
        prims: [
          { t: "poly", pts: [[0, 0], [22, 0], [20, 12], [2, 12]], close: true },
          { t: "line", x1: 1, y1: 3, x2: 21, y2: 3, style: "hidden" },
          { t: "dimH", y: 12, x1: 2, x2: 20, text: "18", offset: 6 },
          { t: "dimV", x: 22, y1: 0, y2: 12, text: "12", offset: 6 },
        ],
      },
      {
        name: "RIGHT",
        w: 22,
        h: 12,
        prims: [
          { t: "poly", pts: [[0, 0], [22, 0], [20, 12], [2, 12]], close: true },
          { t: "dimV", x: 22, y1: 0, y2: 12, text: "12", offset: 6 },
        ],
      },
    ],
  },
};

export function cadFor(id: string | undefined) {
  if (!id) return undefined;
  return CAD_DOCS[id];
}
