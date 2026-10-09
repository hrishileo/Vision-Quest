"""Run the edge event pipeline on detector boxes instead of labels.

The camera pose still comes from the platform (the recorder, on a sim
frame). The boxes come from a detector. A ByteTrack-style associator
gives each box an id, the existing monocular ray hits the ground, and
``lane_id_at`` fills the lane the label used to carry. ``TrackBook`` then
smooths and holds the track the same way it does for labels.

Tailgating and lane state read those tracked events. They do not read the
label's true position or true speed.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Protocol, Sequence

from horizon_vision.events.associate import ByteTrack, DetBox, TrackedBox
from horizon_vision.events.labels import FrameLabels
from horizon_vision.events.lane_state import LaneMonitor, LaneStateEvent
from horizon_vision.events.lanes import lane_id_at
from horizon_vision.events.monocular import estimate_ground_point
from horizon_vision.events.schema import EdgeEvent
from horizon_vision.events.tailgate import (
    MAG_MILE_CAR_LENGTH_M,
    TailgateDetector,
    TailgateEvent,
    VehicleState,
)
from horizon_vision.events.tracking import Observation, TrackBook

CLASS_NAMES = ("vehicle", "unknown")


class BoxDetector(Protocol):
    def detect(self, image: object) -> list[DetBox]:
        """Boxes in the image's pixel space. ``image`` is opaque to the pipeline."""


@dataclass
class DetectorRun:
    events: list[EdgeEvent]
    lane_states: list[LaneStateEvent]
    tailgates: list[TailgateEvent]
    detections: int
    tracked: int
    per_frame: list[list[TrackedBox]] = field(default_factory=list)


def observation_from_box(box: TrackedBox, frame: FrameLabels) -> Observation | None:
    """Project one tracked box. Confidence is the worse of the ray and the detector."""
    if box.cls not in CLASS_NAMES:
        return None
    estimate = estimate_ground_point(box.bbox, frame.pose, frame.intrinsics)
    if estimate is None:
        return None
    return Observation(
        track_id=box.track_id,
        x=estimate.x,
        y=estimate.y,
        cls=box.cls,
        unknown=box.cls == "unknown",
        lane=lane_id_at(estimate.x, estimate.y),
        confidence=min(estimate.confidence, box.confidence),
    )


def vehicles_from_events(
    events: Sequence[EdgeEvent],
    length_m: float = MAG_MILE_CAR_LENGTH_M,
) -> list[VehicleState]:
    """Vehicle tracks only. Debris stays out of the following test."""
    vehicles: list[VehicleState] = []
    for event in events:
        if event.cls != "vehicle" or event.lane is None:
            continue
        vehicles.append(
            VehicleState(
                track_id=event.track_id,
                lane=event.lane,
                x=event.x,
                y=event.y,
                speed=event.speed,
                length=length_m,
                confidence=event.confidence,
            )
        )
    return vehicles


def tailgates_from_events(
    frame_times: Sequence[float],
    events: Sequence[EdgeEvent],
    detector: TailgateDetector | None = None,
) -> list[TailgateEvent]:
    book = detector if detector is not None else TailgateDetector()
    by_t: dict[float, list[EdgeEvent]] = defaultdict(list)
    for event in events:
        by_t[event.t].append(event)
    found: list[TailgateEvent] = []
    for t in frame_times:
        found.extend(book.update(t, vehicles_from_events(by_t.get(t, []), book.vehicle_length_m)))
    return found


def lane_states_from_events(
    frame_times: Sequence[float],
    events: Sequence[EdgeEvent],
    monitor: LaneMonitor | None = None,
) -> list[LaneStateEvent]:
    lane_monitor = monitor if monitor is not None else LaneMonitor()
    by_t: dict[float, list[EdgeEvent]] = defaultdict(list)
    for event in events:
        by_t[event.t].append(event)
    states: list[LaneStateEvent] = []
    for t in frame_times:
        states.extend(lane_monitor.update(t, by_t.get(t, [])))
    return states


def run_detector_pipeline(
    frames: Sequence[FrameLabels],
    images: Sequence[object],
    detector: BoxDetector,
    *,
    box_tracker: ByteTrack | None = None,
    book: TrackBook | None = None,
    lane_monitor: LaneMonitor | None = None,
    tailgate: TailgateDetector | None = None,
) -> DetectorRun:
    """Detect, associate, project, then the same track, lane, and tailgate steps."""
    if len(frames) != len(images):
        raise ValueError("frames and images must be the same length")
    associator = box_tracker if box_tracker is not None else ByteTrack()
    tracker = book if book is not None else TrackBook()
    events: list[EdgeEvent] = []
    per_frame: list[list[TrackedBox]] = []
    detections = 0
    tracked = 0
    for frame, image in zip(frames, images):
        boxes = detector.detect(image)
        detections += len(boxes)
        alive = associator.update(boxes)
        tracked += len(alive)
        per_frame.append(alive)
        observations: list[Observation] = []
        for box in alive:
            obs = observation_from_box(box, frame)
            if obs is not None:
                observations.append(obs)
        events.extend(tracker.update(frame.t, observations))
    times = [frame.t for frame in frames]
    return DetectorRun(
        events=events,
        lane_states=lane_states_from_events(times, events, lane_monitor),
        tailgates=tailgates_from_events(times, events, tailgate),
        detections=detections,
        tracked=tracked,
        per_frame=per_frame,
    )


def compare_tailgates(
    ground_truth: Sequence[TailgateEvent],
    detected: Sequence[TailgateEvent],
    window_s: float = 0.4,
) -> dict[str, float | int | list[str]]:
    """Match events that share a lane and land within ``window_s``.

    Track ids are not compared. A detector's ids are not the sim's ids.
    """
    used: set[int] = set()
    matched = 0
    for event in ground_truth:
        for index, other in enumerate(detected):
            if index in used:
                continue
            if other.lane == event.lane and abs(other.t - event.t) <= window_s:
                used.add(index)
                matched += 1
                break
    gt_n = len(ground_truth)
    det_n = len(detected)
    return {
        "gt_events": gt_n,
        "det_events": det_n,
        "matched": matched,
        "precision": (matched / det_n) if det_n else (1.0 if gt_n == 0 else 0.0),
        "recall": (matched / gt_n) if gt_n else (1.0 if det_n == 0 else 0.0),
        "lanes_gt": sorted({event.lane for event in ground_truth}),
        "lanes_det": sorted({event.lane for event in detected}),
    }


def compare_lane_states(
    ground_truth: Sequence[LaneStateEvent],
    detected: Sequence[LaneStateEvent],
) -> dict[str, object]:
    """Agreement on ``(lane, t)`` pairs both runs published."""

    def key(event: LaneStateEvent) -> tuple[str, float]:
        return (event.lane, round(event.t, 6))

    gt_map = {key(event): event for event in ground_truth}
    det_map = {key(event): event for event in detected}
    both = set(gt_map) & set(det_map)
    agree = sum(1 for item in both if gt_map[item].state == det_map[item].state)
    confusion: dict[str, int] = {}
    for item in both:
        label = f"{gt_map[item].state}->{det_map[item].state}"
        confusion[label] = confusion.get(label, 0) + 1
    return {
        "compared": len(both),
        "agreement": (agree / len(both)) if both else None,
        "gt_only": len(set(gt_map) - set(det_map)),
        "det_only": len(set(det_map) - set(gt_map)),
        "confusion": dict(sorted(confusion.items())),
    }
