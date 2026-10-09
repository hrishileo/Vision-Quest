# Vision Quest

Interactive 3D briefing for the **Horizon Vision** flight article — camera-based FSD and vehicle tracking on a Jetson Orin.

Built to walk investors, friends, and employers through the machine. Not a slide deck: a studio model you can explode, inspect, and watch run. **Pursuit** flies the HV-1 over Chicago’s Magnificent Mile.

## What it is

Horizon Vision dropped LiDAR. The stack is a 650 mm quad, PX4 on an STM32H7, and a dedicated CSI camera into an Orin Nano. Range is monocular (box + AGL + pinhole). The local map is tracks, not a point cloud.

Vision Quest is the presentation layer for that airframe:

1. **Airframe** — HV-1 OSPREY kit geometry. Hover a part for its SKU. Click for the spec sheet.
2. **Controller** — live attitude demo, PID bars, mixer, IMU axes.
3. **Vision FSD** — camera frustum tracks the target, lock beam, detection pipeline, picture-in-picture.
4. **Pursuit** — Michigan Ave & Chicago Ave, IDM traffic, Kalman vehicle lock (moving or stopped), CAM0 inset, and a 10-second scene scan that learns objects in range and classifies debris / blockades (manmade and natural).

**Skeleton** is the assembled HV-1 OSPREY kit (Creo-style carbon airframe + real parts). **Finished** is the exploded assembly. **Kit** is the real BOM: price list, fit check, and build order.

Keys: `1–4` modes · `Space` pause · `T` guided tour · `C` cutaway · `B` skeleton/finished · drag to orbit.

## Stack

React 19 · TanStack Start · Three.js · Zustand · Tailwind v4

Geometry is procedural (no GLB). Studio lighting, bloom, and CSS2D labels run in the browser.

The camera-only edge and the Mag Mile hub are in this repo. This app is the briefing, not the PX4 binary.

## Edge and hub

`edge/` is the Python edge package (`horizon_vision.events`, plus the LiDAR driver stubs that the event path does not call). `hub/` is the detour package (`horizon_vision.hub`: street graph, A*, JSONL alerts). `pytest.ini` puts `edge/src` and `hub/src` on the path. Tests read the CAM0 sample at `src/lib/guide/__fixtures__/cam0-sample.labels.jsonl` instead of keeping a second copy.

```bash
pip install -r edge/requirements-dev.txt
python -m pytest
```

`npm run test:python` runs that suite, the parked LiDAR tests under `edge/legacy/`, and the occupancy-grid check. Contract and commands: `docs/edge-events.md`.

```bash
PYTHONPATH=edge/src:hub/src python -m horizon_vision.hub \
  --output /tmp/debris_alerts.jsonl \
  --summary /tmp/debris_summary.txt
```

`edge/legacy/` holds unmerged HorizonVision work (time sync and ingest, the LiDAR cluster detector, BEV metrics, the occupancy grid). It is not imported by the edge or the hub. See `edge/legacy/README.md`.

## Run

```bash
npm install
npm run dev
```

Then open the printed local URL. `npm run build` produces a production bundle; `npm run typecheck` is the type gate.

— Hrishikesh Garikapati
