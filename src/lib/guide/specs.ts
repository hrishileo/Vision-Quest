/** Real kit dimensions. Values in meters unless noted. Sources: Holybro / Hobbywing / NVIDIA / Tattu / Arducam. */

export const m = (mm: number) => mm * 0.001;

/** Opposite-motor distance on the Holybro X650 (true-X). */
export const WHEELBASE = m(650);
export const ARM = WHEELBASE / 2;

export const SPEC = {
  frame: {
    wheelbase: WHEELBASE,
    plate: m(160),
    plateX: m(152),
    plateZ: m(218),
    plateT: m(2.5),
    armOd: m(20),
    armId: m(16),
    armW: m(24),
    armH: m(10),
    joint: { x: m(42), y: m(16), z: m(36) },
    standoffH: m(38),
    standoffR: m(3),
    railOd: m(10),
    railLen: m(280),
    railSpread: m(78),
    platform: { x: m(96), z: m(110), t: m(2.5) },
    battPlate: { x: m(128), z: m(72), t: m(2.5) },
    motorMount: m(19),
    motorPlate: m(42),
    led: { x: m(18), y: m(4), z: m(8) },
  },
  motor: {
    od: m(37.2),
    h: m(32),
    statorD: m(31),
    statorH: m(15),
    shaftD: m(5),
    shaftL: m(16),
    poles: 14,
  },
  prop: {
    radius: m(254) / 2,
    pitchIn: 5.5,
    thick: m(2.4),
    hubR: m(10),
  },
  esc: { x: m(45.6), y: m(8), z: m(44) },
  fc: { x: m(54.3), y: m(17.5), z: m(39) },
  imu: { x: m(8), y: m(2.2), z: m(8) },
  npu: {
    moduleX: m(69.6),
    moduleZ: m(45),
    moduleY: m(4.5),
    pcbX: m(85),
    pcbZ: m(62),
    pcbY: m(1.6),
  },
  camera: {
    board: m(38),
    boardT: m(1.6),
    barrelL: m(16),
    barrelR: m(8),
    lensR: m(6.5),
  },
  gimbal: {
    yawR: m(28),
    span: m(62),
    height: m(78),
  },
  gps: {
    boardX: m(51.1),
    boardY: m(22.9),
    boardZ: m(35),
    helixD: m(27.5),
    helixH: m(59),
    mastH: m(80),
    mastR: m(4),
  },
  mag: { x: m(8), y: m(2), z: m(8) },
  battery: { x: m(148), y: m(59), z: m(45) },
  rx: { x: m(18), y: m(4), z: m(11) },
  ant: { l: m(90), r: m(1.6) },
  print: {
    camMount: { x: m(80), y: m(6), z: m(36) },
    orinTray: { x: m(90), y: m(8), z: m(70) },
    gimbalAdapter: { xy: m(32), t: m(3), bore: m(16) },
    battTray: { x: m(155), y: m(10), z: m(50) },
    antClip: { tube: m(20), seat: m(4) },
    gpsCollar: { od: m(18), h: m(12), bore: m(8) },
    csi: { x: m(12), y: m(6), z: m(8) },
    foot: { xy: m(22), h: m(12) },
  },
  landing: {
    vertOd: m(16),
    vertH: m(105),
    skidOd: m(10),
    skidL: m(70),
  },
} as const;

/** Vertical stations of the assembled stack (mesh centres). */
export const Y = {
  foot: -0.118,
  batt: -0.046,
  battPlate: -0.012,
  botPlate: 0.0,
  arm: 0.01,
  esc: 0.008,
  fc: 0.026,
  imu: 0.036,
  topPlate: 0.038,
  rail: 0.05,
  platform: 0.058,
  orin: 0.07,
  gpsBoard: 0.15,
  helix: 0.192,
  gimbal: 0.0,
} as const;

export function armXZ(θ: number): [number, number] {
  return [Math.sin(θ) * ARM, Math.cos(θ) * ARM];
}
