import type { PartInfo } from "./types";

export const PARTS: PartInfo[] = [
  {
    id: "frame",
    name: "Carbon airframe",
    group: "Structure",
    summary:
      "Unidirectional carbon X-frame. The plates sandwich the avionics stack; arms carry motor thrust into the center of mass.",
    role: "Keeps motors, camera, and batteries in a rigid, known geometry so the flight controller’s mixing matrix stays valid.",
    fsd: "Vision guidance assumes a fixed camera-to-IMU extrinsics. A flexing frame injects phantom accelerations and ruins lock.",
    specs: [
      { label: "Layout", value: "X · 650 mm" },
      { label: "Layup", value: "3K twill / UD spar" },
      { label: "AUW target", value: "1.85 kg" },
    ],
  },
  {
    id: "motors",
    name: "Brushless outrunners",
    group: "Propulsion",
    summary:
      "Four 3115-class outrunners. The copper stator is fixed to the arm; the bell and magnets spin with the propeller.",
    role: "Convert DShot throttle into thrust and yaw torque. Opposite motors share rotation direction so yaw is differential RPM.",
    fsd: "The mixer maps body-rate PID output onto these four thrusts. Tracking a car is just a moving position setpoint into that inner loop.",
    specs: [
      { label: "Kv", value: "900" },
      { label: "Stator", value: "31 × 15 mm" },
      { label: "Peak", value: "1.6 kgf / axis" },
    ],
  },
  {
    id: "props",
    name: "Carbon propellers",
    group: "Propulsion",
    summary:
      "10-inch two-blade carbon. CW / CCW pairs cancel reaction torque in hover so the airframe does not spin.",
    role: "The only surface that makes force. Tip speed and pitch set the thrust curve the mixer linearises around hover.",
    fsd: "Hard yaw while panning the gimbal is limited by prop inertia. FSD keeps yaw-rate commands inside the linear region.",
    specs: [
      { label: "Diameter", value: "10 in" },
      { label: "Pitch", value: "5.5 in" },
      { label: "Pairing", value: "CW · CCW · CW · CCW" },
    ],
  },
  {
    id: "escs",
    name: "4-in-1 ESC",
    group: "Propulsion",
    summary:
      "A single four-channel board under the flight controller. Each MOSFET bridge commutates one motor from the LiPo rail.",
    role: "Translates digital DShot packets into timed phase currents. Also reports eRPM and current back to the FC.",
    fsd: "Current feedback lets the position controller know when a motor is saturating — the tracker then sheds lateral acceleration instead of spinning out.",
    specs: [
      { label: "Protocol", value: "DShot600" },
      { label: "Continuous", value: "45 A / motor" },
      { label: "Telemetry", value: "eRPM · A · °C" },
    ],
  },
  {
    id: "fc",
    name: "Flight controller",
    group: "Avionics",
    summary:
      "STM32H7 running a PX4-class stack. Gyro at 4 kHz, attitude at 1 kHz, position at 100 Hz. This is the inner-loop computer.",
    role: "Fuses IMU, baro, mag, and GPS; runs rate and angle PIDs; mixes onto four motors. Companion vision never writes motors directly.",
    fsd: "Horizon Vision never writes motors. Orin sends a NED setpoint at 50 Hz. The FC is last authority: if vision drops, attitude still holds.",
    specs: [
      { label: "MCU", value: "STM32H743" },
      { label: "Gyro", value: "4 kHz BMI088" },
      { label: "Firmware", value: "PX4 1.15" },
    ],
  },
  {
    id: "imu",
    name: "IMU · gyro + accel",
    group: "Avionics",
    summary:
      "BMI088 six-axis. The gyro is the truth for body rate; the accelerometer observes gravity and linear acceleration.",
    role: "A complementary / EKF attitude estimator integrates gyro and corrects with accel so tilt does not drift.",
    fsd: "Camera timestamps are interpolated on IMU time. Without that, a 20 ms skew at 15 m/s is 30 cm of lock error.",
    specs: [
      { label: "Gyro range", value: "±2000 °/s" },
      { label: "Accel", value: "±24 g" },
      { label: "Noise", value: "0.004 °/s/√Hz" },
    ],
  },
  {
    id: "npu",
    name: "Jetson Orin Nano",
    group: "Perception",
    summary:
      "NVIDIA Jetson Orin Nano — Horizon Vision’s edge computer. Detector, tracker, and local map run here. LiDAR is off the stack; the camera is the only scene sensor.",
    role: "Turns CSI frames into a 3D target state (position, velocity, covariance) in the NED frame the FC already uses. UART / Ethernet passenger — it never drives MOSFETs.",
    fsd: "This is the FSD brain: detect vehicles, pick one, keep a Kalman lock, emit a pursuit setpoint. Fail-closed: no packet, no setpoint. Local map is built from tracks, not a point cloud.",
    specs: [
      { label: "Module", value: "Orin Nano 8 GB" },
      { label: "Compute", value: "40 TOPS INT8" },
      { label: "Link", value: "CSI + 50 Hz UART" },
    ],
  },
  {
    id: "camera",
    name: "Vision FSD camera",
    group: "Perception",
    summary:
      "Dedicated CSI global-shutter camera on the gimbal. Horizon Vision dropped LiDAR — range comes from pinhole geometry + AGL, not a spinning puck.",
    role: "The only exteroceptive sensor that sees the vehicle. IMU orients the drone; this camera tells it what it is chasing. camera_link in the Horizon Vision tree.",
    fsd: "Each frame is undistorted on Orin. Detector returns class + box. Box bottom + drone altitude + calibration lift that box into a 3D chase point.",
    specs: [
      { label: "Interface", value: "CSI · global shutter" },
      { label: "Native", value: "1280×720 · 30–60 fps" },
      { label: "HFOV", value: "70°" },
    ],
  },
  {
    id: "gimbal",
    name: "Two-axis gimbal",
    group: "Perception",
    summary:
      "Yaw-pitch brushless gimbal with its own IMU. It isolates the camera from airframe pitch so the detector sees a stable horizon.",
    role: "Keeps the target near the optical centre. Pixel error is a cheap, high-rate measurement the tracker loves.",
    fsd: "Gimbal PIDs run at 1 kHz on pixel error from the predicted box. The airframe still does the heavy translation; the gimbal does the look.",
    specs: [
      { label: "Axes", value: "Yaw + pitch" },
      { label: "Travel", value: "±110° / −90…+30°" },
      { label: "Follow", value: "Pixel closed-loop" },
    ],
  },
  {
    id: "gps",
    name: "GNSS + compass mast",
    group: "Navigation",
    summary:
      "Multi-band GNSS puck raised above the carbon to keep it out of motor current loops. Magnetometer sits in the same module.",
    role: "Absolute position for return-to-home and to pin the EKF when vision is lost. Not fast enough to chase a car by itself.",
    fsd: "Fusion: GNSS for the drone’s own geodetic pose, vision for the car relative to the drone. Subtract — that is the chase vector. No LiDAR in the loop.",
    specs: [
      { label: "Bands", value: "L1 / L2" },
      { label: "CEP", value: "1.2 m (open sky)" },
      { label: "Update", value: "10 Hz" },
    ],
  },
  {
    id: "mag",
    name: "Magnetometer",
    group: "Navigation",
    summary:
      "3-axis mag in the GPS mast, far from the ESC current. Heading lock when GNSS yaw is poor — hover, or a slow orbit.",
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
      "6 000 mAh 6S slung under the plate. Low CG, short power leads, XT90 into the 4-in-1.",
    role: "Energy and voltage sag. The FC watches cell voltage and will abort a chase before the mixer runs out of headroom.",
    fsd: "Pursuit is a high-current regime. FSD caps lateral accel as voltage sags so the detector does not starve mid-corner.",
    specs: [
      { label: "Pack", value: "6S 6 000 mAh" },
      { label: "Hover", value: "18 A" },
      { label: "Endurance", value: "14 min chase" },
    ],
  },
  {
    id: "rx",
    name: "Command radio",
    group: "Link",
    summary:
      "900 MHz control + 2.4 GHz telemetry. A human can always override FSD with a stick; the mixer still runs on the FC.",
    role: "Failsafe path. Loss of RC for 1.5 s with a live vision lock continues the chase; loss of both triggers a GNSS hold.",
    fsd: "FSD is a setpoint source, not a pilot replacement. The radio is the authority flag that enables or kills the tracker.",
    specs: [
      { label: "Control", value: "900 MHz CRSF" },
      { label: "Latency", value: "8 ms stick" },
      { label: "Failsafe", value: "Hold / land" },
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
