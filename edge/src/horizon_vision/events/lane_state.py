"""Lane state from tracked edge events.

A hub-side router reads one object per lane. ``state`` is the travel decision.
``speed`` is the mean of the confident tracks in that lane, in m/s, and is
null when the state is ``unknown``.

Priority, first match:

1. Nothing observed inside ``stale_s``, or every current observation is below
   ``min_confidence`` → ``unknown``. Never ``clear``.
2. A vehicle or ``unknown`` track has stayed in this lane, at or under
   ``stationary_mps``, and inside ``stationary_radius_m`` of where that
   dwell started, for at least ``hold_s`` → ``blocked``.
3. Mean speed is below ``slow_mps`` → ``slow``.
4. Otherwise → ``clear``.

A low-confidence sample does not start or extend a dwell. Changing lane,
moving off the anchor, or a gap longer than ``max_gap_s`` starts it over.
One sample cannot finish a hold (``hold_s`` must be positive).

While frames are still arriving, a lane with no new observation keeps its
last state until ``stale_s`` has passed, then becomes ``unknown``. A lane
that has never been seen is not emitted. Absence is not ``clear``.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from horizon_vision.events.labels import FrameLabels
from horizon_vision.events.pipeline import run_label_pipeline
from horizon_vision.events.schema import EdgeEvent
from horizon_vision.events.tracking import TrackBook

STATES = ("blocked", "slow", "clear", "unknown")

LANE_STATE_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://horizonvision.local/schemas/lane-state.json",
    "title": "HorizonVisionLaneState",
    "type": "object",
    "additionalProperties": False,
    "required": ["lane", "state", "speed", "confidence", "t"],
    "properties": {
        "lane": {"type": "string", "minLength": 1},
        "state": {"type": "string", "enum": list(STATES)},
        "speed": {"type": ["number", "null"], "minimum": 0},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "t": {"type": "number"},
    },
    "allOf": [
        {
            "if": {"properties": {"state": {"const": "unknown"}}, "required": ["state"]},
            "then": {"properties": {"speed": {"type": "null"}}},
        },
        {
            "if": {"properties": {"speed": {"type": "null"}}, "required": ["speed"]},
            "then": {"properties": {"state": {"const": "unknown"}}},
        },
    ],
}


class LaneStateValidationError(ValueError):
    """A lane-state event failed the contract."""


def lane_state_json_schema() -> dict[str, Any]:
    return LANE_STATE_JSON_SCHEMA


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True, slots=True)
class LaneStateEvent:
    """One lane at one evaluation time. ``speed`` is null when ``state`` is unknown."""

    lane: str
    state: str
    speed: float | None
    confidence: float
    t: float

    def __post_init__(self) -> None:
        errors = lane_state_errors(self.to_dict())
        if errors:
            raise LaneStateValidationError("; ".join(errors))

    def to_dict(self) -> dict[str, Any]:
        return {
            "lane": self.lane,
            "state": self.state,
            "speed": self.speed,
            "confidence": self.confidence,
            "t": self.t,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> LaneStateEvent:
        errors = lane_state_errors(data)
        if errors:
            raise LaneStateValidationError("; ".join(errors))
        speed = data["speed"]
        return cls(
            lane=str(data["lane"]),
            state=str(data["state"]),
            speed=None if speed is None else float(speed),
            confidence=float(data["confidence"]),
            t=float(data["t"]),
        )


def lane_state_errors(data: Mapping[str, Any]) -> list[str]:
    """Structural and cross-field checks for one lane-state object."""
    if not isinstance(data, Mapping):
        return ["lane state must be an object"]
    errors: list[str] = []
    required = LANE_STATE_JSON_SCHEMA["required"]
    extra = set(data) - set(LANE_STATE_JSON_SCHEMA["properties"])
    missing = [key for key in required if key not in data]
    if extra:
        errors.append(f"unexpected fields: {sorted(extra)}")
    if missing:
        errors.append(f"missing fields: {missing}")
        return errors

    lane = data["lane"]
    state = data["state"]
    speed = data["speed"]
    confidence = data["confidence"]
    t = data["t"]
    if not isinstance(lane, str) or not lane:
        errors.append("lane must be a non-empty string")
    if state not in STATES:
        errors.append(f"state must be one of {STATES}")
    if speed is not None and not _is_number(speed):
        errors.append("speed must be a finite number or null")
    if _is_number(speed) and speed < 0:
        errors.append("speed must be >= 0")
    if not _is_number(confidence):
        errors.append("confidence must be a finite number")
    elif not 0 <= confidence <= 1:
        errors.append("confidence must be in [0, 1]")
    if not _is_number(t):
        errors.append("t must be a finite number")
    if state == "unknown" and speed is not None:
        errors.append("state 'unknown' requires speed null")
    if speed is None and state != "unknown":
        errors.append("null speed requires state 'unknown'")
    return errors


def lane_states_jsonl(events: Sequence[LaneStateEvent]) -> str:
    return "".join(json.dumps(event.to_dict()) + "\n" for event in events)


@dataclass
class _Episode:
    lane: str
    since: float
    anchor_x: float
    anchor_y: float
    last_t: float


@dataclass
class _LaneMemory:
    last_obs_t: float
    state: str
    speed: float | None
    confidence: float


@dataclass
class LaneMonitor:
    """Fold a stream of per-track events into per-lane states.

    Defaults are sized for the Mag Mile sim: free-flow traffic is several
    metres per second, and a stopped object must sit still for a second and
    a half before the lane is blocked. ``min_confidence`` is 0.2 because a
    stopped car in the CAM0 sample stays under 0.1 m/s while its ray
    confidence climbs through that floor. Shallower rays stay ``unknown``.
    """

    hold_s: float = 1.5
    stationary_mps: float = 0.5
    slow_mps: float = 4.0
    stale_s: float = 1.0
    min_confidence: float = 0.2
    stationary_radius_m: float = 4.0
    max_gap_s: float = 0.5
    _episodes: dict[str, _Episode] = field(default_factory=dict)
    _lanes: dict[str, _LaneMemory] = field(default_factory=dict)
    _last_t: float | None = None

    def __post_init__(self) -> None:
        if self.hold_s <= 0:
            raise ValueError("hold_s must be positive so one sample cannot block a lane")
        if self.stationary_mps < 0:
            raise ValueError("stationary_mps must be >= 0")
        if self.slow_mps <= self.stationary_mps:
            raise ValueError("slow_mps must be above stationary_mps")
        if self.stale_s <= 0:
            raise ValueError("stale_s must be positive")
        if not 0 <= self.min_confidence <= 1:
            raise ValueError("min_confidence must be in [0, 1]")
        if self.stationary_radius_m < 0:
            raise ValueError("stationary_radius_m must be >= 0")
        if self.max_gap_s < 0:
            raise ValueError("max_gap_s must be >= 0")

    def update(self, t: float, tracks: Sequence[EdgeEvent]) -> list[LaneStateEvent]:
        if not math.isfinite(t):
            raise ValueError("t must be finite")
        if self._last_t is not None and t < self._last_t:
            raise ValueError("t went backwards")
        if self._last_t is not None and t == self._last_t:
            return []

        latest: dict[str, EdgeEvent] = {}
        for event in tracks:
            latest[event.track_id] = event

        by_lane: dict[str, list[EdgeEvent]] = defaultdict(list)
        for event in latest.values():
            self._note_dwell(event, t)
            if event.lane is not None:
                by_lane[event.lane].append(event)

        for lane, events in by_lane.items():
            self._lanes[lane] = self._assess(events, t)

        emitted: list[LaneStateEvent] = []
        for lane in sorted(self._lanes):
            memory = self._lanes[lane]
            if lane not in by_lane and t - memory.last_obs_t > self.stale_s:
                memory = _LaneMemory(
                    last_obs_t=memory.last_obs_t,
                    state="unknown",
                    speed=None,
                    confidence=0.0,
                )
                self._lanes[lane] = memory
            emitted.append(
                LaneStateEvent(
                    lane=lane,
                    state=memory.state,
                    speed=memory.speed,
                    confidence=memory.confidence,
                    t=t,
                )
            )

        self._last_t = t
        return emitted

    def _note_dwell(self, event: EdgeEvent, t: float) -> None:
        qualifying = (
            event.lane is not None
            and event.cls in ("vehicle", "unknown")
            and event.confidence >= self.min_confidence
            and event.speed <= self.stationary_mps
        )
        episode = self._episodes.get(event.track_id)
        if not qualifying:
            self._episodes.pop(event.track_id, None)
            return
        assert event.lane is not None
        moved = (
            episode is not None
            and math.hypot(event.x - episode.anchor_x, event.y - episode.anchor_y)
            > self.stationary_radius_m
        )
        broken = (
            episode is None
            or episode.lane != event.lane
            or (t - episode.last_t) > self.max_gap_s
            or moved
        )
        if broken:
            self._episodes[event.track_id] = _Episode(
                lane=event.lane,
                since=t,
                anchor_x=event.x,
                anchor_y=event.y,
                last_t=t,
            )
            return
        assert episode is not None
        episode.last_t = t

    def _blocking(self, event: EdgeEvent, t: float) -> bool:
        episode = self._episodes.get(event.track_id)
        if episode is None or episode.lane != event.lane:
            return False
        if event.confidence < self.min_confidence or event.speed > self.stationary_mps:
            return False
        return (t - episode.since) >= self.hold_s

    def _assess(self, events: list[EdgeEvent], t: float) -> _LaneMemory:
        qualifying = [event for event in events if event.confidence >= self.min_confidence]
        if not qualifying:
            return _LaneMemory(
                last_obs_t=t,
                state="unknown",
                speed=None,
                confidence=max(event.confidence for event in events),
            )
        speed = sum(event.speed for event in qualifying) / len(qualifying)
        confidence = sum(event.confidence for event in qualifying) / len(qualifying)
        if any(self._blocking(event, t) for event in qualifying):
            state = "blocked"
        elif speed < self.slow_mps:
            state = "slow"
        else:
            state = "clear"
        return _LaneMemory(last_obs_t=t, state=state, speed=speed, confidence=confidence)


def collect_lane_states(
    frames: list[FrameLabels],
    book: TrackBook | None = None,
    monitor: LaneMonitor | None = None,
) -> list[LaneStateEvent]:
    """Project labels to tracks, then evaluate every frame time.

    Frames that emit no track still advance the clock, so a lane can go stale.
    """
    tracker = book if book is not None else TrackBook()
    lane_monitor = monitor if monitor is not None else LaneMonitor()
    result = run_label_pipeline(frames, tracker)
    by_t: dict[float, list[EdgeEvent]] = defaultdict(list)
    for event in result.events:
        by_t[event.t].append(event)
    states: list[LaneStateEvent] = []
    for frame in frames:
        states.extend(lane_monitor.update(frame.t, by_t.get(frame.t, [])))
    return states
