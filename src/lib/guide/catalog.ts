import type { PartInfo } from "./types";

export const PARTS: PartInfo[] = [
  {
    id: "frame",
    name: "Carbon airframe",
    group: "Structure",
    summary:
      "HV-1 OSPREY custom carbon chassis. Creo osprey plates, 24 × 10 mm I-beam arms, 6061 folding knuckles, 19 × 19 motor bulkheads, dual Ø10 payload rails. Designed around the kit stack — Pixhawk 6C Mini, Orin tray, Tattu 6S, Tarot T-2D.",
    role: "Keeps motors, camera, and batteries in a rigid, known geometry so the flight controller’s mixing matrix stays valid.",
    fsd: "Vision guidance assumes a fixed camera-to-IMU extrinsics. A flexing frame injects phantom accelerations and ruins lock.",
    specs: [
      { label: "Wheelbase", value: "650 mm true-X" },
      { label: "Plates", value: "152 × 218 × 2.5 mm 3K" },
      { label: "Arms", value: "24 × 10 mm CF I-beam" },
    ],
  },
  {
    id: "motors",
    name: "Brushless outrunners",
    group: "Propulsion",
    summary:
      "Four Hobbywing XRotor 3115 900 Kv. Φ37.2 × 32 mm can, 12N14P, M5 shaft, 19 mm M3 pattern. Stator is 31 × 15 mm.",
    role: "Convert DShot throttle into thrust and yaw torque. Opposite motors share rotation direction so yaw is differential RPM.",
    fsd: "The mixer maps body-rate PID output onto these four thrusts. Tracking a car is just a moving position setpoint into that inner loop.",
    specs: [
      { label: "Size", value: "Φ37.2 × 32 mm" },
      { label: "Kv / poles", value: "900 · 14P" },
      { label: "Peak", value: "5.2 kgf / axis" },
    ],
  },
  {
    id: "props",
    name: "Carbon propellers",
    group: "Propulsion",
    summary:
      "HQProp 10 × 5.5 × 2 carbon. Ø254 mm disk, M5 hub. CW / CCW pairs cancel reaction torque in hover so the airframe does not spin.",
    role: "The only surface that makes force. Tip speed and pitch set the thrust curve the mixer linearises around hover.",
    fsd: "Hard yaw while panning the gimbal is limited by prop inertia. FSD keeps yaw-rate commands inside the linear region.",
    specs: [
      { label: "Diameter", value: "Ø254 mm" },
      { label: "Pitch", value: "5.5 in" },
      { label: "Pairing", value: "CW · CCW · CW · CCW" },
    ],
  },
  {
    id: "escs",
    name: "4-in-1 ESC",
    group: "Propulsion",
    summary:
      "Hobbywing XRotor 45 A 4-in-1, 45.6 × 44 × 8 mm under the Pixhawk. Each MOSFET bridge commutates one 3115 from the 6S rail.",
    role: "Translates digital DShot packets into timed phase currents. Also reports eRPM and current back to the FC.",
    fsd: "Current feedback lets the position controller know when a motor is saturating — the tracker then sheds lateral acceleration instead of spinning out.",
    specs: [
      { label: "Board", value: "45.6 × 44 × 8 mm" },
      { label: "Continuous", value: "45 A / motor" },
      { label: "Protocol", value: "DShot600" },
    ],
  },
  {
    id: "fc",
    name: "Flight controller",
    group: "Avionics",
    summary:
      "Holybro Pixhawk 6C Mini Model A — 54.3 × 39 × 17.5 mm, 42 g. STM32H743, BMI088 + ICM-42688-P, PX4 1.15.",
    role: "Fuses IMU, baro, mag, and GPS; runs rate and angle PIDs; mixes onto four motors. Companion vision never writes motors directly.",
    fsd: "Horizon Vision never writes motors. Orin sends a NED setpoint at 50 Hz. The FC is last authority: if vision drops, attitude still holds.",
    specs: [
      { label: "Envelope", value: "54.3 × 39 × 17.5 mm" },
      { label: "MCU", value: "STM32H743" },
      { label: "Mass", value: "42.4 g" },
    ],
  },
  {
    id: "imu",
    name: "IMU · gyro + accel",
    group: "Avionics",
    summary:
      "Bosch BMI088 on the 6C Mini. Gyro is body-rate truth; accel observes gravity. The printed HV-1-CAM-01 plate is the rigid camera_link.",
    role: "A complementary / EKF attitude estimator integrates gyro and corrects with accel so tilt does not drift.",
    fsd: "Camera timestamps are interpolated on IMU time. Without that, a 20 ms skew at 15 m/s is 30 cm of lock error.",
    specs: [
      { label: "Gyro", value: "±2000 °/s" },
      { label: "Accel", value: "±24 g" },
      { label: "Rate", value: "4 kHz" },
    ],
  },
  {
    id: "npu",
    name: "Jetson Orin Nano",
    group: "Perception",
    summary:
      "Orin Nano 8 GB module (69.6 × 45 mm) on a compact carrier, sitting in the printed 90 × 70 mm tray on the X650 rails. Not the desktop Super kit.",
    role: "Turns CSI frames into a 3D target state (position, velocity, covariance) in the NED frame the FC already uses. UART / Ethernet passenger — it never drives MOSFETs.",
    fsd: "This is the FSD brain: detect vehicles, pick one, keep a Kalman lock, emit a pursuit setpoint. Fail-closed: no packet, no setpoint. Local map is built from tracks, not a point cloud.",
    specs: [
      { label: "Module", value: "69.6 × 45 mm" },
      { label: "Tray", value: "90 × 70 × 8 mm" },
      { label: "Compute", value: "40 TOPS INT8" },
    ],
  },
  {
    id: "camera",
    name: "Vision FSD camera",
    group: "Perception",
    summary:
      "Arducam B0429 AR0234 global shutter, 38 × 38 mm board, M12 barrel. CSI into Orin. Horizon Vision dropped LiDAR — range is pinhole + AGL.",
    role: "The only exteroceptive sensor that sees the vehicle. IMU orients the drone; this camera tells it what it is chasing. camera_link in the Horizon Vision tree.",
    fsd: "Each frame is undistorted on Orin. Detector returns class + box. Box bottom + drone altitude + calibration lift that box into a 3D chase point.",
    specs: [
      { label: "Board", value: "38 × 38 mm" },
      { label: "Shutter", value: "AR0234 global" },
      { label: "HFOV", value: "70° class" },
    ],
  },
  {
    id: "gimbal",
    name: "Two-axis gimbal",
    group: "Perception",
    summary:
      "Tarot T-2D class yaw-pitch, ~60 × 75 × 100 mm, with the printed HV-1-GIM-03 adapter for the 38 mm CSI board instead of a GoPro.",
    role: "Keeps the target near the optical centre. Pixel error is a cheap, high-rate measurement the tracker loves.",
    fsd: "Gimbal PIDs run at 1 kHz on pixel error from the predicted box. The airframe still does the heavy translation; the gimbal does the look.",
    specs: [
      { label: "Envelope", value: "~60 × 75 × 100 mm" },
      { label: "Travel", value: "±110° / −90…+30°" },
      { label: "Adapter", value: "32 × 32 × 3 mm" },
    ],
  },
  {
    id: "gps",
    name: "GNSS + compass mast",
    group: "Navigation",
    summary:
      "Holybro H-RTK F9P helical. Board 51.1 × 35 × 22.9 mm, antenna Ø27.5 × 59 mm, on an 80 mm mast through the printed TPU collar.",
    role: "Absolute position for return-to-home and to pin the EKF when vision is lost. Not fast enough to chase a car by itself.",
    fsd: "Fusion: GNSS for the drone’s own geodetic pose, vision for the car relative to the drone. Subtract — that is the chase vector. No LiDAR in the loop.",
    specs: [
      { label: "Helix", value: "Ø27.5 × 59 mm" },
      { label: "Mast", value: "80 mm" },
      { label: "CEP", value: "1.5 m PVT" },
    ],
  },
  {
    id: "mag",
    name: "Magnetometer",
    group: "Navigation",
    summary:
      "RM3100 in the F9P mast, 80 mm above the carbon, isolated by the TPU collar. Far from the 45 A ESC current loop.",
    role: "Observes Earth-field yaw. The EKF uses it gently; a nearby steel car roof is a disturbance, not a feature.",
    fsd: "While tracking, yaw is commanded from optical flow of the target, not from the compass. Mag is a bias prior, not the chase sensor.",
    specs: [
      { label: "Sensor", value: "RM3100" },
      { label: "Rate", value: "100 Hz" },
      { label: "Mount", value: "Mast, 80 mm" },
    ],
  },
  {
    id: "battery",
    name: "6S LiPo pack",
    group: "Power",
    summary:
      "Tattu 6 000 mAh 6S, 148 × 45 × 59 mm, 885 g, XT90. Sits in the printed 155 × 50 mm tray under the 120 × 128 mm battery plate.",
    role: "Energy and voltage sag. The FC watches cell voltage and will abort a chase before the mixer runs out of headroom.",
    fsd: "Pursuit is a high-current regime. FSD caps lateral accel as voltage sags so the detector does not starve mid-corner.",
    specs: [
      { label: "Pack", value: "148 × 45 × 59 mm" },
      { label: "Mass", value: "885 g" },
      { label: "Plug", value: "XT90" },
    ],
  },
  {
    id: "rx",
    name: "Command radio",
    group: "Link",
    summary:
      "ExpressLRS 900 MHz Nano RX (~18 × 11 × 4 mm) with 90 mm dipoles clipped to the rear Ø20 mm arms. 2.4 GHz SiK is telemetry only.",
    role: "Failsafe path. Loss of RC for 1.5 s with a live vision lock continues the chase; loss of both triggers a GNSS hold.",
    fsd: "FSD is a setpoint source, not a pilot replacement. The radio is the authority flag that enables or kills the tracker.",
    specs: [
      { label: "RX", value: "18 × 11 × 4 mm" },
      { label: "Antenna", value: "90 mm dipole" },
      { label: "Control", value: "900 MHz CRSF" },
    ],
  },
];

export const PART_MAP: Record<string, PartInfo> = Object.fromEntries(
  PARTS.map((p) => [p.id, p]),
);

export const PIPELINE = [
  {
    id: "capture",
    title: "Capture",
    body: "CSI global-shutter frame on Orin, IMU-timestamped. Undistort with the calibration model. Extrinsics rotate the ray into the body frame.",
  },
  {
    id: "detect",
    title: "Detect",
    body: "INT8 detector on the Jetson proposes vehicle boxes. Class score and a minimum box area reject distant clutter.",
  },
  {
    id: "associate",
    title: "Associate",
    body: "IoU + appearance glue this box to last frame’s track. A new track is born only after two consecutive hits.",
  },
  {
    id: "estimate",
    title: "Estimate",
    body: "Constant-turn Kalman in NED. Range is monocular: box bottom + AGL + pinhole. LiDAR is not in this stack.",
  },
  {
    id: "guide",
    title: "Guide",
    body: "Setpoint = target − standoff along its velocity, plus commanded AGL. UART to PX4. Local map is tracks, not a cloud.",
  },
  {
    id: "actuate",
    title: "Actuate",
    body: "FC rate loop → mixer → DShot. Gimbal PIDs keep the predicted box on the optical axis the whole time.",
  },
] as const;
