/**
 * Metric bird's-eye occupancy grid.
 *
 * Each LiDAR sweep updates a world-fixed ground-plane spreadsheet of cells
 * (unknown / free / occupied). The lattice covers the road even with zero
 * returns. Observed free/occupied cells persist after the sensor moves on;
 * occupied wins over free. This is not an image an AI “reads” and not a
 * neural net. Objects are attributed by the points — and, when the sim has
 * ground-truth boxes, the footprint — that touch a cell. Sitting on a cell
 * edge still counts: every touched cell is occupied.
 */

import {
  ROAD_LENGTH,
  SENSOR_MIN,
  SENSOR_RANGE,
  type Detection,
  type ObjectLabel,
  type SceneObject,
} from "./types.ts";

export const CELL_UNKNOWN = 0;
export const CELL_FREE = 1;
export const CELL_OCCUPIED = 2;

export type CellState = "unknown" | "free" | "occupied";

export type BevConfig = {
  cellSize: number;
  /** World X of the lattice origin (road start). */
  xMin: number;
  xMax: number;
  /** World Z of the lattice origin (left road edge). */
  yMin: number;
  yMax: number;
  /** Returns at or below this height (web Y) count as ground. */
  groundHeight: number;
  /** Elevated returns required before a cell becomes occupied. */
  minOccupied: number;
  /** Range-gate half-width; matches the existing point-cloud clip. */
  sweepLateral: number;
};

export const DEFAULT_BEV_CONFIG: BevConfig = {
  cellSize: 0.2,
  xMin: 0,
  xMax: ROAD_LENGTH,
  yMin: -50,
  yMax: 50,
  groundHeight: 0.08,
  minOccupied: 2,
  sweepLateral: 50,
};

export type CellHit = {
  ix: number;
  iy: number;
  objectIds: number[];
};

export type OccupancyBlob = {
  id: number;
  cells: [number, number][];
  objectIds: number[];
  labels: ObjectLabel[];
};

export type OccupancyGrid = {
  config: BevConfig;
  cols: number;
  rows: number;
  states: Uint8Array;
  occupied: CellHit[];
  free: CellHit[];
  blobs: OccupancyBlob[];
};

export function resolveBevConfig(partial?: Partial<BevConfig>): BevConfig {
  const merged = { ...DEFAULT_BEV_CONFIG, ...partial };
  if (!(merged.cellSize > 0)) {
    throw new Error("BEV cellSize must be > 0");
  }
  if (merged.xMax <= merged.xMin || merged.yMax <= merged.yMin) {
    throw new Error("BEV extents must have max > min");
  }
  return merged;
}

export function gridShape(config: BevConfig): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.round((config.xMax - config.xMin) / config.cellSize)),
    rows: Math.max(1, Math.round((config.yMax - config.yMin) / config.cellSize)),
  };
}

export function inSensorSweep(
  x: number,
  z: number,
  sensorX: number,
  config: BevConfig = DEFAULT_BEV_CONFIG,
): boolean {
  const dx = x - sensorX;
  const dist = Math.hypot(dx, z);
  return (
    dx > SENSOR_MIN &&
    dx < SENSOR_RANGE &&
    dist < SENSOR_RANGE &&
    Math.abs(z) < config.sweepLateral
  );
}

export function worldToCell(
  worldX: number,
  worldZ: number,
  config: BevConfig,
): { ix: number; iy: number } | null {
  const { cols, rows } = gridShape(config);
  const ix = Math.floor((worldX - config.xMin) / config.cellSize);
  const iy = Math.floor((worldZ - config.yMin) / config.cellSize);
  if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) return null;
  return { ix, iy };
}

export function cellCenterWorld(
  ix: number,
  iy: number,
  config: BevConfig,
): { x: number; z: number } {
  return {
    x: config.xMin + (ix + 0.5) * config.cellSize,
    z: config.yMin + (iy + 0.5) * config.cellSize,
  };
}

export function sameGridShape(a: BevConfig, b: BevConfig): boolean {
  return (
    a.cellSize === b.cellSize &&
    a.xMin === b.xMin &&
    a.xMax === b.xMax &&
    a.yMin === b.yMin &&
    a.yMax === b.yMax
  );
}

export function emptyOccupancyGrid(partial?: Partial<BevConfig>): OccupancyGrid {
  const config = resolveBevConfig(partial);
  const { cols, rows } = gridShape(config);
  return {
    config,
    cols,
    rows,
    states: new Uint8Array(cols * rows),
    occupied: [],
    free: [],
    blobs: [],
  };
}

function idxOf(ix: number, iy: number, cols: number): number {
  return iy * cols + ix;
}

function addObjectId(idSets: Array<Set<number> | undefined>, idx: number, objectId: number) {
  if (objectId <= 0) return;
  const set = idSets[idx] ?? new Set<number>();
  set.add(objectId);
  idSets[idx] = set;
}

