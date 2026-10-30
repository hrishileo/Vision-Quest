"""Person, bicycle and motor are published but never touch lane state."""

import sys
from pathlib import Path

import pytest

from horizon_vision.events.labels import LabelParseError, normalize_class
from horizon_vision.events.lane_state import LaneMonitor
from horizon_vision.events.schema import CLASSES, EdgeEvent, semantic_errors

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "detector"))
from yolo import class_map  # noqa: E402


def _ev(cls, track, t, speed=0.0, x=5.5, y=10.0, lane="mich-nb-1"):
    return EdgeEvent(cls=cls, unknown=cls == "unknown", x=x, y=y, speed=speed,
                     lane=lane, confidence=0.9, t=t, track_id=track)


@pytest.mark.parametrize("cls", ["person", "bicycle", "motor"])
def test_new_classes_pass_the_contract(cls):
    assert cls in CLASSES
    event = _ev(cls, "trk-1", 0.0)
    assert semantic_errors(event.to_dict()) == []
    assert EdgeEvent.from_dict(event.to_dict()) == event


@pytest.mark.parametrize("cls", ["person", "bicycle", "motor"])
def test_labels_accept_new_classes(cls):
    assert normalize_class(cls, None) == (cls, False)


def test_labels_still_reject_junk():
    with pytest.raises(LabelParseError):
        normalize_class("dog", None)


@pytest.mark.parametrize("cls", ["person", "bicycle", "motor"])
def test_road_users_never_block_or_slow_a_lane(cls):
    # A fast vehicle keeps the lane clear; a stationary road user sits in it
    # for far longer than any hold. The lane must stay what the car says.
    with_user = LaneMonitor()
    car_only = LaneMonitor()
    for i in range(60):
        t = i * 0.1
        car = _ev("vehicle", "car", t, speed=12.0, y=10.0 - 1.2 * i)
        user = _ev(cls, "u", t, speed=0.0)
        a = with_user.update(t, [car, user])
        b = car_only.update(t, [car])
        assert a == b
    assert all(s.state != "blocked" for s in a)


@pytest.mark.parametrize("cls", ["person", "bicycle", "motor"])
def test_road_user_alone_leaves_no_lane_state(cls):
    mon = LaneMonitor()
    for i in range(40):
        assert mon.update(i * 0.1, [_ev(cls, "u", i * 0.1)]) == []


def test_debris_still_blocks():
    mon = LaneMonitor()
    states = []
    for i in range(40):
        states += mon.update(i * 0.1, [_ev("unknown", "d", i * 0.1)])
    assert any(s.state == "blocked" for s in states)


def test_coco_names_map_people_to_person_not_vehicle():
    coco = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck", 9: "traffic light"}
    assert class_map(coco) == {0: "person", 1: "bicycle", 2: "vehicle", 3: "motor", 5: "vehicle", 7: "vehicle"}


def test_own_checkpoints_map_to_themselves():
    assert class_map({0: "vehicle", 1: "unknown"}) == {0: "vehicle", 1: "unknown"}
    assert class_map(["vehicle", "person", "bicycle", "motor"]) == {0: "vehicle", 1: "person", 2: "bicycle", 3: "motor"}
