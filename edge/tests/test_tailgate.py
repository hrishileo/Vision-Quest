"""Time-headway tailgating on label positions."""

import json
from pathlib import Path

import pytest

from horizon_vision.events.labels import read_jsonl
from horizon_vision.events.schema import EventValidationError
from horizon_vision.events.tailgate import (
    MAG_MILE_CAR_LENGTH_M,
    TAILGATE_EVENT_JSON_SCHEMA,
    TailgateDetector,
    TailgateEvent,
    VehicleState,
    detect_tailgates,
)

# Same bytes as the old HorizonVision fixture; Vision-Quest owns the copy.
FIXTURE = Path(__file__).resolve().parents[2] / "src/lib/guide/__fixtures__/cam0-sample.labels.jsonl"
OUTPUT = Path(__file__).parent / "fixtures" / "cam0_tailgate_events.jsonl"
LEGACY = Path(__file__).parent / "fixtures" / "mag_mile_labels.jsonl"

# Center spacing that yields this bumper gap when both cars are CAR_L long.
def _spacing(gap_m: float) -> float:
    return gap_m + MAG_MILE_CAR_LENGTH_M


def _car(track_id, *, lane="mich-nb-1", x=0.0, y=0.0, speed=10.0, length=MAG_MILE_CAR_LENGTH_M):
    return VehicleState(track_id=track_id, lane=lane, x=x, y=y, speed=speed, length=length)


def _behind(lane: str, separation: float) -> tuple[str, float]:
    """Place the follower `separation` metres behind a leader at the origin."""
    bound = lane.split("-")[1]
    sign = {"nb": -1.0, "sb": 1.0, "eb": 1.0, "wb": -1.0}[bound]
    axis = "x" if bound in ("eb", "wb") else "y"
    return axis, -sign * separation


def _pair(lane: str, gap_m: float, speed: float) -> list[VehicleState]:
    axis, follower_coord = _behind(lane, _spacing(gap_m))
    leader_kw = {axis: 0.0, "speed": 8.0}
    follower_kw = {axis: follower_coord, "speed": speed}
    return [
        _car("veh-l", lane=lane, **leader_kw),
        _car("veh-f", lane=lane, **follower_kw),
    ]


def _run(detector: TailgateDetector, vehicles: list[VehicleState], steps: int = 6, dt: float = 0.1):
    events = []
    for i in range(steps):
        events.extend(detector.update(i * dt, vehicles))
    return events


def test_schema_lists_tailgate_fields():
    assert TAILGATE_EVENT_JSON_SCHEMA["required"] == [
        "follower_track_id",
        "leader_track_id",
        "lane",
        "headway_s",
        "gap_m",
        "follower_speed",
        "confidence",
        "t",
    ]
    assert TAILGATE_EVENT_JSON_SCHEMA["additionalProperties"] is False


@pytest.mark.parametrize("lane", ["mich-nb-1", "mich-sb-0", "chi-eb-0", "chi-wb-1"])
def test_headway_below_threshold_is_flagged(lane):
    events = _run(TailgateDetector(), _pair(lane, gap_m=10.0, speed=10.0))
    assert len(events) == 1
    event = events[0]
    assert event.follower_track_id == "veh-f"
    assert event.leader_track_id == "veh-l"
    assert event.lane == lane
    assert event.headway_s == pytest.approx(1.0)
    assert event.gap_m == pytest.approx(10.0)
    assert event.follower_speed == pytest.approx(10.0)
    assert event.confidence == pytest.approx(1.0)
    assert event.t == pytest.approx(0.5)
    assert event.to_dict()["headway_s"] == pytest.approx(1.0)


def test_headway_above_threshold_is_not_flagged():
    events = _run(TailgateDetector(), _pair("mich-nb-1", gap_m=30.0, speed=10.0), steps=12)
    assert events == []


def test_stopped_and_creeping_traffic_is_not_flagged():
    # 0.5 m at 10 m/s is a 0.05 s headway, so the geometry itself is a violation.
    # Speed 0 and 0.5 m/s are queued traffic and must not flag.
    stopped = _run(TailgateDetector(), _pair("mich-nb-1", gap_m=0.5, speed=0.0), steps=12)
    creeping = _run(TailgateDetector(), _pair("mich-nb-1", gap_m=0.5, speed=0.5), steps=12)
    moving = _run(TailgateDetector(), _pair("mich-nb-1", gap_m=0.5, speed=10.0))
    assert stopped == []
    assert creeping == []
    assert len(moving) == 1


def test_stopped_leader_does_not_excuse_a_moving_follower():
    vehicles = _pair("mich-nb-1", gap_m=10.0, speed=10.0)
    vehicles[0] = _car("veh-l", y=0.0, speed=0.0)
    events = _run(TailgateDetector(), vehicles)
    assert len(events) == 1
    assert events[0].leader_track_id == "veh-l"
    assert events[0].follower_speed == pytest.approx(10.0)


def test_threshold_is_configurable():
    # Length 4 m keeps the 15 m gap exact, so headway is 1.5 s and not 1.5 - epsilon.
    close = [
        _car("veh-l", y=0.0, speed=8.0, length=4.0),
        _car("veh-f", y=19.0, speed=10.0, length=4.0),
    ]
    flagged = _run(TailgateDetector(threshold_s=2.0), close)
    spared = _run(TailgateDetector(threshold_s=1.0), close)
    equal = _run(TailgateDetector(threshold_s=1.5), close)
    assert len(flagged) == 1
    assert flagged[0].headway_s == pytest.approx(1.5)
    assert spared == []
    assert equal == []


