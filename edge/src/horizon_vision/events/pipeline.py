"""Turn per-frame labels into tracked events.

Position on the wire comes from the monocular ground-plane estimate.
The label's true position and speed stay on the scored sample for the
accuracy check. They are not copied onto the event.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from horizon_vision.events.labels import FrameLabels
from horizon_vision.events.monocular import estimate_ground_point
from horizon_vision.events.schema import EdgeEvent
from horizon_vision.events.tracking import Observation, TrackBook


@dataclass(frozen=True, slots=True)
class ScoredSample:
    """One labeled object that produced a ground-plane estimate."""

    t: float
    track_id: str
    est_x: float
    est_y: float
    est_speed: float | None
    truth_x: float
    truth_y: float
    truth_speed: float | None
    projected: bool = True
    cls: str = "vehicle"
    range_m: float = 0.0


@dataclass(frozen=True, slots=True)
class PipelineResult:
    events: list[EdgeEvent]
    samples: list[ScoredSample]
    frames: int
    labels: int
    projected: int


def run_label_pipeline(
    frames: list[FrameLabels],
    book: TrackBook | None = None,
) -> PipelineResult:
    tracker = book if book is not None else TrackBook()
    events: list[EdgeEvent] = []
    samples: list[ScoredSample] = []
    label_count = 0
    projected = 0

    for frame in frames:
        observations: list[Observation] = []
        pending: list[ScoredSample] = []
        for obj in frame.objects:
            label_count += 1
            estimate = estimate_ground_point(obj.bbox, frame.pose, frame.intrinsics)
            if estimate is None:
                continue
            projected += 1
            observations.append(
                Observation(
                    track_id=obj.track_id,
                    x=estimate.x,
                    y=estimate.y,
                    cls=obj.cls,
                    unknown=obj.unknown,
                    lane=obj.lane,
                    confidence=estimate.confidence,
                )
            )
            truth_x, truth_y = obj.truth_ground
            pending.append(
                ScoredSample(
                    t=frame.t,
                    track_id=obj.track_id,
                    est_x=estimate.x,
                    est_y=estimate.y,
                    est_speed=None,
                    truth_x=truth_x,
                    truth_y=truth_y,
                    truth_speed=0.0 if obj.truth_speed is None else obj.truth_speed,
                    cls=obj.cls,
                    range_m=math.hypot(truth_x - frame.pose.x, truth_y - frame.pose.z),
                )
            )

        events.extend(tracker.update(frame.t, observations))
        for sample in pending:
            samples.append(
                ScoredSample(
                    t=sample.t,
                    track_id=sample.track_id,
                    est_x=sample.est_x,
                    est_y=sample.est_y,
                    est_speed=tracker.speed_of(sample.track_id),
                    truth_x=sample.truth_x,
                    truth_y=sample.truth_y,
                    truth_speed=sample.truth_speed,
                    cls=sample.cls,
                    range_m=sample.range_m,
                )
            )

    return PipelineResult(
        events=events,
        samples=samples,
        frames=len(frames),
        labels=label_count,
        projected=projected,
    )
