# Horizon Vision Architecture

## High-Level Data Flow

```
Drone
 ├── 3D LiDAR  ──┐
 ├── Camera    ──┤
 └── GNSS/IMU  ──┼──► Edge Computer (Jetson)
                 │         │
                 │         ├── Sensor Drivers
                 │         ├── Sensor Fusion
                 │         ├── Edge AI Engine (detection / segmentation)
                 │         ├── Georeference (sensor → WGS84)
                 │         └── Local Map Builder
                 │
                 └──► Confirmed road events (not raw sim frames)
                              │
                              ▼
                     Horizon cloud (dedupe + expire)
                              │
                     Phone app / car display / partner GPS feeds
```

Lab path today: Mag Mile labels (ground truth) feed the camera-only edge contract in `docs/edge-events.md`. Code lives in `edge/` and `hub/`. The old `web/` LiDAR viewer was not ported; Pursuit in this repo is the sim. Unmerged LiDAR ingest, clustering, and the occupancy grid are in `edge/legacy/` and are not on this path.
Flight path later: see `docs/phone-gps-live.md`.

## Current Status (v0.2)

- Abstract LiDAR and Camera drivers (simulated for now)
- Sensor fusion package
- Edge AI engine with placeholder 3D detections
- Rolling local map
- Pursuit briefing in this repo (the lab sim)
- Clean entry point ready for real hardware drivers (`python -m horizon_vision.main`)

## Next Steps

1. Replace simulated drivers with real LiDAR (Livox / Velodyne) and camera
2. Integrate TensorRT or ONNX models for real 3D object detection
3. Add GNSS/IMU and publish georeferenced events (not simulated XYZ)
4. Stream events to a Horizon phone app, then partner GPS / electronic horizon
5. Add ROS 2 wrappers when hardware integration starts
