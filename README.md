# Vision Quest

Interactive 3D briefing for the **Horizon Vision** flight article — camera-based FSD and vehicle tracking on a Jetson Orin.

Built to walk investors, friends, and employers through the machine. Not a slide deck: a studio model you can explode, inspect, and watch run.

## What it is

Horizon Vision dropped LiDAR. The stack is a 650 mm quad, PX4 on an STM32H7, and a dedicated CSI camera into an Orin Nano. Range is monocular (box + AGL + pinhole). The local map is tracks, not a point cloud.

Vision Quest is the presentation layer for that airframe:

1. **Airframe** — exploded assembly. Hover a part for its name. Click for the spec sheet.
2. **Controller** — live attitude demo, PID bars, mixer, IMU axes.
3. **Vision FSD** — camera frustum, lock beam, detection pipeline, picture-in-picture.
4. **Pursuit** — oval track, Kalman-style track hold, chase / orbit / FPV.

**Skeleton** is the educational X-ray. **Finished** is the assembled product shot.

Keys: `1–4` modes · `Space` pause · `T` guided tour · `C` cutaway · `B` skeleton/finished · drag to orbit.

## Stack

React 19 · TanStack Start · Three.js · Zustand · Tailwind v4

Geometry is procedural (no GLB). Studio lighting, bloom, and CSS2D labels run in the browser.

Flight software lives in [hrishileo/HorizonVision](https://github.com/hrishileo/HorizonVision). This repo is the briefing, not the PX4 binary.

## Run

```bash
npm install
npm run dev
```

Then open the printed local URL. `npm run build` produces a production bundle; `npm run typecheck` is the type gate.

— Hrishikesh Garikapati
