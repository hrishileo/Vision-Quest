import { SPEC, WHEELBASE, Y } from "@/lib/guide/specs";
import { AIRFRAME } from "@/lib/bom";

export type FitStatus = "pass" | "watch" | "block";

export type FitCheck = {
  id: string;
  status: FitStatus;
  title: string;
  a: string;
  b: string;
  metric: string;
  rule: string;
  action: string;
};

export type BuildStep = {
  id: string;
  n: number;
  title: string;
  body: string;
  parts: string[];
  gate?: string;
};

const mm = (m: number) => Math.round(m * 1000);

const ADJACENT = WHEELBASE / Math.SQRT2;
const PROP_D = SPEC.prop.radius * 2;
const TIP_GAP = ADJACENT - PROP_D;
const BATT = SPEC.battery;
const TRAY = SPEC.print.battTray;
const GEAR_H = SPEC.landing.vertH;
const BATT_BOTTOM = Math.abs(Y.batt) + BATT.y / 2;
const GROUND_CLR = Math.abs(Y.foot) - BATT_BOTTOM;

export const FIT_CHECKS: FitCheck[] = [
  {
    id: "motor-mount",
    status: SPEC.motor.shaftD === 0.005 && SPEC.frame.motorMount === 0.019 ? "pass" : "block",
    title: "Motor bolts to the HV-1 arm plate",
    a: "XRotor 3115",
    b: "HV-1 6061 bulkhead",
    metric: `19 × 19 mm M3  ·  plate 42 mm  ·  M5 shaft`,
    rule: "Custom motor plates are 42 × 42 × 5 mm 6061 with a 19 × 19 M3 pattern and Ø12 through-bore. Same as the 3115 footprint.",
    action: "M3×8 socket + Loctite 243. Do not elongate the carbon.",
  },
  {
    id: "prop-hub",
    status: "pass",
    title: "Prop hub matches the motor shaft",
    a: "HQProp 10×5.5×2",
    b: "3115 M5 shaft",
    metric: "M5 hub  ·  M5 shaft × 16 mm",
    rule: "Same thread as the XRotor bell. CW / CCW pairing on opposite arms.",
    action: "Leave props off until the bench spin. Seat the prop nut on threadlock.",
  },
  {
    id: "prop-clearance",
    status: TIP_GAP > 0.04 ? "pass" : "block",
    title: "Prop disks clear each other on the 650 mm X",
    a: "10-inch props",
    b: "650 mm wheelbase",
    metric: `Adjacent motors ${mm(ADJACENT)} mm  ·  disk ${mm(PROP_D)} mm  ·  tip gap ${mm(TIP_GAP)} mm`,
    rule: "Need > 40 mm tip-to-tip. 15-inch ARF props also fit; 17-inch does not.",
    action: "Fold an arm and dry-spin by hand. If a tip kisses carbon, you have the wrong size.",
  },
  {
    id: "esc-current",
    status: "pass",
    title: "ESC current vs 6S / 10-inch load",
    a: "XRotor 45A 4-in-1",
    b: "3115 900 Kv · 10×5.5",
    metric: "45 A/motor  ·  hover ~4.5 A/motor  ·  pack 18 A",
    rule: "6S input on the ESC. Headroom is > 2× hover. Burst stays under 45 A on two-blade 10-inch.",
    action: "Do not step to tri-blades without a 60–80 A 4-in-1.",
  },
  {
    id: "esc-fc",
    status: "watch",
    title: "4-in-1 signal into Pixhawk 6C Mini",
    a: "Hobbywing 45A 4-in-1",
    b: "6C Mini FMU PWM OUT",
    metric: "DShot600  ·  FMU CH1–4  ·  custom 4-signal harness",
    rule: "The 4-in-1 is not a 30.5 mm Pixhawk stack mate. It sits on the bottom plate. MAIN OUT is IO PWM — DShot only lives on FMU PWM OUT. 6C Mini has no POWER2.",
    action: "Solder S1–S4 + GND from the ESC header to FMU PWM OUT pins 1–4. Power the FC from PM02 on POWER1, not from the ESC 5 V.",
  },
  {
    id: "fc-plate",
    status: "pass",
    title: "Pixhawk Mini fits the 160 mm sandwich",
    a: "Pixhawk 6C Mini 54.3 × 39 mm",
    b: "X650 160 × 160 × 2 mm plates",
    metric: "30.5 mm grommet pattern  ·  plate 160 mm",
    rule: "Mini is not a 30.5 cube FC but the grommet plate is. HV-1-CAM-01 also uses that 30.5 square.",
    action: "Sit the FC on the silicone grommets. Do not hard-bolt it to carbon.",
  },
  {
    id: "pack-voltage",
    status: "pass",
    title: "One 6S rail feeds every power input",
    a: "Tattu 6S 6000",
    b: "ESC · PM02 · UBECs",
    metric: "22.2 V nominal  ·  ESC 3–6S  ·  PM02 6S  ·  UBEC 3–6S",
    rule: "Do not tap 6S into the gimbal. Do not feed Orin from the 4-in-1 BEC.",
    action: "XT90 into the 4-in-1. PM02 from the same rail. 19 V buck and 12 V UBEC off that rail, fused.",
  },
  {
    id: "xt90",
    status: "watch",
    title: "Battery plug vs 4-in-1 pad",
    a: "Tattu XT90",
    b: "XRotor 4-in-1 (often XT60)",
    metric: "Pack XT90  ·  ESC typically XT60",
    rule: "The catalog power path is XT90. Many 45 A 4-in-1s ship XT60.",
    action: "Before you order, confirm the ESC pad. If XT60, solder an XT90 pigtail — do not fly an XT60/XT90 gender-bender under 18 A continuous.",
  },
  {
    id: "batt-tray",
    status: BATT.x <= TRAY.x + 0.002 && BATT.z <= TRAY.z + 0.01 ? "pass" : "watch",
    title: "Pack sits in the printed tray",
    a: `Tattu ${mm(BATT.x)} × ${mm(BATT.z)} × ${mm(BATT.y)} mm`,
    b: `HV-1-BATT-06  ${mm(TRAY.x)} × ${mm(TRAY.z)} × ${mm(TRAY.y)} mm`,
    metric: `Length slack ${mm(TRAY.x - BATT.x)} mm  ·  width slack ${mm(TRAY.z - BATT.z)} mm`,
    rule: "X650 battery plate is 120 × 128 mm — shorter than the 148 mm pack. The print extends it. Strap slots are 20 mm.",
    action: "Print the tray. Dry-fit the pack before soldering leads. Nose the XT90 toward the ESC.",
  },
  {
    id: "batt-ground",
    status: GROUND_CLR > 0.02 ? "pass" : "block",
    title: "Pack clears the ground on the landing gear",
    a: "6S 6000 under the plate",
    b: "16 mm landing tubes",
    metric: `Gear ${mm(GEAR_H)} mm  ·  pack hangs ~${mm(BATT_BOTTOM)} mm  ·  ground ${mm(GROUND_CLR)} mm`,
    rule: "Need > 20 mm so a flattened TPU foot still does not grind the pack.",
    action: "If a vendor pack is taller than 59 mm, do not fly it on this gear.",
  },
  {
    id: "orin-carrier",
    status: "watch",
    title: "Fly the module, not the desktop kit",
    a: "Orin Nano 8 GB Super Dev Kit",
    b: "Seeed / Waveshare J401-class carrier",
    metric: "Dev Kit ~250 g with fan  ·  module + carrier ~130 g",
    rule: "The Super kit is the supported JetPack box. The airframe tray (90 × 70 mm) is sized for the compact carrier, not the Dev Kit PCB.",
    action: "Pull the SO-DIMM module off the Dev Kit and seat it on the compact carrier. Bolt that into HV-1-ORIN-02. Leave the Dev Kit on the bench.",
  },
  {
    id: "orin-power",
    status: "pass",
    title: "19 V buck matches the Orin barrel",
    a: "6–12S → 19 V 5 A",
    b: "Orin carrier 9–19 V",
    metric: "19 V 5 A  ·  Orin ~10–15 W detect",
    rule: "Carrier input is 9–19 V. Super Dev Kit barrel is 19 V. A sagging 6S at 19.8 V empty still feeds the buck.",
    action: "Do not feed 6S raw into the carrier. Fuse the buck. Keep the barrel strain-relieved.",
  },
  {
    id: "ssd",
    status: "pass",
    title: "2230 NVMe fits the carrier slot",
    a: "WD SN530 / SN740 2230",
    b: "J401-class M.2",
    metric: "M.2 2230 NVMe  ·  256 GB",
    rule: "Nano has no useful eMMC. 2280 cards will not fit the compact carrier.",
    action: "Seat the 2230 before the tray goes on the rails — the slot faces the belly.",
  },
  {
    id: "csi-pin",
    status: "watch",
    title: "CSI ribbon pin count",
    a: "Arducam AR0234 + 15-pin flex",
    b: "Orin CSI (22-pin on NVIDIA kit)",
    metric: "BOM cable 15-pin  ·  NVIDIA Orin Nano J20/J219 = 22-pin 0.5 mm",
    rule: "A 15-pin Pi ribbon will not latch in the official Dev Kit CSI. Compact carriers are mixed: some 15-pin, some 22-pin.",
    action: "Read the carrier silkscreen before you buy the camera. If it is 22-pin, order Arducam 15-to-22 FPC, not a Pi ribbon. Confirm B0429 is the Jetson SKU, not the Pi SKU.",
  },
  {
    id: "camera-mode",
    status: "watch",
    title: "Gimbal and rigid camera_link cannot both be the FSD camera",
    a: "HV-1-CAM-01 rigid mount",
    b: "Tarot T-2D + HV-1-GIM-03",
    metric: "VIO wants a fixed camera_link  ·  T-2D is a moving frame",
    rule: "A 0.5° gimbal flex is 13 cm of lock error at 15 m. FSD chase uses the rigid plate. The gimbal is a filming option, not the detector mount.",
    action: "Build one: rigid AR0234 on HV-1-CAM-01 for lock, or T-2D for video. Do not hang the detector on the gimbal and expect PX4 + Orin to share an IMU.",
  },
  {
    id: "gimbal-fit",
    status: "watch",
    title: "T-2D is a GoPro cage — CSI needs the adapter",
    a: "AR0234 38 × 38 mm · ~25 g",
    b: "T-2D Hero3 cage · ~75 g / 160 g gimbal",
    metric: "Adapter HV-1-GIM-03 32 × 32 × 3  ·  optical bore Ø16",
    rule: "T-2D is balanced for Hero3. A 25 g CSI board will sit light and need a PID retune. Power is 7.4–14.8 V — 12 V UBEC, never 6S.",
    action: "Print the adapter, keep the lens on the pitch pivot, feed 12 V from the UBEC. If you chose rigid FSD, skip the gimbal on the first article.",
  },
  {
    id: "gps-mast",
    status: "pass",
    title: "F9P helical on the X650 GPS mast",
    a: "H-RTK NEO-F9P helical",
    b: "X650 GPS mount + HV-1-GPS-04 TPU",
    metric: "Ø27.5 × 59 helix  ·  80 mm mast  ·  UART GPS port",
    rule: "Same Holybro GPS port as the 6C Mini. RM3100 is on that mast. Collar kills the 10-inch vibe.",
    action: "If the SKU is the classic IST8310 helical, add a standalone RM3100. Keep the mast 80 mm above the ESC.",
  },
  {
    id: "elrs",
    status: "pass",
    title: "ELRS 900 into TELEM2 as CRSF",
    a: "ELRS 900 Nano RX",
    b: "6C Mini TELEM2",
    metric: "CRSF  ·  5 V from UBEC  ·  not RC IN SBUS",
    rule: "PX4 wants CRSF on a UART. RC IN is PPM/SBUS. 900 MHz dipole clips onto the 20 mm arm.",
    action: "TELEM2, 400 kbaud, RC_INPUT from CRSF. Print two HV-1-ANT-05 clips, opposite polarisation.",
  },
  {
    id: "tx-module",
    status: "watch",
    title: "900 MHz TX module vs TX16S bay",
    a: "Ranger Micro 900",
    b: "TX16S MKII JR bay",
    metric: "Ranger Micro = nano bay  ·  TX16S = full-size JR",
    rule: "The BOM lists Ranger Micro or ES900TX. Micro does not seat in a JR bay. ES900TX and Ranger (non-Micro) do.",
    action: "Order HappyModel ES900TX or RadioMaster Ranger 900 (JR). Do not order Ranger Micro for a TX16S.",
  },
  {
    id: "orin-tray",
    status: "pass",
    title: "Orin tray bolts to the payload rails",
    a: "HV-1-ORIN-02 90 × 70 mm",
    b: "X650 10 mm rails · 120 × 128 platform",
    metric: "M3 on 70 mm square  ·  M2.5 bosses 80 × 58",
    rule: "Platform board already has Jetson-class holes. Tray is smaller than the 120 × 128 plate.",
    action: "Tap the M2.5 bosses. Keep the 2230 slot facing the belly so you can swap the drive.",
  },
  {
    id: "auw",
    status: "watch",
    title: "First-article mass vs 1.85 kg target",
    a: AIRFRAME.auw,
    b: "Orin + 6S 6000 + gimbal",
    metric: "Target 1.85 kg  ·  expected 2.3–2.8 kg",
    rule: "T-2D is ~160 g. 6S 6000 is ~0.7 kg. Orin stack is ~130 g. The X650 still flies it; endurance drops.",
    action: "Leave the gimbal off the first hover. Log AUW. Do not chase the 14 min number until the detector stack is on a compact carrier.",
  },
];

