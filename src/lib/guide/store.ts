import { create } from "zustand";
import type { CamView, LockState, Mode, Telemetry } from "./types";

const DEFAULT_TELEMETRY: Telemetry = {
  alt: 0,
  speed: 0,
  range: 0,
  yawErr: 0,
  lock: "search",
  confidence: 0,
  fpsDetect: 30,
  throttle: 0.18,
  motors: [0.18, 0.18, 0.18, 0.18],
  pidP: 0,
  pidI: 0,
  pidD: 0,
  loopHz: 1000,
  targetId: 0,
  pipelineStep: 0,
  bbox: null,
};

type GuideState = {
  mode: Mode;
  selected: string | null;
  hovered: string | null;
  explode: number;
  shell: number;
  rpm: number;
  cutaway: boolean;
  paused: boolean;
  touring: boolean;
  camView: CamView;
  standoff: number;
  altitude: number;
  tightness: number;
  telemetry: Telemetry;
  rangeHist: number[];
  ready: boolean;
  setMode: (mode: Mode) => void;
  setSelected: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setExplode: (n: number) => void;
  setShell: (n: number) => void;
  setRpm: (n: number) => void;
  toggleCutaway: () => void;
  togglePaused: () => void;
  toggleTour: () => void;
  setTouring: (v: boolean) => void;
  setCamView: (v: CamView) => void;
  setStandoff: (n: number) => void;
  setAltitude: (n: number) => void;
  setTightness: (n: number) => void;
  setTelemetry: (t: Telemetry, rangeSample?: number) => void;
  setReady: (v: boolean) => void;
};

export const useGuide = create<GuideState>((set) => ({
  mode: "anatomy",
  selected: null,
  hovered: null,
  explode: 0.52,
  shell: 1,
  rpm: 1800,
  cutaway: false,
  paused: false,
  touring: false,
  camView: "orbit",
  standoff: 9,
  altitude: 7,
  tightness: 0.9,
  telemetry: DEFAULT_TELEMETRY,
  rangeHist: Array.from({ length: 48 }, () => 0),
  ready: false,
  setMode: (mode) =>
    set((s) => {
      if (s.mode === mode) return {};
      const next: Partial<GuideState> = { mode };
      if (mode === "anatomy") {
        next.camView = "orbit";
        next.explode = 0.52;
        next.shell = 1;
        next.selected = null;
      }
      if (mode === "controller") {
        next.selected = s.selected ?? "fc";
        next.explode = Math.max(s.explode, 0.48);
        next.camView = "orbit";
      }
      if (mode === "vision") {
        next.selected = s.selected && s.selected !== "fc" ? s.selected : "camera";
        next.explode = Math.min(Math.max(s.explode, 0.12), 0.28);
        next.camView = "orbit";
      }
      if (mode === "pursuit") {
        next.explode = 0;
        next.shell = 1;
        if (s.camView === "orbit") next.camView = "chase";
      }
      return next;
    }),
  setSelected: (selected) => set({ selected }),
  setHovered: (hovered) => set({ hovered }),
  setExplode: (explode) => set({ explode }),
  setShell: (shell) => set({ shell }),
  setRpm: (rpm) => set({ rpm }),
  toggleCutaway: () => set((s) => ({ cutaway: !s.cutaway })),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  toggleTour: () =>
    set((s) => ({
      touring: !s.touring,
      paused: false,
      mode: s.touring ? s.mode : "anatomy",
      camView: "orbit",
    })),
  setTouring: (touring) => set({ touring }),
  setCamView: (camView) => set({ camView }),
  setStandoff: (standoff) => set({ standoff }),
  setAltitude: (altitude) => set({ altitude }),
  setTightness: (tightness) => set({ tightness }),
  setTelemetry: (telemetry, rangeSample) =>
    set((s) => {
      const rangeHist =
        rangeSample === undefined
          ? s.rangeHist
          : [...s.rangeHist.slice(1), rangeSample];
      return { telemetry, rangeHist };
    }),
  setReady: (ready) => set({ ready }),
}));

export const LOCK_LABEL: Record<LockState, string> = {
  search: "SEARCH",
  acquire: "ACQUIRE",
  track: "LOCKED",
  lost: "LOST",
};

export const TOUR_BEATS: {
  mode: Mode;
  part: string | null;
  explode: number;
  seconds: number;
}[] = [
  { mode: "anatomy", part: "frame", explode: 0.18, seconds: 4.2 },
  { mode: "anatomy", part: "motors", explode: 0.42, seconds: 4.2 },
  { mode: "anatomy", part: "battery", explode: 0.55, seconds: 3.6 },
  { mode: "anatomy", part: "escs", explode: 0.62, seconds: 3.8 },
  { mode: "controller", part: "fc", explode: 0.7, seconds: 5.2 },
  { mode: "controller", part: "imu", explode: 0.78, seconds: 4.4 },
  { mode: "vision", part: "camera", explode: 0.22, seconds: 4.8 },
  { mode: "vision", part: "npu", explode: 0.28, seconds: 4.6 },
  { mode: "vision", part: "gimbal", explode: 0.2, seconds: 4.2 },
  { mode: "pursuit", part: null, explode: 0, seconds: 10 },
];
