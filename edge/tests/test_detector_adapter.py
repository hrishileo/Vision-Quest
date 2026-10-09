"""Detector boxes through the same track, lane-state, and tailgate path as labels."""

import math

import pytest

from horizon_vision.events.associate import ByteTrack, DetBox
from horizon_vision.events.detect import (
    compare_lane_states,
    compare_tailgates,
    run_detector_pipeline,
)
from horizon_vision.events.labels import CameraIntrinsics, CameraPose, FrameLabels, ObjectLabel, BBox
from horizon_vision.events.lane_state import LaneStateEvent
from horizon_vision.events.lanes import lane_id_at
from horizon_vision.events.schema import EdgeEvent
from horizon_vision.events.tailgate import TailgateEvent


INTR = CameraIntrinsics(
    fov_deg=100.0,
    width=640,
    height=480,
    focal_length_px=100.0,
    cx=320.0,
    cy=240.0,
)


def _frame(t: float, x: float = 5.5, z: float = 10.0) -> FrameLabels:
    return FrameLabels(
        t=t,
        pose=CameraPose(x=x, y=10.0, z=z, agl=10.0, yaw=0.0, pitch=-math.pi / 2, roll=0.0),
        intrinsics=INTR,
        objects=(),
    )


class _Scripted:
    def __init__(self, boxes_per_frame: list[list[DetBox]]) -> None:
        self._boxes = boxes_per_frame
        self.calls = 0

    def detect(self, image: object) -> list[DetBox]:
        boxes = self._boxes[self.calls]
        self.calls += 1
        return boxes


def _center(cls: str, confidence: float = 0.9, du: float = 0.0, dv: float = 0.0) -> DetBox:
    # Bottom-center sits on the principal point when du = dv = 0.
    return DetBox(cls=cls, confidence=confidence, u=310.0 + du, v=220.0 + dv, w=20.0, h=20.0)


def test_lane_id_at_matches_the_mag_mile_table():
    assert lane_id_at(2, -10) == "mich-nb-0"
    assert lane_id_at(5.5, 30) == "mich-nb-1"
    assert lane_id_at(9, -24) == "mich-nb-2"
    assert lane_id_at(-5.5, 8) == "mich-sb-1"
    assert lane_id_at(20, 2.4) == "chi-eb-0"
    assert lane_id_at(14.4, -20) is None
    assert lane_id_at(-14.5, 26) is None
    assert lane_id_at(12.8, -34) is None


def test_bytetrack_holds_a_box_and_drops_it():
    tracker = ByteTrack(iou_threshold=0.3, high_conf=0.5, max_misses=2)
    first = tracker.update([_center("vehicle")])
    assert [box.track_id for box in first] == ["trk-0"]
    moved = tracker.update([_center("vehicle", du=2.0)])
    assert [box.track_id for box in moved] == ["trk-0"]
    weak = tracker.update([_center("vehicle", confidence=0.2, du=3.0)])
    assert [box.track_id for box in weak] == ["trk-0"]
    assert tracker.update([]) == []
    assert tracker.update([]) == []
    revived = tracker.update([_center("vehicle")])
    assert revived[0].track_id == "trk-1"


def test_small_distant_box_keeps_its_id_when_iou_collapses():
    # An 8x6 box shifted by 6 px has IoU about 0.14, under the 0.3 threshold.
    # Center distance is 6 px, inside match_px, so the id has to survive.
    tracker = ByteTrack(
        iou_threshold=0.3,
        high_conf=0.5,
        max_misses=4,
        small_area=256,
        match_px=18,
    )
    first = tracker.update([DetBox("vehicle", 0.9, 100, 80, 8, 6)])
    assert first[0].track_id == "trk-0"
    shifted = tracker.update([DetBox("vehicle", 0.9, 106, 80, 8, 6)])
    assert [box.track_id for box in shifted] == ["trk-0"]
    weak = tracker.update([DetBox("vehicle", 0.12, 110, 82, 8, 6)])
    assert [box.track_id for box in weak] == ["trk-0"]
    assert tracker.update([]) == []
    back = tracker.update([DetBox("vehicle", 0.8, 112, 82, 8, 6)])
    assert back[0].track_id == "trk-0"


def test_a_different_class_does_not_steal_the_track():
    tracker = ByteTrack(iou_threshold=0.1, small_area=10_000, match_px=30, high_conf=0.5)
    tracker.update([_center("vehicle", confidence=0.9)])
    other = tracker.update([_center("unknown", confidence=0.9)])
    assert [box.track_id for box in other] == ["trk-1"]


