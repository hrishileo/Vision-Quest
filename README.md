# Vision Quest

Interactive 3D briefing for **OSPREY**, a vision-FSD pursuit airframe.

Built to walk investors, friends, and employers through the machine — not a slide deck, a studio model you can explode, inspect, and watch run.

## What it is

OSPREY is a 650 mm class quad with a flight controller in the loop and a global-shutter camera feeding a vehicle tracker. Vision Quest is the presentation layer:

1. **Airframe** — exploded assembly. Hover a part for its name. Click for the spec sheet.
2. **Controller** — live attitude demo, PID bars, mixer, IMU axes.
3. **Vision FSD** — camera frustum, lock beam, detection pipeline, picture-in-picture.
4. **Pursuit** — oval track, Kalman-style track hold, chase / orbit / FPV.

Keys: `1–4` modes · `Space` pause · `T` guided tour · `C` cutaway · drag to orbit.

## Stack

React 19 · TanStack Start · Three.js · Zustand · Tailwind v4

Geometry is procedural (no GLB). Studio lighting, bloom, and CSS2D labels run in the browser.

## Run

```bash
npm install
npm run dev
```

Then open the printed local URL. `npm run build` produces a production bundle; `npm run typecheck` is the type gate.

## Repo

This is a presentation tool, not flight software. The PID / mixer / tracker here are educational kinematics — they show *how the loop is supposed to feel*, not a PX4 binary.

— Hrishikesh Garikapati
