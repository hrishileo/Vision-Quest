export type ObjectLabel =
  | "car"
  | "truck"
  | "bus"
  | "van"
  | "motorcycle"
  | "pedestrian";

export type CameraMode = "drone" | "third" | "bev";

export type WorldKind = "city" | "forest" | "open";

export type IrregularKind = "lane-departure" | "pedestrian-in-road";

export type SceneObject = {
  id: number;
  label: ObjectLabel;
  center: [number, number, number];
  size: [number, number, number];
  yaw: number;
  color: string;
  irregular?: IrregularKind;
};

export type Detection = {
  id: number;
  label: ObjectLabel;
  center: [number, number, number];
  size: [number, number, number];
  yaw: number;
  distance: number;
  relativeX: number;
};

export type LogFrame = {
  time: number;
  sensorX: number;
  numPoints: number;
  occupiedCells: number;
  blobs: number;
  detections: Detection[];
};

export const OBJECT_SPECS: Record<
  ObjectLabel,
  { size: [[number, number], [number, number], [number, number]]; color: string }
> = {
  car: { size: [[4.2, 4.6], [1.75, 1.9], [1.45, 1.6]], color: "#5b7c99" },
  truck: { size: [[7.2, 8.4], [2.3, 2.5], [2.6, 3.0]], color: "#b07050" },
  bus: { size: [[11.0, 12.2], [2.5, 2.7], [3.0, 3.3]], color: "#c4b06a" },
  van: { size: [[5.0, 5.5], [1.95, 2.1], [2.0, 2.2]], color: "#4f8a72" },
  motorcycle: { size: [[2.0, 2.2], [0.65, 0.75], [1.2, 1.35]], color: "#8a6b8c" },
  pedestrian: { size: [[0.55, 0.65], [0.5, 0.6], [1.6, 1.8]], color: "#d4b896" },
};

export const ROAD_LENGTH = 120;
export const ROAD_WIDTH = 33;
export const SENSOR_HEIGHT = 1.5;
export const SENSOR_RANGE = 56;
export const SENSOR_MIN = 2;
export const DEFAULT_SPEED = 6;
export const DEFAULT_DENSITY = 5;
export const LANE_Z = [-14.4, -10.55, -6.7, 6.7, 10.55, 14.4] as const;
export const END_X = 108;
