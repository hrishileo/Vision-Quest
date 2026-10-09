"""Hold labels by track id, smooth them, and emit one event per confirmed track.

Hits accumulate while the track is alive. A track drops after ``max_misses``
consecutive frames where its id is absent, and must collect ``min_hits``
again before it emits. Duplicate ids in one frame count as a single hit.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from horizon_vision.events.schema import EdgeEvent


@dataclass(frozen=True, slots=True)
class Observation:
    track_id: str
    x: float
    y: float
    cls: str
    unknown: bool
    lane: str | None
    confidence: float


@dataclass
class _Track:
    track_id: str
    cls: str
    unknown: bool
    lane: str | None
    confidence: float
    x: float
    y: float
    raw_x: float
    raw_y: float
    last_t: float
    hits: int = 1
    misses: int = 0
    speed: float | None = None


@dataclass
class TrackBook:
    """In-memory tracks for one camera stream."""

    min_hits: int = 3
    max_misses: int = 5
    alpha: float = 0.5
    _tracks: dict[str, _Track] = field(default_factory=dict)
    _last_t: float | None = None

    def __post_init__(self) -> None:
        if self.min_hits < 2:
            raise ValueError("min_hits must be at least 2 so speed exists before emit")
        if self.max_misses < 1:
            raise ValueError("max_misses must be at least 1")
        if not 0 < self.alpha <= 1:
            raise ValueError("alpha must be in (0, 1]")

    @property
    def track_ids(self) -> frozenset[str]:
        return frozenset(self._tracks)

    def speed_of(self, track_id: str) -> float | None:
        track = self._tracks.get(track_id)
        if track is None:
            return None
        return track.speed

    def smoothed_position(self, track_id: str) -> tuple[float, float] | None:
        track = self._tracks.get(track_id)
        if track is None:
            return None
        return (track.x, track.y)

    def update(self, t: float, observations: list[Observation]) -> list[EdgeEvent]:
        if not math.isfinite(t):
            raise ValueError("t must be finite")
        if self._last_t is not None and t < self._last_t:
            raise ValueError("t went backwards")
        if self._last_t is not None and t == self._last_t:
            return []

        by_id: dict[str, Observation] = {}
        for obs in observations:
            by_id[obs.track_id] = obs

        for track_id in [tid for tid in self._tracks if tid not in by_id]:
            track = self._tracks[track_id]
            track.misses += 1
            if track.misses >= self.max_misses:
                del self._tracks[track_id]

        events: list[EdgeEvent] = []
        for track_id, obs in by_id.items():
            track = self._tracks.get(track_id)
            if track is None:
                self._tracks[track_id] = _Track(
                    track_id=track_id,
                    cls=obs.cls,
                    unknown=obs.unknown,
                    lane=obs.lane,
                    confidence=obs.confidence,
                    x=obs.x,
                    y=obs.y,
                    raw_x=obs.x,
                    raw_y=obs.y,
                    last_t=t,
                )
                continue

            dt = t - track.last_t
            if dt > 0:
                step = math.hypot(obs.x - track.raw_x, obs.y - track.raw_y) / dt
                track.speed = step if track.speed is None else (
                    self.alpha * step + (1.0 - self.alpha) * track.speed
                )
            track.x = self.alpha * obs.x + (1.0 - self.alpha) * track.x
            track.y = self.alpha * obs.y + (1.0 - self.alpha) * track.y
            track.raw_x = obs.x
            track.raw_y = obs.y
            track.last_t = t
            track.hits += 1
            track.misses = 0
            track.cls = obs.cls
            track.unknown = obs.unknown
            track.lane = obs.lane
            track.confidence = obs.confidence
            if track.hits >= self.min_hits and track.speed is not None:
                events.append(
                    EdgeEvent(
                        cls=track.cls,
                        unknown=track.unknown,
                        x=track.x,
                        y=track.y,
                        speed=track.speed,
                        lane=track.lane,
                        confidence=track.confidence,
                        t=t,
                        track_id=track.track_id,
                    )
                )

        self._last_t = t
        events.sort(key=lambda event: event.track_id)
        return events
