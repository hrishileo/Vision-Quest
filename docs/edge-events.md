# Camera-only edge events

The product path on the Jetson Orin Nano is monocular. LiDAR driver stubs
under `edge/src/horizon_vision/sensors` are not used here. Unmerged ingest,
clustering, and the occupancy grid are parked in `edge/legacy/` and are not
imported. Georeferencing into the phone/GPS incident feed
(`docs/phone-gps-live.md`) is later: this contract is the local event the
edge publishes first.

Sim input is a **label** stream from the Vision-Quest Mag Mile recorder
(JSON Lines, one object-list per frame). Those records are ground truth for
scoring. The pipeline does not publish a label's true position as the event.

## Event

```json
{
  "class": "unknown",
  "unknown": true,
  "x": 9.0,
  "y": 16.0,
  "speed": 0.0,
  "lane": "mich-nb-2",
  "confidence": 0.62,
  "t": 1.2,
  "track_id": "deb-barrier"
}
```

| Field | Meaning |
| --- | --- |
| `class` | `vehicle` or `unknown` |
| `unknown` | `true` exactly when `class` is `unknown` |
| `x`, `y` | Metres east and south on the ground plane |
| `speed` | Non-negative m/s |
| `lane` | Lane id, or `null` |
| `confidence` | 0–1, from how steeply the ray hits the ground |
| `t` | Seconds |
| `track_id` | Persistent id |

Debris and blockades are always `unknown`. They still carry `x`, `y`, `lane`,
and `t` so a hub can warn that a lane is blocked. The real type (`barrier`,
`tire`, …) and kind (`debris` or `blockade`) stay on the label. They are not
event fields.

`x`/`y` match the Mag Mile ground axes: world `+X` east, `+Y` up, `+Z` south,
so event `y` is world `Z`.

The JSON Schema object lives at `EDGE_EVENT_JSON_SCHEMA` in
`horizon_vision.events.schema`.

## Lane state

The hub package `horizon_vision.hub` costs lanes from this event, not from the
per-track events above. `state` is the travel decision. `speed` is the mean
of the confident tracks in the lane, in m/s, and is null exactly when
`state` is `unknown`.

```json
{"lane": "chi-wb-0", "state": "blocked", "speed": 0.068, "confidence": 0.393, "t": 3.867}
```

| Field | Meaning |
| --- | --- |
| `lane` | Lane id. Never null. A lane that has not been seen is omitted, and omission is not `clear`. |
| `state` | `blocked`, `slow`, `clear`, or `unknown` |
| `speed` | Mean speed (m/s) of the confident tracks in the lane. Null exactly when `state` is `unknown`. |
| `confidence` | 0–1. Mean of the tracks that supported the decision, or 0 when the lane has gone stale. |
| `t` | Seconds, the frame time the state was evaluated. |

JSON Schema: `LANE_STATE_JSON_SCHEMA` in `horizon_vision.events.lane_state`.
The hub reads the same five fields in `lane_state_from_mapping`.

How `horizon_vision.hub.graph.travel_time_s` costs the lane:

| `state` | Travel |
| --- | --- |
| `blocked` | Impassable, when the reading is trusted. Do not divide by `speed`. |
| `slow` | `length / speed`, capped at the edge speed limit. A null or zero speed is impassable. |
| `clear` | Free-flow time (`length / speed limit`). The published `speed` is not the cost. |
| `unknown` | Cautious. Free-flow times `cautious_factor` (default 2). Worse than clear, never the free-flow cost. `speed` is null and is not used. |

The hub also treats a reading as untrusted when its confidence is below the
hub floor (default 0.5) or its `t` is older than `max_age_s`. Untrusted
readings use the same cautious cost as `unknown`, even if the payload says
`clear` or `blocked`. The edge applies its own, lower floor before it will
emit `clear`, `slow`, or `blocked`.

The edge decision, first match:

1. No observation of the lane within `stale_s`, or every current track is below `min_confidence` → `unknown`. This is never `clear`.
2. A `vehicle` or `unknown` track has stayed in this same lane, at or under `stationary_mps`, and within `stationary_radius_m` of where that dwell began, for at least `hold_s` → `blocked`.
3. Mean speed is below `slow_mps` → `slow`.
4. Otherwise → `clear`.

