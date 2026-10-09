"""Tailgating from consecutive vehicles in one lane.

Time headway is the gap between the leader's rear and the follower's front,
divided by the follower's speed. The recorder stores the rig origin and a
scalar lane speed. It does not store bumpers, so each vehicle is given a
centered length (default 4.4 m, the Mag Mile ``CAR_L``).

A pair is flagged only after the headway stays under the threshold for
``persist_s``. A stopped or creeping follower is queued traffic and is not
an event. Leaving the lane, or losing the same leader, starts the window over.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from horizon_vision.events.labels import FrameLabels, read_jsonl
from horizon_vision.events.schema import EventValidationError

# Vision-Quest ``city.ts`` ``CAR_L``. Spawned cars are a few tenths either side.
MAG_MILE_CAR_LENGTH_M = 4.4

# bound token → (east/south axis, sign). Along-track increases in the direction of travel.
_TRAVEL: dict[str, tuple[str, float]] = {
    "nb": ("y", -1.0),
    "sb": ("y", 1.0),
    "eb": ("x", 1.0),
    "wb": ("x", -1.0),
}

TAILGATE_EVENT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://horizonvision.local/schemas/tailgate-event.json",
    "title": "HorizonVisionTailgateEvent",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "follower_track_id",
        "leader_track_id",
        "lane",
        "headway_s",
        "gap_m",
        "follower_speed",
        "confidence",
        "t",
    ],
    "properties": {
        "follower_track_id": {"type": "string", "minLength": 1},
        "leader_track_id": {"type": "string", "minLength": 1},
        "lane": {"type": "string", "minLength": 1},
        "headway_s": {"type": "number", "minimum": 0},
        "gap_m": {"type": "number", "minimum": 0},
        "follower_speed": {"type": "number", "minimum": 0},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "t": {"type": "number"},
    },
}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True, slots=True)
class VehicleState:
    """One vehicle at one time. ``x`` is east and ``y`` is south, in metres.

    ``length`` is the along-track size, centered on ``(x, y)``. ``speed`` is
    the lane speed in m/s, in the lane's direction of travel.
    """

    track_id: str
    lane: str | None
    x: float
    y: float
    speed: float
    length: float = MAG_MILE_CAR_LENGTH_M


@dataclass(frozen=True, slots=True)
class _Pair:
    follower_track_id: str
    leader_track_id: str
    lane: str
    headway_s: float
    gap_m: float
    follower_speed: float


@dataclass(frozen=True, slots=True)
class TailgateEvent:
    """One confirmed following pair. ``headway_s`` is seconds, ``gap_m`` is metres."""

    follower_track_id: str
    leader_track_id: str
    lane: str
    headway_s: float
    gap_m: float
    follower_speed: float
    confidence: float
    t: float

    def __post_init__(self) -> None:
        errors = semantic_errors(self.to_dict())
        if errors:
            raise EventValidationError("; ".join(errors))

    def to_dict(self) -> dict[str, Any]:
        return {
            "follower_track_id": self.follower_track_id,
            "leader_track_id": self.leader_track_id,
            "lane": self.lane,
            "headway_s": self.headway_s,
            "gap_m": self.gap_m,
            "follower_speed": self.follower_speed,
            "confidence": self.confidence,
            "t": self.t,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TailgateEvent:
        errors = schema_errors(data) + semantic_errors(data)
        if errors:
            raise EventValidationError("; ".join(errors))
        return cls(
            follower_track_id=str(data["follower_track_id"]),
            leader_track_id=str(data["leader_track_id"]),
            lane=str(data["lane"]),
            headway_s=float(data["headway_s"]),
            gap_m=float(data["gap_m"]),
            follower_speed=float(data["follower_speed"]),
            confidence=float(data["confidence"]),
            t=float(data["t"]),
        )


def schema_errors(data: Mapping[str, Any]) -> list[str]:
    if not isinstance(data, Mapping):
        return ["event must be an object"]
    errors: list[str] = []
    props = TAILGATE_EVENT_JSON_SCHEMA["properties"]
    required = TAILGATE_EVENT_JSON_SCHEMA["required"]
    extra = set(data) - set(props)
    missing = [key for key in required if key not in data]
    if extra:
        errors.append(f"unexpected fields: {sorted(extra)}")
    if missing:
        errors.append(f"missing fields: {missing}")
        return errors
    for key, spec in props.items():
        value = data[key]
        if spec["type"] == "string":
            if not isinstance(value, str):
                errors.append(f"{key} has type {type(value).__name__}, expected string")
            elif len(value) < spec.get("minLength", 0):
                errors.append(f"{key} must be a non-empty string")
        elif spec["type"] == "number":
            if not _is_number(value):
                errors.append(f"{key} must be a finite number")
                continue
            if "minimum" in spec and value < spec["minimum"]:
                errors.append(f"{key} must be >= {spec['minimum']}")
            if "maximum" in spec and value > spec["maximum"]:
                errors.append(f"{key} must be <= {spec['maximum']}")
    return errors


def semantic_errors(data: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    follower = data.get("follower_track_id")
    leader = data.get("leader_track_id")
    if not isinstance(follower, str) or not follower:
        errors.append("follower_track_id must be a non-empty string")
    if not isinstance(leader, str) or not leader:
        errors.append("leader_track_id must be a non-empty string")
    if isinstance(follower, str) and follower and follower == leader:
        errors.append("follower_track_id and leader_track_id must differ")
    lane = data.get("lane")
    if not isinstance(lane, str) or not lane:
        errors.append("lane must be a non-empty string")
    for key, lower in (
        ("headway_s", 0),
        ("gap_m", 0),
        ("follower_speed", 0),
    ):
        if key in data and not _is_number(data[key]):
            errors.append(f"{key} must be a finite number")
        elif _is_number(data.get(key)) and data[key] < lower:
            errors.append(f"{key} must be >= {lower}")
    if "confidence" in data and not _is_number(data["confidence"]):
        errors.append("confidence must be a finite number")
    elif _is_number(data.get("confidence")) and not 0 <= data["confidence"] <= 1:
        errors.append("confidence must be in [0, 1]")
    if "t" in data and not _is_number(data["t"]):
        errors.append("t must be a finite number")
    return errors


def travel_of(lane: str) -> tuple[str, float] | None:
    """Return ``(axis, sign)`` for a ``{road}-{bound}-{index}`` lane id.

    ``axis`` is ``x`` (east) or ``y`` (south). ``sign`` is +1 when travel
    follows that axis. ``nb`` travels north (−south), ``sb`` south, ``eb``
    east, ``wb`` west.
    """
    parts = lane.split("-")
    if len(parts) != 3:
        return None
    return _TRAVEL.get(parts[1])


def _along(vehicle: VehicleState, axis: str, sign: float) -> float:
    coord = vehicle.x if axis == "x" else vehicle.y
    return sign * coord


@dataclass
class TailgateDetector:
    """Emit a tailgating event once a following pair has stayed too close.

    Headway is compared with a strict ``< threshold_s``. Speed at or below
    zero is never tailgating. Speed below ``min_speed_mps`` is treated as
    queued traffic (default 1 m/s). The pair must remain in violation from
    the first observing sample for at least ``persist_s`` seconds.
    """

    threshold_s: float = 2.0
    persist_s: float = 0.5
    min_speed_mps: float = 1.0
    vehicle_length_m: float = MAG_MILE_CAR_LENGTH_M
    confidence: float = 1.0
    _streaks: dict[tuple[str, str, str], float] = field(default_factory=dict)
    _last_t: float | None = None

    def __post_init__(self) -> None:
        if not math.isfinite(self.threshold_s) or self.threshold_s <= 0:
            raise ValueError("threshold_s must be positive")
        if not math.isfinite(self.persist_s) or self.persist_s < 0:
            raise ValueError("persist_s must be >= 0")
        if not math.isfinite(self.min_speed_mps) or self.min_speed_mps < 0:
            raise ValueError("min_speed_mps must be >= 0")
        if not math.isfinite(self.vehicle_length_m) or self.vehicle_length_m <= 0:
            raise ValueError("vehicle_length_m must be positive")
        if not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be in [0, 1]")

    def update(self, t: float, vehicles: list[VehicleState]) -> list[TailgateEvent]:
        if not math.isfinite(t):
            raise ValueError("t must be finite")
        if self._last_t is not None and t < self._last_t:
            raise ValueError("t went backwards")
        if self._last_t is not None and t == self._last_t:
            return []

        active = self._violations(vehicles)
        kept: dict[tuple[str, str, str], float] = {}
        events: list[TailgateEvent] = []
        for key, pair in active.items():
            start = self._streaks.get(key, t)
            kept[key] = start
            if t - start + 1e-9 >= self.persist_s:
                events.append(
                    TailgateEvent(
                        follower_track_id=pair.follower_track_id,
                        leader_track_id=pair.leader_track_id,
                        lane=pair.lane,
                        headway_s=pair.headway_s,
                        gap_m=pair.gap_m,
                        follower_speed=pair.follower_speed,
                        confidence=self.confidence,
                        t=t,
                    )
                )
        self._streaks = kept
        self._last_t = t
        events.sort(key=lambda event: (event.lane, event.follower_track_id, event.leader_track_id))
        return events

    def _violations(self, vehicles: list[VehicleState]) -> dict[tuple[str, str, str], _Pair]:
        by_id: dict[str, VehicleState] = {}
        for vehicle in vehicles:
            _check_vehicle(vehicle)
            if vehicle.lane is None:
                continue
            by_id[vehicle.track_id] = vehicle

        by_lane: dict[str, list[VehicleState]] = {}
        for vehicle in by_id.values():
            lane = vehicle.lane
            if lane is None or travel_of(lane) is None:
                continue
            by_lane.setdefault(lane, []).append(vehicle)

        found: dict[tuple[str, str, str], _Pair] = {}
        for lane, group in by_lane.items():
            travel = travel_of(lane)
            if travel is None:
                continue
            axis, sign = travel
            ordered = sorted(group, key=lambda vehicle: (-_along(vehicle, axis, sign), vehicle.track_id))
            for leader, follower in zip(ordered, ordered[1:]):
                pair = self._pair(leader, follower, axis, sign)
                if pair is None:
                    continue
                found[(pair.follower_track_id, pair.leader_track_id, pair.lane)] = pair
        return found

    def _pair(self, leader: VehicleState, follower: VehicleState, axis: str, sign: float) -> _Pair | None:
        if follower.speed <= 0 or follower.speed < self.min_speed_mps:
            return None
        lane = follower.lane
        if lane is None:
            return None
        gap = _along(leader, axis, sign) - _along(follower, axis, sign)
        gap -= (leader.length + follower.length) / 2.0
        if gap < 0:
            return None
        headway = gap / follower.speed
        if headway >= self.threshold_s:
            return None
        return _Pair(
            follower_track_id=follower.track_id,
            leader_track_id=leader.track_id,
            lane=lane,
            headway_s=headway,
            gap_m=gap,
            follower_speed=follower.speed,
        )


def _check_vehicle(vehicle: VehicleState) -> None:
    if not isinstance(vehicle.track_id, str) or not vehicle.track_id:
        raise ValueError("track_id must be a non-empty string")
    if vehicle.lane is not None and (not isinstance(vehicle.lane, str) or not vehicle.lane):
        raise ValueError("lane must be a non-empty string or null")
    for name, value in (("x", vehicle.x), ("y", vehicle.y), ("speed", vehicle.speed), ("length", vehicle.length)):
        if not math.isfinite(value):
            raise ValueError(f"{name} must be finite")
    if vehicle.speed < 0:
        raise ValueError("speed must be >= 0")
    if vehicle.length <= 0:
        raise ValueError("length must be positive")


def vehicles_from_frame(frame: FrameLabels, length_m: float = MAG_MILE_CAR_LENGTH_M) -> list[VehicleState]:
    """Vehicles with a travel lane. Debris and parked cars (null lane) are omitted."""
    vehicles: list[VehicleState] = []
    for obj in frame.objects:
        if obj.cls != "vehicle" or obj.lane is None or obj.truth_speed is None:
            continue
        vehicles.append(
            VehicleState(
                track_id=obj.track_id,
                lane=obj.lane,
                x=obj.truth_x,
                y=obj.truth_z,
                speed=obj.truth_speed,
                length=length_m,
            )
        )
    return vehicles


def detect_tailgates(
    frames: list[FrameLabels],
    detector: TailgateDetector | None = None,
) -> list[TailgateEvent]:
    book = detector if detector is not None else TailgateDetector()
    events: list[TailgateEvent] = []
    for frame in frames:
        events.extend(book.update(frame.t, vehicles_from_frame(frame, book.vehicle_length_m)))
    return events


def write_events(path: str | Path, events: list[TailgateEvent]) -> None:
    lines = [json.dumps(event.to_dict(), separators=(",", ":")) for event in events]
    text = ("\n".join(lines) + "\n") if lines else ""
    Path(path).write_text(text, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Flag tailgating in a recorder label file")
    parser.add_argument("--fixture", required=True, help="JSONL label file")
    parser.add_argument("--output", required=True, help="JSONL path for tailgating events")
    parser.add_argument("--threshold-s", type=float, default=2.0)
    parser.add_argument("--persist-s", type=float, default=0.5)
    parser.add_argument("--min-speed", type=float, default=1.0)
    parser.add_argument("--vehicle-length", type=float, default=MAG_MILE_CAR_LENGTH_M)
    args = parser.parse_args(argv)
    frames = read_jsonl(args.fixture)
    events = detect_tailgates(
        frames,
        TailgateDetector(
            threshold_s=args.threshold_s,
            persist_s=args.persist_s,
            min_speed_mps=args.min_speed,
            vehicle_length_m=args.vehicle_length,
        ),
    )
    write_events(args.output, events)
    print(f"frames: {len(frames)}")
    print(f"tailgate events: {len(events)}")
    for event in events[:3]:
        print(json.dumps(event.to_dict()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
