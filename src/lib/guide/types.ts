export type Mode = "anatomy" | "controller" | "vision" | "pursuit";
export type CamView = "orbit" | "chase" | "fpv";
export type BuildView = "skeleton" | "finished" | "kit";
export type LockState = "search" | "acquire" | "track" | "lost";

export type Spec = { label: string; value: string };

export type PartInfo = {
  id: string;
  name: string;
  group: string;
  summary: string;
  role: string;
  fsd: string;
  specs: Spec[];
};

export type BBox = {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
};

export type Telemetry = {
  alt: number;
  speed: number;
  range: number;
  yawErr: number;
  lock: LockState;
  confidence: number;
  fpsDetect: number;
  throttle: number;
  motors: [number, number, number, number];
  pidP: number;
  pidI: number;
  pidD: number;
  loopHz: number;
  targetId: number;
  pipelineStep: number;
  bbox: BBox | null;
};

export const BUILD_VIEWS: { id: BuildView; label: string }[] = [
  { id: "skeleton", label: "Skeleton" },
  { id: "finished", label: "Finished" },
  { id: "kit", label: "Kit" },
];

export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "anatomy", label: "Airframe", hint: "Exploded assembly" },
  { id: "controller", label: "Controller", hint: "IMU · PID · mixer" },
  { id: "vision", label: "Vision FSD", hint: "Camera · detect · track" },
  { id: "pursuit", label: "Pursuit", hint: "Live vehicle lock" },
];