export const BUILD_STEPS: BuildStep[] = [
  {
    id: "print",
    n: 1,
    title: "Print the fittings first",
    body: "PETG: CAM-01, ORIN-02, GIM-03, BATT-06, ANT-05. TPU: GPS-04 collar, CSI-07 clamp, LG-08 feet. Two of CAM-01 — the ears crack in a tip-over.",
    parts: [
      "print-cam-mount",
      "print-orin-tray",
      "print-gimbal-adapter",
      "print-batt-tray",
      "print-ant-clip",
      "print-gps-collar",
      "print-csi-clamp",
      "print-landing-feet",
    ],
  },
  {
    id: "frame",
    n: 2,
    title: "Dry-assemble the X650",
    body: "Tubes in the folding joints, 160 mm plates, 10 mm rails, landing gear with TPU feet. Fold each arm — the hinge must clear the 10-inch disk.",
    parts: ["frame", "hardware", "print-landing-feet"],
  },
  {
    id: "motors",
    n: 3,
    title: "Bolt 3115s on 19 × 19",
    body: "M3 × 8, blue threadlock, bells facing up. Confirm 16–25 mm slots take 19 × 19 without filing.",
    parts: ["motors", "hardware"],
    gate: "motor-mount",
  },
  {
    id: "esc",
    n: 4,
    title: "ESC on the bottom plate, XT90 in",
    body: "4-in-1 between the plates. Short 12 AWG to XT90. Confirm the ESC pad — solder an XT90 pigtail if it is XT60. No props yet.",
    parts: ["escs", "xt90", "battery"],
    gate: "xt90",
  },
  {
    id: "fc",
    n: 5,
    title: "Pixhawk on grommets, PM02 on POWER1",
    body: "Silicone grommets. PM02 from the 6S rail into POWER1. Do not steal 5 V from the ESC.",
    parts: ["fc", "dampen", "battery"],
    gate: "fc-plate",
  },
  {
    id: "harness",
    n: 6,
    title: "DShot harness: ESC S1–S4 → FMU PWM OUT",
    body: "Not MAIN OUT. Signal + GND only. Set PX4 DShot600 on FMU 1–4, quad-X motor order. Bench-spin without props.",
    parts: ["escs", "fc"],
    gate: "esc-fc",
  },
  {
    id: "gps",
    n: 7,
    title: "GPS mast + TPU collar",
    body: "80 mm above the ESC. UART into the GPS port. Mag on the mast. Confirm RM3100 vs IST8310 SKU.",
    parts: ["gps", "mag", "print-gps-collar"],
    gate: "gps-mast",
  },
  {
    id: "radio",
    n: 8,
    title: "ELRS 900 on TELEM2, SiK on TELEM1",
    body: "CRSF at 400 k. Dipoles in ANT-05 on the rear 20 mm arms. TX16S gets a JR 900 MHz module, not Ranger Micro.",
    parts: ["rx", "tx", "txmod", "telem", "print-ant-clip"],
    gate: "tx-module",
  },
  {
    id: "pack",
    n: 9,
    title: "Battery tray, CG, ground clearance",
    body: "Strap the 148 mm pack in BATT-06. XT90 toward the ESC. Check ≥ 20 mm to the TPU feet.",
    parts: ["battery", "print-batt-tray"],
    gate: "batt-ground",
  },
  {
    id: "orin",
    n: 10,
    title: "Orin module on the compact carrier",
    body: "SO-DIMM out of the Dev Kit, into J401-class. 2230 NVMe. 19 V buck. Tray on the payload rails. Dev Kit stays on the bench.",
    parts: ["npu", "carrier", "ssd", "bec-orin", "print-orin-tray"],
    gate: "orin-carrier",
  },
  {
    id: "camera",
    n: 11,
    title: "Pick one camera path",
    body: "FSD: AR0234 on HV-1-CAM-01, rigid to the BMI088. Filming: T-2D + GIM-03, 12 V UBEC, retune. Not both on the detector.",
    parts: ["camera", "csi", "print-cam-mount", "gimbal", "print-gimbal-adapter", "bec-5v"],
    gate: "camera-mode",
  },
  {
    id: "csi",
    n: 12,
    title: "CSI ribbon and strain relief",
    body: "Match pin count to the carrier (15 vs 22). 20–30 cm locking flex. TPU CSI-07 at the gimbal or plate edge so the ribbon is not the hinge.",
    parts: ["csi", "print-csi-clamp", "camera", "npu"],
    gate: "csi-pin",
  },
  {
    id: "props",
    n: 13,
    title: "Props on, CG, first hover",
    body: "CW / CCW opposite. Threadlock the M5 nuts. CG on the 160 mm plate. First hover with gimbal off. Log AUW.",
    parts: ["props", "motors"],
    gate: "prop-clearance",
  },
];

export function fitSummary(checks: FitCheck[] = FIT_CHECKS) {
  return {
    pass: checks.filter((c) => c.status === "pass").length,
    watch: checks.filter((c) => c.status === "watch").length,
    block: checks.filter((c) => c.status === "block").length,
    total: checks.length,
  };
}

export const FIT_SUMMARY = fitSummary();

export function stepReady(step: BuildStep, owned: string[]) {
  if (step.parts.length === 0) return true;
  return step.parts.every((id) => owned.includes(id));
}