def test_low_confidence_box_does_not_start_a_track():
    tracker = ByteTrack(high_conf=0.5)
    assert tracker.update([_center("unknown", confidence=0.1)]) == []
    started = tracker.update([_center("unknown", confidence=0.8)])
    assert started[0].cls == "unknown"


def test_nadir_detection_lands_in_the_lane_under_the_camera():
    frames = [_frame(i * 0.1) for i in range(4)]
    boxes = [[_center("vehicle", confidence=0.95)] for _ in frames]
    run = run_detector_pipeline(frames, [None] * len(frames), _Scripted(boxes))
    assert run.detections == 4
    emitted = [event for event in run.events if event.t == pytest.approx(0.3)]
    assert len(emitted) == 1
    event = emitted[0]
    assert event.cls == "vehicle"
    assert event.unknown is False
    assert event.lane == "mich-nb-1"
    assert event.track_id == "trk-0"
    assert event.x == pytest.approx(5.5, abs=1e-6)
    assert event.y == pytest.approx(10.0, abs=1e-6)
    assert event.confidence == pytest.approx(0.95)


def test_debris_box_is_unknown_and_can_block_a_lane():
    # Events start on the third hit (t = 1.0). The lane hold is 1.5 s, so the
    # clip has to reach t = 2.5 before the state can be blocked.
    frames = [_frame(i * 0.5) for i in range(6)]
    boxes = [[_center("unknown", confidence=0.8)] for _ in frames]
    run = run_detector_pipeline(frames, [None] * len(frames), _Scripted(boxes))
    blocked = [state for state in run.lane_states if state.state == "blocked"]
    assert blocked
    assert all(state.lane == "mich-nb-1" for state in blocked)
    assert run.tailgates == []


def test_tailgate_and_lane_compare_ignore_track_ids():
    gt = [
        TailgateEvent("veh-2", "veh-1", "mich-nb-0", 1.2, 8.0, 6.0, 1.0, 1.0),
        TailgateEvent("veh-2", "veh-1", "mich-nb-0", 1.1, 7.5, 6.2, 1.0, 1.4),
    ]
    det = [
        TailgateEvent("trk-1", "trk-0", "mich-nb-0", 1.4, 9.0, 5.5, 0.6, 1.1),
    ]
    report = compare_tailgates(gt, det, window_s=0.4)
    assert report["matched"] == 1
    assert report["lanes_gt"] == ["mich-nb-0"]
    assert report["precision"] == 1.0
    assert report["recall"] == 0.5

    gt_lanes = [
        LaneStateEvent("mich-nb-1", "blocked", 0.0, 0.8, 2.0),
        LaneStateEvent("mich-nb-0", "clear", 9.0, 0.7, 2.0),
    ]
    det_lanes = [
        LaneStateEvent("mich-nb-1", "slow", 1.2, 0.4, 2.0),
        LaneStateEvent("chi-eb-0", "clear", 8.0, 0.5, 2.0),
    ]
    lanes = compare_lane_states(gt_lanes, det_lanes)
    assert lanes["compared"] == 1
    assert lanes["agreement"] == 0.0
    assert lanes["gt_only"] == 1
    assert lanes["det_only"] == 1
    assert lanes["confusion"] == {"blocked->slow": 1}


def test_moving_pair_flags_tailgating_from_detections():
    # Two nadir cameras would share one pose. Shift the follower's box south
    # (image down) so the ground gap stays near one car length plus a few metres.
    frames = [_frame(i * 0.2, x=5.5, z=20.0) for i in range(8)]
    script: list[list[DetBox]] = []
    for i in range(8):
        # Leader drifts north (negative image v is north? image down is south
        # for this nadir yaw-0 camera: +v is +south). Move both north together.
        lead = DetBox("vehicle", 0.92, 310.0, 200.0 - i * 4.0, 20.0, 20.0)
        follow = DetBox("vehicle", 0.88, 310.0, 250.0 - i * 4.0, 20.0, 20.0)
        script.append([lead, follow])
    run = run_detector_pipeline(frames, [None] * len(frames), _Scripted(script))
    assert any(event.cls == "vehicle" for event in run.events)
    assert run.tailgates
    assert {event.lane for event in run.tailgates} == {"mich-nb-1"}
    assert all(event.confidence < 1.0 for event in run.tailgates)


def test_label_objects_are_not_required_on_the_detection_frame():
    # The pose is the only label field the detector path reads.
    frame = _frame(0.0)
    assert frame.objects == ()
    assert isinstance(frame.pose, CameraPose)
    assert isinstance(ObjectLabel, type)
    assert isinstance(BBox, type)
    assert isinstance(EdgeEvent, type)