def test_brief_blip_is_not_flagged():
    detector = TailgateDetector()
    events = detector.update(0.0, _pair("mich-nb-1", gap_m=8.0, speed=10.0))
    for i in range(1, 12):
        events.extend(detector.update(i * 0.1, _pair("mich-nb-1", gap_m=40.0, speed=10.0)))
    assert events == []

    burst = TailgateDetector(persist_s=0.5)
    burst_events = []
    for i in range(5):  # 0.0 through 0.4 s, short of the window
        burst_events.extend(burst.update(i * 0.1, _pair("mich-nb-1", gap_m=8.0, speed=10.0)))
    burst_events.extend(burst.update(0.5, _pair("mich-nb-1", gap_m=40.0, speed=10.0)))
    assert burst_events == []


def test_lane_change_resets_the_window():
    detector = TailgateDetector(persist_s=0.5)
    events = []
    for i in range(5):
        events.extend(detector.update(i * 0.1, _pair("mich-nb-1", gap_m=8.0, speed=10.0)))
    # The follower is now in the next lane, still close to where the leader was.
    changed = [
        _car("veh-l", lane="mich-nb-1", y=0.0, speed=8.0),
        _car("veh-f", lane="mich-nb-2", y=_spacing(8.0), speed=10.0),
    ]
    events.extend(detector.update(0.5, changed))
    events.extend(detector.update(0.6, changed))
    assert events == []


def test_only_consecutive_vehicles_are_paired():
    # Leader, a close follower, and a third car far behind that follower.
    far = _spacing(10.0) + _spacing(40.0)
    vehicles = [
        _car("veh-l", y=0.0, speed=8.0),
        _car("veh-mid", y=_spacing(10.0), speed=10.0),
        _car("veh-far", y=far, speed=10.0),
    ]
    events = _run(TailgateDetector(), vehicles, steps=8)
    pairs = {(event.follower_track_id, event.leader_track_id) for event in events}
    assert pairs == {("veh-mid", "veh-l")}


def test_rejects_invalid_tailgate_event():
    payload = {
        "follower_track_id": "veh-f",
        "leader_track_id": "veh-l",
        "lane": "mich-nb-1",
        "headway_s": 1.0,
        "gap_m": 10.0,
        "follower_speed": 10.0,
        "confidence": 1.0,
        "t": 0.5,
    }
    TailgateEvent.from_dict(payload)
    with pytest.raises(EventValidationError):
        TailgateEvent.from_dict({**payload, "follower_track_id": "veh-l", "leader_track_id": "veh-l"})
    with pytest.raises(EventValidationError):
        TailgateEvent.from_dict({**payload, "headway_s": -0.1})
    with pytest.raises(EventValidationError):
        TailgateEvent.from_dict({**payload, "class": "vehicle"})


def test_legacy_fixture_has_no_following_pair():
    assert detect_tailgates(read_jsonl(LEGACY)) == []


def test_corpus_fixture_parses_recorder_keys():
    frames = read_jsonl(FIXTURE)
    assert len(frames) == 28
    frame = frames[0]
    vehicle = next(obj for obj in frame.objects if obj.track_id == "veh-0")
    assert vehicle.cls == "vehicle"
    assert vehicle.unknown is False
    assert vehicle.type_name == "vehicle"
    assert vehicle.lane == "mich-nb-1"
    assert vehicle.truth_x == pytest.approx(5.5)
    assert vehicle.truth_z == pytest.approx(18.4149812396565)
    assert vehicle.truth_speed == pytest.approx(8.747243113617873)
    assert vehicle.bbox.w > 0 and vehicle.bbox.h > 0
    unknowns = [obj for obj in frame.objects if obj.cls == "unknown"]
    assert unknowns
    assert all(obj.unknown and obj.lane is None and obj.truth_speed is None for obj in unknowns)


def test_real_recorder_labels_flag_close_following_and_match_the_output_file():
    frames = read_jsonl(FIXTURE)
    events = detect_tailgates(frames)
    assert events
    assert all(event.headway_s < 2.0 for event in events)
    assert all(event.follower_speed >= 1.0 for event in events)
    assert all(event.gap_m >= 0 for event in events)
    sample = next(
        event
        for event in events
        if event.follower_track_id == "veh-13" and event.leader_track_id == "veh-12"
    )
    assert sample.lane == "mich-sb-0"
    assert sample.t == pytest.approx(1.6666666666666685)
    # Independent of the detector: bumper gap / follower speed at that timestamp.
    frame = next(frame for frame in frames if frame.t == pytest.approx(sample.t))
    by_id = {obj.track_id: obj for obj in frame.objects}
    leader_z = by_id["veh-12"].truth_z
    follower_z = by_id["veh-13"].truth_z
    gap = (leader_z - follower_z) - MAG_MILE_CAR_LENGTH_M
    speed = by_id["veh-13"].truth_speed
    assert sample.gap_m == pytest.approx(gap)
    assert sample.headway_s == pytest.approx(gap / speed)
    assert sample.follower_speed == pytest.approx(speed)

    committed = [
        json.loads(line)
        for line in OUTPUT.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert committed == [event.to_dict() for event in events]