/** Cells whose ground-plane footprint overlaps the object's oriented box. */
export function footprintCells(
  obj: SceneObject,
  config: BevConfig,
): { ix: number; iy: number }[] {
  const [length, width] = obj.size;
  const c = Math.cos(obj.yaw);
  const s = Math.sin(obj.yaw);
  const step = Math.min(config.cellSize * 0.5, 0.15);
  const { cols } = gridShape(config);
  const seen = new Set<number>();
  const out: { ix: number; iy: number }[] = [];

  const consider = (lx: number, lz: number) => {
    const wx = obj.center[0] + c * lx - s * lz;
    const wz = obj.center[2] + s * lx + c * lz;
    const cell = worldToCell(wx, wz, config);
    if (!cell) return;
    const key = idxOf(cell.ix, cell.iy, cols);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cell);
  };

  consider(0, 0);
  consider(length / 2, width / 2);
  consider(length / 2, -width / 2);
  consider(-length / 2, width / 2);
  consider(-length / 2, -width / 2);
  for (let lx = -length / 2; lx <= length / 2 + 1e-9; lx += step) {
    for (let lz = -width / 2; lz <= width / 2 + 1e-9; lz += step) {
      consider(lx, lz);
    }
  }
  return out;
}

function clusterOccupied(
  states: Uint8Array,
  occupied: CellHit[],
  cols: number,
  rows: number,
  objects: SceneObject[],
): OccupancyBlob[] {
  const labelById = new Map(objects.map((o) => [o.id, o.label] as const));
  const hitAt = new Map<number, CellHit>();
  for (const hit of occupied) hitAt.set(idxOf(hit.ix, hit.iy, cols), hit);

  const visited = new Set<number>();
  const blobs: OccupancyBlob[] = [];
  let nextId = 1;
  const nbr: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const start of occupied) {
    const startIdx = idxOf(start.ix, start.iy, cols);
    if (visited.has(startIdx)) continue;
    const stack = [start];
    visited.add(startIdx);
    const cells: [number, number][] = [];
    const objIds = new Set<number>();

    while (stack.length) {
      const cur = stack.pop()!;
      cells.push([cur.ix, cur.iy]);
      for (const id of cur.objectIds) objIds.add(id);
      for (const [dx, dy] of nbr) {
        const nx = cur.ix + dx;
        const ny = cur.iy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nidx = idxOf(nx, ny, cols);
        if (visited.has(nidx) || states[nidx] !== CELL_OCCUPIED) continue;
        const next = hitAt.get(nidx);
        if (!next) continue;
        visited.add(nidx);
        stack.push(next);
      }
    }

    const objectIds = [...objIds];
    const labels: ObjectLabel[] = [];
    for (const id of objectIds) {
      const label = labelById.get(id);
      if (label && !labels.includes(label)) labels.push(label);
    }
    blobs.push({ id: nextId++, cells, objectIds, labels });
  }
  return blobs;
}

/**
 * Rasterize a list of points onto the ground-plane grid.
 * Does not apply the sensor range gate — pass a gated sweep, or call
 * `rasterizeLidarSweep` for the live sim path.
 */
export function rasterizeSweep(
  positions: Float32Array,
  objectIds: Int32Array | null,
  sensorX: number,
  objects: SceneObject[] = [],
  partial?: Partial<BevConfig>,
): OccupancyGrid {
  const config = resolveBevConfig(partial);
  const { cols, rows } = gridShape(config);
  const nCells = cols * rows;
  const ground = new Uint16Array(nCells);
  const elevated = new Uint16Array(nCells);
  const idSets: Array<Set<number> | undefined> = new Array(nCells);
  const seenObjects = new Set<number>();

  const n = Math.floor(positions.length / 3);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const cell = worldToCell(x, z, config);
    if (!cell) continue;
    const idx = idxOf(cell.ix, cell.iy, cols);
    const oid = objectIds?.[i] ?? 0;
    if (y <= config.groundHeight) {
      ground[idx]++;
    } else {
      elevated[idx]++;
      addObjectId(idSets, idx, oid);
      if (oid > 0) seenObjects.add(oid);
    }
  }

  // Observed objects occupy every cell their footprint touches, not just the
  // cell that happens to contain the box center.
  if (objects.length > 0 && seenObjects.size > 0) {
    for (const obj of objects) {
      if (!seenObjects.has(obj.id)) continue;
      for (const cell of footprintCells(obj, config)) {
        const idx = idxOf(cell.ix, cell.iy, cols);
        elevated[idx] = Math.max(elevated[idx], config.minOccupied);
        addObjectId(idSets, idx, obj.id);
      }
    }
  }

  const states = new Uint8Array(nCells);
  const occupied: CellHit[] = [];
  const free: CellHit[] = [];
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const idx = idxOf(ix, iy, cols);
      if (elevated[idx] >= config.minOccupied) {
        states[idx] = CELL_OCCUPIED;
        occupied.push({ ix, iy, objectIds: idSets[idx] ? [...idSets[idx]!] : [] });
      } else if (ground[idx] > 0) {
        states[idx] = CELL_FREE;
        free.push({ ix, iy, objectIds: [] });
      }
    }
  }

  return {
    config,
    cols,
    rows,
    states,
    occupied,
    free,
    blobs: clusterOccupied(states, occupied, cols, rows, objects),
  };
}