A sample below `min_confidence` does not start or extend a dwell, so a short low-confidence blip cannot block a lane and cannot clear it. Changing lane, leaving the anchor radius, or a gap longer than `max_gap_s` starts the dwell over. `hold_s` is positive, so one sample is never enough.

Until the dwell finishes, a stopped track still counts in the mean. A lane whose only confident track is stopped is `slow`, then `blocked` once the hold elapses. Other confident tracks in the same lane keep the mean up; `blocked` still wins when any one of them finishes a dwell.

Defaults: hold 1.5 s, stationary ≤ 0.5 m/s, radius 4 m, slow below 4.0 m/s, stale 1.0 s, minimum confidence 0.2, maximum gap inside a dwell 0.5 s. The confidence floor is 0.2 because stopped cars in the CAM0 sample stay under 0.1 m/s while the ray confidence climbs through that value. Rays shallower than 0.2 stay `unknown`.

The closed loop (`npm run loop`) opts into a stricter closure: `block_classes` is `unknown` only, so a stalled or queued vehicle stays `slow`, and debris may dwell at confidence 0.05. The hub side of that loop trusts a `blocked` reading down to 0.2, which is the edge's publish floor, and it drops an alert whose reason does not name a blocked lane. A brief `slow` reading on a southbound lane does not send that driver around the closure. The defaults above are unchanged. A camera pitched above the horizon still cannot close a lane, because the ground ray does not descend.

Within the stale window, a lane with no new track keeps the last state so a one-frame miss does not flicker. After the window it becomes `unknown` with confidence 0.

## Label file

The parser in `horizon_vision.events.labels` reads the CAM0 JSONL from
Vision-Quest (`labels.jsonl`, schema 1). Y is up. The ground plane is the
world x/z plane at `y = 0`. A frame looks like:

```json
{
  "schema": 1,
  "groundTruth": true,
  "t": 1.167,
  "camera": {
    "position": {"x": 5.5, "y": 7.28, "z": 34.7},
    "agl": 7.28,
    "yaw": 0.0,
    "pitch": -0.39,
    "roll": 0.0,
    "intrinsics": {"fovY": 70, "width": 960, "height": 540, "fx": 385.6, "fy": 385.6, "cx": 480, "cy": 270}
  },
  "objects": [
    {
      "trackId": "veh-0",
      "class": "vehicle",
      "type": "vehicle",
      "kind": null,
      "laneId": "mich-nb-1",
      "position": {"x": 5.5, "y": 0, "z": 18.4},
      "speed": 8.7,
      "bbox": {"x": 458.8, "y": 242.9, "w": 42.4, "h": 61.2}
    },
    {
      "trackId": "deb-0",
      "class": "unknown",
      "type": "tire",
      "kind": "debris",
      "laneId": "mich-nb-2",
      "position": {"x": 9.0, "y": 0, "z": 16.0},
      "speed": null,
      "bbox": {"x": 500, "y": 260, "w": 20, "h": 16}
    }
  ]
}
```

`laneId` is the scene's 0-indexed id: `mich-nb-0` … `mich-sb-2`, `chi-eb-0` …
`chi-wb-1`, `rush-nb-0`, `rush-nb-1`, `conn-wb-0`, or `null` when the ground
point is off every travel lane. Debris uses the same field. `bbox` is
`{x, y, w, h}` from the top-left of the image. `position.y` is up and is 0
for a rig origin on the ground. `file` / `labelFile` name media and are not
read. The placeholder keys (`camera.pose`, `track_id`, `lane`, a bbox list)
still parse.

## Pipeline

1. Parse labels.
2. Cast the box’s bottom-center pixel through the CAM0 pinhole (Three.js YXZ,
   looking down local −Z) and intersect it with the ground plane `agl` metres
   below the camera. On recorder frames that plane is `y = 0`.
3. Hold a track per id. Smooth position and speed (exponential, default
   α = 0.5). Speed is the smoothed magnitude of the raw ground-plane step.
4. Emit one event per track per new timestamp after `min_hits` (default 3).
   Duplicate ids in a single frame are one hit. A second update at the same
   timestamp emits nothing.
5. Drop a track after `max_misses` consecutive frames without that id
   (default 5). It must reach `min_hits` again before it emits.
6. Fold those tracks into one lane-state event per seen lane at each frame
   time. Empty frames still advance the clock so a lane can go stale.

