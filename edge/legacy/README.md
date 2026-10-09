# Parked LiDAR path

This tree is **not wired in**. The live edge is `edge/src` (`horizon_vision.events`). The hub is `hub/src`. Nothing in those packages imports `edge/legacy`.

It is parked because HorizonVision’s product path became camera-only before these branches merged. Closed pull requests kept the work:

| Source | What landed here |
| --- | --- |
| PR [#1](https://github.com/hrishileo/HorizonVision/pull/1) `cursor/web-edge-ingest-b8ff` | HTTP ingest, fixture replay, and the camera/LiDAR time synchronizer (`ingest/`, `perception/sync.py`, `sink.py`) |
| PR [#2](https://github.com/hrishileo/HorizonVision/pull/2) `cursor/static-scene-detector-c3e2` | Euclidean LiDAR cluster detector and bird’s-eye scoring (`perception/detector.py`, `perception/metrics.py`) |
| PR [#3](https://github.com/hrishileo/HorizonVision/pull/3) `cursor/bev-occupancy-grid-78a3` | Metric occupancy grid (`occupancy/occupancyGrid.ts`) |

The Python snapshot is the detector branch, which already contains the ingest branch. Fusion, the edge-AI stub, and the sensor drivers in this tree are the versions those modules import (time-window fusion, web-ingest drivers). They are not the copies under `edge/src`.

`occupancy/types.ts` is the road-strip type module the grid imported. The grid’s import now ends in `.ts` so Node can load it. The test is the original vitest file run with `node:test`.

## Run

From the repo root, after `pip install -r edge/requirements-dev.txt`:

```bash
(cd edge/legacy && python -m pytest)
node --experimental-strip-types --test edge/legacy/occupancy/occupancyGrid.test.ts
```

`scripts/test-python.sh` runs these after the live suite. Do not add `edge/legacy/src` to the root `PYTHONPATH`; the package name collides with the live `horizon_vision`.

## Left behind

The old `web/` viewer (scene generator, canvas, HUD, Zustand store, pause/rewind, camera raster, intersection mesh, roundabout JSON) was not copied. Vision-Quest’s Pursuit sim (`src/lib/guide/`) already owns the traffic scene, camera, and city. The ingest payload shape is in `ingest/payloads.py` and `tests/fixtures/web_samples.json`. The cluster detector does not read sim labels; scoring uses `perception/metrics.py`.