export function gateSweep(
  positions: Float32Array,
  objectIds: Int32Array,
  sensorX: number,
  partial?: Partial<BevConfig>,
): { positions: Float32Array; objectIds: Int32Array } {
  const config = resolveBevConfig(partial);
  const xyz: number[] = [];
  const ids: number[] = [];
  const n = Math.floor(positions.length / 3);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    if (!inSensorSweep(x, z, sensorX, config)) continue;
    xyz.push(x, y, z);
    ids.push(objectIds[i] ?? 0);
  }
  return { positions: new Float32Array(xyz), objectIds: new Int32Array(ids) };
}

/**
 * Merge a new observation into the world-fixed map.
 * Unknown observation leaves the prior cell alone. Occupied wins over free.
 */
export function integrateSweep(
  prior: OccupancyGrid,
  observed: OccupancyGrid,
  objects: SceneObject[] = [],
): OccupancyGrid {
  if (!sameGridShape(prior.config, observed.config) || prior.cols !== observed.cols || prior.rows !== observed.rows) {
    return observed;
  }

  const n = prior.states.length;
  const states = new Uint8Array(n);
  const idsByIdx = new Map<number, number[]>();
  for (const hit of prior.occupied) {
    idsByIdx.set(idxOf(hit.ix, hit.iy, prior.cols), hit.objectIds.slice());
  }
  for (const hit of observed.occupied) {
    const idx = idxOf(hit.ix, hit.iy, observed.cols);
    const merged = new Set(idsByIdx.get(idx) ?? []);
    for (const id of hit.objectIds) merged.add(id);
    idsByIdx.set(idx, [...merged]);
  }

  for (let i = 0; i < n; i++) {
    const o = observed.states[i] ?? CELL_UNKNOWN;
    const p = prior.states[i] ?? CELL_UNKNOWN;
    if (o === CELL_OCCUPIED || p === CELL_OCCUPIED) states[i] = CELL_OCCUPIED;
    else if (o === CELL_FREE) states[i] = CELL_FREE;
    else states[i] = p;
  }

  const occupied: CellHit[] = [];
  const free: CellHit[] = [];
  for (let iy = 0; iy < prior.rows; iy++) {
    for (let ix = 0; ix < prior.cols; ix++) {
      const idx = idxOf(ix, iy, prior.cols);
      if (states[idx] === CELL_OCCUPIED) {
        occupied.push({ ix, iy, objectIds: idsByIdx.get(idx) ?? [] });
      } else if (states[idx] === CELL_FREE) {
        free.push({ ix, iy, objectIds: [] });
      }
    }
  }

  return {
    config: observed.config,
    cols: prior.cols,
    rows: prior.rows,
    states,
    occupied,
    free,
    blobs: clusterOccupied(states, occupied, prior.cols, prior.rows, objects),
  };
}

/** Range-gate the live cloud, then rasterize this sweep only (no persistence). */
export function rasterizeLidarSweep(
  positions: Float32Array,
  objectIds: Int32Array,
  sensorX: number,
  objects: SceneObject[],
  partial?: Partial<BevConfig>,
): OccupancyGrid {
  const gated = gateSweep(positions, objectIds, sensorX, partial);
  return rasterizeSweep(gated.positions, gated.objectIds, sensorX, objects, partial);
}

export function cellState(grid: OccupancyGrid, ix: number, iy: number): CellState {
  const v = grid.states[idxOf(ix, iy, grid.cols)] ?? CELL_UNKNOWN;
  if (v === CELL_OCCUPIED) return "occupied";
  if (v === CELL_FREE) return "free";
  return "unknown";
}

export function cellObjectIds(grid: OccupancyGrid, ix: number, iy: number): number[] {
  return grid.occupied.find((c) => c.ix === ix && c.iy === iy)?.objectIds ?? [];
}

/** One detection per ground-truth object that has occupied cells. */
export function detectionsFromGrid(
  grid: OccupancyGrid,
  objects: SceneObject[],
  sensorX: number,
): Detection[] {
  const objById = new Map(objects.map((o) => [o.id, o]));
  const acc = new Map<number, { sx: number; sz: number; n: number }>();

  for (const hit of grid.occupied) {
    const c = cellCenterWorld(hit.ix, hit.iy, grid.config);
    for (const id of hit.objectIds) {
      const cur = acc.get(id) ?? { sx: 0, sz: 0, n: 0 };
      cur.sx += c.x;
      cur.sz += c.z;
      cur.n += 1;
      acc.set(id, cur);
    }
  }

  const out: Detection[] = [];
  for (const [id, sum] of acc) {
    const obj = objById.get(id);
    if (!obj || sum.n === 0) continue;
    const cx = sum.sx / sum.n;
    const cz = sum.sz / sum.n;
    const relativeX = cx - sensorX;
    out.push({
      id,
      label: obj.label,
      center: [cx, obj.center[1], cz],
      size: obj.size,
      yaw: obj.yaw,
      distance: Math.hypot(relativeX, cz),
      relativeX,
    });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
