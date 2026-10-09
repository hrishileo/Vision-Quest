# Live drone data → phone / GPS (future, not now)

Goal: a real drone computer publishes **live, georeferenced hazards** so phones and car GPS can **reroute and warn**. This is not the Pursuit sim. Simulated JSON is for development only.

## What must change from the sim

| Today (sim / v0.2) | Required on a real drone |
| --- | --- |
| Fake cars in a local XYZ scene | Real LiDAR + camera detections |
| Local XYZ in the Pursuit scene | WGS84 lat / lon / heading / altitude |
| Export JSON by hand | Continuous uplink while flying |
| Boxes in a 3D viewer | Standard road events other apps can consume |

The Python pipeline in `edge/src/horizon_vision/` is the on-drone piece. Pursuit stays a lab tool.

## Data path

```
Drone GNSS + IMU + LiDAR + Camera
        │
        ▼
Edge computer (Jetson)
  1. detect objects (car, pedestrian, debris, blockage)
  2. score confidence + persistence (N frames)
  3. transform box center: sensor → vehicle → ENU → WGS84
  4. classify as a road event
        │
        ▼
Cellular / 5G / Starlink  →  Horizon cloud ingest (HTTPS or MQTT)
        │
        ▼
Dedupe, expire, snap to map, safety filter
        │
        ├── Horizon phone app  (fastest, we control the UI)
        ├── Partner feeds      (Waze CCP, Google, HERE, TomTom)
        └── Electronic horizon (ADASIS / NDS.Live → car head units)
```

Do **not** inject raw NMEA into random Garmin/phone GPS. Consumer GPS units do not accept unofficial “here is a hazard” sentences. They consume a **map/traffic API** or a **companion app**.

## Event we will publish (target schema)

One event per confirmed hazard, not a point cloud.

```json
{
  "id": "hv-20260815-000184",
  "type": "pedestrian_in_roadway",
  "severity": "high",
  "confidence": 0.87,
  "lat": 37.3382,
  "lon": -121.8863,
  "heading_deg": 178,
  "lane": "2",
  "road_name": "optional",
  "radius_m": 25,
  "valid_from": "2026-08-15T09:21:04Z",
  "valid_to": "2026-08-15T09:26:04Z",
  "source": "drone-alpha",
  "advice": "slow_or_reroute"
}
```

Allowed `type` values (start small):

- `stopped_vehicle`
- `lane_departure` / `vehicle_in_wrong_lane`
- `pedestrian_in_roadway`
- `road_blockage`
- `debris`

Cloud must **expire** events (2–5 minutes unless re-seen). Stale hazards cause bad reroutes.

## Phone / GPS delivery options (in order)

1. **Horizon mobile app** — we stream events and draw them on the user’s map; can trigger local navigation reroute via Google/Apple Maps deep links or in-app routing.
2. **Car display** — same stream over the phone (CarPlay / Android Auto) or later ADASIS electronic horizon into OEM nav.
3. **Third-party GPS / Waze / Google** — only via their official partner APIs. We cannot silently rewrite someone else’s GPS track.

“Other GPS devices” only work if they already pull a traffic/incident feed we can join, or if the driver uses our app.

## On-drone requirements (when we do this)

- Dual-frequency GNSS + IMU on the drone (RTK if we can get it)
- Time sync (PTP or GPS time) between LiDAR, camera, GNSS
- Extrinsics: LiDAR ↔ camera ↔ IMU calibrated
- `edge/src/horizon_vision` real drivers (Livox/Ouster + camera), not `simulate: true`
- Edge model (TensorRT) that outputs 3D boxes + class
- Uplink client: MQTT or HTTPS POST of the event schema above
- Fail-closed: if confidence < threshold or GNSS fix is poor, **do not publish**

## Safety rules

- False positives can shove cars into worse roads. Require multi-frame confirmation.
- Never publish faces, plates, or raw video to phones. Events only.
- Drone flight over public roads needs local aviation + privacy clearance.
- Treat this as a **warning / incident feed**, not as primary vehicle control.

## Build order (later)

1. Real sensors + georeferenced detections on the Jetson (keep logging locally).
2. Event publisher + cloud ingest + expiry.
3. Horizon phone app shows live hazards.
4. Optional: partner traffic APIs and car electronic horizon.