Published `x`/`y` are the smoothed estimates. The accuracy script scores
the raw ground-plane position, the smoothed position on the emitted event,
and the tracked speed against the label.

On a recorder frame the label `position` is the rig origin, while the ray
uses the bottom-center of the projected mesh. For a car that point is the
near edge, about half a vehicle length from the origin, so the position
error stays on the order of a couple of metres even when the ray is right.
A box whose bottom-center is the true ground point (the synthetic fixture)
comes back with only numerical error.

## Run

```bash
pip install -r edge/requirements-dev.txt
python -m pytest
PYTHONPATH=edge/src:hub/src python -m horizon_vision.events.report \
  --fixture src/lib/guide/__fixtures__/cam0-sample.labels.jsonl
PYTHONPATH=edge/src:hub/src python -m horizon_vision.events.lane_report \
  --fixture src/lib/guide/__fixtures__/cam0-sample.labels.jsonl
```

`src/lib/guide/__fixtures__/cam0-sample.labels.jsonl` is the CAM0 label sample
(no images). The edge tests read that file; it is not copied under
`edge/tests/fixtures/`. Debris in that capture is off every travel lane
(`laneId` null), so it does not block a lane. Stopped vehicles do: `chi-wb-0`
and `chi-wb-1` finish a dwell and stay `blocked`, and `chi-eb-0` is `blocked`
until the tracked speed climbs. Shallow rays (`mich-nb-0`) stay `unknown`.
The committed lane-state output is `edge/tests/fixtures/cam0_lane_states.jsonl`.

`edge/tests/fixtures/mag_mile_labels.jsonl` is a short synthetic clip whose boxes
are the same pinhole applied to known ground points, used to check round-trip
error. Closed-form geometry is in `edge/tests/test_monocular.py`.

`edge/tests/fixtures/synthetic_blockade_labels.jsonl` is not a capture. The first
line says so. It uses the recorder's keys. A barrier (`unknown`, kind
`blockade`) is held in `mich-nb-2`, a car cruises `mich-nb-1`, and another
crawls `mich-sb-1`. Boxes are the ground-contact projection, so the tracks
match the truth and the run emits `blocked`, `clear`, and `slow`
(`edge/tests/fixtures/synthetic_blockade_lane_states.jsonl`).

## Tailgating

For consecutive vehicles in the same lane, time headway is the gap between
the leader's rear and the follower's front, divided by the follower's speed.
The corpus stores the rig origin, not the bumpers, and does not export
length. The gap uses a centered length (default 4.4 m, Mag Mile `CAR_L`).
Only `class: vehicle` rows are paired. Debris keeps its `laneId` on the
label and is not a leader or a follower.

Flag when headway is strictly below a threshold (default 2.0 s) and the
follower is moving (default speed ≥ 1.0 m/s). A stopped or creeping follower
is queued traffic and is not an event. A stopped leader does not change the
test: headway uses the follower's speed only.

The same follower, leader, and lane must stay under the threshold for
`persist_s` (default 0.5 s) before the first event, and on each later frame
while that holds. A one-frame dip does not emit. A lane change, or a new
leader, starts the window over. Only adjacent vehicles are paired. Travel
direction comes from the scene lane id (`nb` toward −Z, `sb` toward +Z,
`eb` toward +X, `wb` toward −X). A non-positive gap is not a following gap.

`confidence` is 1 when the positions and speeds are ground-truth labels.
The JSON Schema object is `TAILGATE_EVENT_JSON_SCHEMA`.

```json
{
  "follower_track_id": "veh-13",
  "leader_track_id": "veh-12",
  "lane": "mich-sb-0",
  "headway_s": 1.5894965934823853,
  "gap_m": 11.365969744954844,
  "follower_speed": 7.15067260386727,
  "confidence": 1.0,
  "t": 1.6666666666666685
}
```

```bash
PYTHONPATH=edge/src:hub/src python -m horizon_vision.events.tailgate \
  --fixture src/lib/guide/__fixtures__/cam0-sample.labels.jsonl \
  --output edge/tests/fixtures/cam0_tailgate_events.jsonl
```

That CAM0 sample already contains close following under 2 s, including
`veh-13` behind `veh-12` in `mich-sb-0`. The edge cases (open gap, stopped
traffic, a shorter threshold, a one-frame blip, a lane change) are unit
tests, not a second label file.
