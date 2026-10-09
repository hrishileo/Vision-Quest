import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CELL_UNKNOWN,
  cellObjectIds,
  cellState,
  detectionsFromGrid,
  integrateSweep,
  rasterizeSweep,
  worldToCell,
} from "./occupancyGrid.ts";
import type { SceneObject } from "./types.ts";

const tiny = {
  cellSize: 1,
  xMin: 0,
  xMax: 4,
  yMin: -2,
  yMax: 2,
  groundHeight: 0.15,
  minOccupied: 1,
  sweepLateral: 20,
};

function car(partial: Partial<SceneObject> & Pick<SceneObject, "id" | "center" | "size">): SceneObject {
  return {
    label: "car",
    yaw: 0,
    color: "#5b7c99",
    ...partial,
  };
}

describe("BEV occupancy grid", () => {
  it("empty sweep stays unknown", () => {
    const grid = rasterizeSweep(new Float32Array(0), new Int32Array(0), 0, [], tiny);
    assert.equal(grid.occupied.length, 0);
    assert.equal(grid.free.length, 0);
    assert.equal(
      grid.states.every((s) => s === CELL_UNKNOWN),
      true,
    );
  });

  it("ground-only returns mark a cell free", () => {
    const pts = new Float32Array([0.5, 0.02, 0]);
    const grid = rasterizeSweep(pts, new Int32Array([0]), 0, [], tiny);
    const cell = worldToCell(0.5, 0, grid.config)!;
    assert.equal(cellState(grid, cell.ix, cell.iy), "free");
    assert.equal(grid.occupied.length, 0);
  });

  it("elevated points in a cell mark it occupied", () => {
    const pts = new Float32Array([0.5, 0.6, 0]);
    const grid = rasterizeSweep(pts, new Int32Array([0]), 0, [], tiny);
    const cell = worldToCell(0.5, 0, grid.config)!;
    assert.equal(cellState(grid, cell.ix, cell.iy), "occupied");
    assert.equal(grid.free.length, 0);
  });

  it("an object spanning two cells occupies and attributes both", () => {
    const obj = car({ id: 7, center: [1, 0, 0], size: [2.2, 1.2, 1.4] });
    const pts = new Float32Array([0.4, 0.5, 0, 1.6, 0.5, 0]);
    const grid = rasterizeSweep(pts, new Int32Array([7, 7]), 0, [obj], tiny);
    const a = worldToCell(0.4, 0, grid.config)!;
    const b = worldToCell(1.6, 0, grid.config)!;
    assert.notEqual(a.ix, b.ix);
    assert.equal(cellState(grid, a.ix, a.iy), "occupied");
    assert.equal(cellState(grid, b.ix, b.iy), "occupied");
    assert.ok(cellObjectIds(grid, a.ix, a.iy).includes(7));
    assert.ok(cellObjectIds(grid, b.ix, b.iy).includes(7));
    assert.ok(grid.blobs.some((blob) => blob.objectIds.includes(7) && blob.cells.length >= 2));
    const dets = detectionsFromGrid(grid, [obj], 0);
    assert.equal(dets.length, 1);
    assert.equal(dets[0]?.id, 7);
  });

  it("attributes from points, not from whether the object center sits in a cell", () => {
    const obj = car({ id: 3, center: [0.4, 0, 0], size: [0.4, 0.4, 1] });
    const pts = new Float32Array([1.5, 0.5, 0]);
    const grid = rasterizeSweep(pts, new Int32Array([3]), 0, [], tiny);
    const centerCell = worldToCell(0.4, 0, grid.config)!;
    const pointCell = worldToCell(1.5, 0, grid.config)!;
    assert.notEqual(centerCell.ix, pointCell.ix);
    assert.notEqual(cellState(grid, centerCell.ix, centerCell.iy), "occupied");
    assert.equal(cellState(grid, pointCell.ix, pointCell.iy), "occupied");
    assert.ok(cellObjectIds(grid, pointCell.ix, pointCell.iy).includes(3));
    assert.deepEqual(
      detectionsFromGrid(grid, [obj], 0).map((d) => d.id),
      [3],
    );
  });

  it("keeps an occupied cell after the sweep no longer covers it", () => {
    const pts = new Float32Array([0.5, 0.6, 0]);
    const first = rasterizeSweep(pts, new Int32Array([0]), 0, [], tiny);
    const cell = worldToCell(0.5, 0, first.config)!;
    assert.equal(cellState(first, cell.ix, cell.iy), "occupied");

    const empty = rasterizeSweep(new Float32Array(0), new Int32Array(0), 40, [], tiny);
    assert.equal(
      empty.states.every((s) => s === CELL_UNKNOWN),
      true,
    );

    const merged = integrateSweep(first, empty);
    assert.equal(cellState(merged, cell.ix, cell.iy), "occupied");
    assert.ok(merged.occupied.some((c) => c.ix === cell.ix && c.iy === cell.iy));

    const groundAgain = rasterizeSweep(new Float32Array([0.5, 0.02, 0]), new Int32Array([0]), 0, [], tiny);
    const stillOcc = integrateSweep(merged, groundAgain);
    assert.equal(cellState(stillOcc, cell.ix, cell.iy), "occupied");
  });
});
