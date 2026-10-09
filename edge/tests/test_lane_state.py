"""Blocked, slow, and cautious lane states from tracks."""

import json
from pathlib import Path

import pytest

from horizon_vision.events.labels import read_jsonl
from horizon_vision.events.lane_state import (
    LANE_STATE_JSON_SCHEMA,
    STATES,
    LaneMonitor,
    LaneStateEvent,
    LaneStateValidationError,
    collect_lane_states,
    lane_states_jsonl,
)
from horizon_vision.events.schema import EdgeEvent

FIXTURES = Path(__file__).parent / "fixtures"
# Same bytes as the old HorizonVision fixture; Vision-Quest owns the copy.
REAL_LABELS = (
    Path(__file__).resolve().parents[2] / "src/lib/guide/__fixtures__/cam0-sample.labels.jsonl"
)
REAL_STATES = FIXTURES / "cam0_lane_states.jsonl"
SYNTHETIC_LABELS = FIXTURES / "synthetic_blockade_labels.jsonl"
SYNTHETIC_STATES = FIXTURES / "synthetic_blockade_lane_states.jsonl"


def _track(
    track_id="veh-1",
    lane="mich-nb-1",
    speed=0.0,
    confidence=0.9,
    t=0.0,
    cls="vehicle",
    x=0.0,
    y=0.0,
):
    return EdgeEvent(
        cls=cls,
        unknown=cls == "unknown",
        x=x,
        y=y,
        speed=speed,
        lane=lane,
        confidence=confidence,
        t=t,
        track_id=track_id,
    )


def _monitor(**overrides) -> LaneMonitor:
    config = {
        "hold_s": 1.0,
        "stationary_mps": 0.5,
        "slow_mps": 4.0,
        "stale_s": 1.0,
        "min_confidence": 0.35,
        "stationary_radius_m": 4.0,
        "max_gap_s": 0.5,
    }
    config.update(overrides)
    return LaneMonitor(**config)


def _at(monitor: LaneMonitor, t: float, tracks: list[EdgeEvent]):
    events = monitor.update(t, tracks)
    return {event.lane: event for event in events}


def test_schema_names_the_router_fields():
    assert LANE_STATE_JSON_SCHEMA["required"] == ["lane", "state", "speed", "confidence", "t"]
    assert LANE_STATE_JSON_SCHEMA["properties"]["state"]["enum"] == list(STATES)
    assert LANE_STATE_JSON_SCHEMA["additionalProperties"] is False
    rules = LANE_STATE_JSON_SCHEMA["allOf"]
    assert rules[0]["then"]["properties"]["speed"]["type"] == "null"
    assert rules[1]["then"]["properties"]["state"]["const"] == "unknown"


def test_round_trip_and_unknown_cannot_carry_a_speed():
    event = LaneStateEvent(lane="mich-nb-1", state="slow", speed=2.5, confidence=0.8, t=1.0)
    assert LaneStateEvent.from_dict(event.to_dict()) == event

    with pytest.raises(LaneStateValidationError):
        LaneStateEvent(lane="mich-nb-1", state="unknown", speed=2.5, confidence=0.2, t=1.0)
    with pytest.raises(LaneStateValidationError):
        LaneStateEvent(lane="mich-nb-1", state="clear", speed=None, confidence=0.8, t=1.0)
    with pytest.raises(LaneStateValidationError):
        LaneStateEvent.from_dict({"lane": "mich-nb-1", "state": "clear", "speed": 8, "confidence": 0.8, "t": 1, "cost": 0})


def test_persistent_stationary_vehicle_blocks_the_lane():
    monitor = _monitor()
    assert _at(monitor, 0.0, [_track(speed=0.0)])["mich-nb-1"].state == "slow"
    assert _at(monitor, 0.5, [_track(speed=0.0, t=0.5)])["mich-nb-1"].state == "slow"
    blocked = _at(monitor, 1.0, [_track(speed=0.2, t=1.0)])["mich-nb-1"]
    assert blocked.state == "blocked"
    assert blocked.speed == pytest.approx(0.2)
    assert blocked.confidence == pytest.approx(0.9)
    assert blocked.t == pytest.approx(1.0)


def test_vehicle_stall_hold_stays_off_and_a_long_stall_stays_slow():
    monitor = LaneMonitor(block_classes=("unknown",))
    assert monitor.vehicle_stall_hold_s is None
    stall = lambda t: _track(speed=0.0, t=t, confidence=0.9)
    last = None
    for step in range(0, 25):
        last = _at(monitor, step * 0.5, [stall(step * 0.5)])["mich-nb-1"]
    assert last is not None
    assert last.state == "slow"


def test_vehicle_stall_hold_blocks_after_the_longer_dwell_and_debris_uses_hold_s():
    monitor = LaneMonitor(
        block_classes=("unknown",),
        hold_s=1.5,
        vehicle_stall_hold_s=10.0,
        max_gap_s=0.5,
        min_confidence=0.2,
    )
    stall = lambda t: _track(speed=0.0, t=t, x=5.5, y=1.0, confidence=0.9)
    debris = lambda t: _track(
        track_id="deb-1",
        cls="unknown",
        lane="mich-nb-0",
        speed=0.0,
        t=t,
        x=2.0,
        y=1.0,
        confidence=0.9,
    )
    early = None
    late = None
    debris_at_hold = None
    for step in range(0, 21):
        t = step * 0.5
        got = _at(monitor, t, [stall(t), debris(t)])
        if t == 1.5:
            debris_at_hold = got["mich-nb-0"].state
        if t == 9.5:
            early = got["mich-nb-1"].state
        if t == 10.0:
            late = got["mich-nb-1"].state
    assert debris_at_hold == "blocked"
    assert early == "slow"
    assert late == "blocked"


def test_vehicle_stall_hold_cannot_be_shorter_than_hold_s():
    with pytest.raises(ValueError, match="vehicle_stall_hold_s"):
        LaneMonitor(vehicle_stall_hold_s=0.5, hold_s=1.5)


def test_persistent_unknown_debris_blocks_the_lane():
    monitor = _monitor()
    debris = lambda t: _track(
        track_id="deb-barrier", cls="unknown", lane="mich-nb-2", speed=0.0, t=t, x=9.0, y=16.0
    )
    assert _at(monitor, 0.0, [debris(0.0)])["mich-nb-2"].state != "blocked"
    assert _at(monitor, 0.5, [debris(0.5)])["mich-nb-2"].state != "blocked"
    blocked = _at(monitor, 1.0, [debris(1.0)])["mich-nb-2"]
    assert blocked.state == "blocked"
    assert blocked.lane == "mich-nb-2"


def test_brief_stop_does_not_block():
    monitor = _monitor(hold_s=1.0)
    assert _at(monitor, 0.0, [_track(speed=0.0)])["mich-nb-1"].state != "blocked"
    assert _at(monitor, 0.4, [_track(speed=0.0, t=0.4)])["mich-nb-1"].state != "blocked"
    resumed = _at(monitor, 0.8, [_track(speed=9.0, t=0.8)])["mich-nb-1"]
    assert resumed.state == "clear"
    assert resumed.speed == pytest.approx(9.0)


def test_low_confidence_blip_is_unknown_not_blocked_or_clear():
    monitor = _monitor(hold_s=1.0)
    blip = lambda t: _track(speed=0.0, confidence=0.1, t=t)
    for t in (0.0, 0.5, 1.0, 2.0, 3.0):
        event = _at(monitor, t, [blip(t)])["mich-nb-1"]
        assert event.state == "unknown"
        assert event.speed is None
        assert event.state != "clear"


def test_one_confident_sample_does_not_block():
    event = _at(_monitor(hold_s=1.0), 0.0, [_track(speed=0.0, confidence=0.95)])["mich-nb-1"]
    assert event.state == "slow"
    assert event.state != "blocked"


def test_debris_hit_plus_slowdown_holds_blocked_after_the_box_drops():
    monitor = LaneMonitor(
        hold_s=1.5,
        min_confidence=0.2,
        slow_mps=4.0,
        stationary_mps=0.5,
        debris_fuse=True,
        debris_hold_s=1.0,
        blocked_hold_s=1.0,
    )
    slow = lambda t: _track(track_id="veh-1", speed=2.2, t=t, x=0.4 * t)
    debris = _track(track_id="deb-1", cls="unknown", speed=0.0, t=0.0, confidence=0.6)
    # The debris has not sat still for hold_s. The slow vehicles plus that
    # one hit are enough, and the lane stays blocked after the box is gone.
    assert _at(monitor, 0.0, [slow(0.0), debris])["mich-nb-1"].state == "blocked"
    assert _at(monitor, 0.5, [slow(0.5)])["mich-nb-1"].state == "blocked"
    assert _at(monitor, 2.2, [slow(2.2)])["mich-nb-1"].state == "slow"


def test_fuse_does_not_let_a_vehicle_stall_skip_the_closed_loop_rule():
    monitor = LaneMonitor(
        block_classes=("unknown",),
        hold_s=1.5,
        vehicle_stall_hold_s=10.0,
        max_gap_s=0.5,
        min_confidence=0.2,
        debris_fuse=True,
        debris_hold_s=1.0,
        blocked_hold_s=1.0,
    )
    stall = lambda t: _track(speed=0.0, t=t, confidence=0.9)
    saw_slow = False
    last = None
    for step in range(0, 21):
        t = step * 0.5
        last = _at(monitor, t, [stall(t)])["mich-nb-1"].state
        if t == 2.0:
            saw_slow = last == "slow"
    assert saw_slow
    assert last == "blocked"

    fused = LaneMonitor(
        block_classes=("unknown",),
        hold_s=1.5,
        min_confidence=0.2,
        debris_fuse=True,
        debris_hold_s=1.0,
        blocked_hold_s=1.0,
    )
    slow = lambda t: _track(track_id="veh-1", speed=2.0, t=t, x=0.2 * t)
    debris = _track(track_id="deb-1", cls="unknown", speed=0.0, t=0.0, confidence=0.6)
    assert _at(fused, 0.0, [slow(0.0)])["mich-nb-1"].state == "slow"
    assert _at(fused, 0.5, [slow(0.5), debris])["mich-nb-1"].state == "blocked"
    assert _at(fused, 1.0, [slow(1.0)])["mich-nb-1"].state == "blocked"


def test_slow_traffic_without_debris_stays_slow_when_fuse_is_on():
    monitor = LaneMonitor(
        hold_s=1.5,
        min_confidence=0.2,
        debris_fuse=True,
        debris_hold_s=2.0,
        blocked_hold_s=2.0,
    )
    crawling = lambda t: _track(speed=2.0, t=t, x=0.5 * t)
    assert _at(monitor, 0.0, [crawling(0.0)])["mich-nb-1"].state == "slow"
    assert _at(monitor, 2.0, [crawling(2.0)])["mich-nb-1"].state == "slow"


def test_slow_lane_from_track_speeds():
    monitor = _monitor()
    crawling = lambda t: _track(speed=2.0, t=t, x=2.0 * t)
    first = _at(monitor, 0.0, [crawling(0.0)])["mich-nb-1"]
    later = _at(monitor, 2.0, [crawling(2.0)])["mich-nb-1"]
    assert first.state == "slow"
    assert later.state == "slow"
    assert later.speed == pytest.approx(2.0)
    assert later.state != "blocked"


def test_lane_speed_is_the_mean_of_confident_tracks():
    monitor = _monitor()
    events = _at(
        monitor,
        0.0,
        [
            _track(track_id="veh-1", speed=8.0, confidence=0.8),
            _track(track_id="veh-2", speed=10.0, confidence=0.6),
            _track(track_id="noise", speed=0.0, confidence=0.1),
        ],
    )
    lane = events["mich-nb-1"]
    assert lane.state == "clear"
    assert lane.speed == pytest.approx(9.0)
    assert lane.confidence == pytest.approx(0.7)


def test_low_confidence_blip_does_not_override_a_confident_lane():
    monitor = _monitor(hold_s=1.0)
    mixed = _at(
        monitor,
        0.0,
        [
            _track(track_id="veh-1", speed=8.0, confidence=0.9),
            _track(track_id="deb-blip", cls="unknown", speed=0.0, confidence=0.05, x=3.0),
        ],
    )["mich-nb-1"]
    assert mixed.state == "clear"
    held = _at(
        monitor,
        1.5,
        [
            _track(track_id="veh-1", speed=8.0, confidence=0.9, t=1.5),
            _track(track_id="deb-blip", cls="unknown", speed=0.0, confidence=0.05, t=1.5, x=3.0),
        ],
    )["mich-nb-1"]
    assert held.state == "clear"


def test_stale_lane_is_unknown_not_clear():
    monitor = _monitor(stale_s=1.0)
    assert _at(monitor, 0.0, [_track(speed=10.0)])["mich-nb-1"].state == "clear"
    held = _at(monitor, 0.5, [])["mich-nb-1"]
    assert held.state == "clear"
    assert held.speed == pytest.approx(10.0)
    stale = _at(monitor, 1.6, [])["mich-nb-1"]
    assert stale.state == "unknown"
    assert stale.speed is None
    assert stale.confidence == pytest.approx(0.0)
    assert stale.t == pytest.approx(1.6)


def test_lane_change_restarts_the_hold():
    monitor = _monitor(hold_s=1.0)
    _at(monitor, 0.0, [_track(lane="mich-nb-1", speed=0.0)])
    _at(monitor, 0.4, [_track(lane="mich-nb-1", speed=0.0, t=0.4)])
    moved = _at(monitor, 0.8, [_track(lane="mich-nb-2", speed=0.0, t=0.8)])
    assert moved["mich-nb-1"].state == "slow"
    assert moved["mich-nb-2"].state != "blocked"
    assert _at(monitor, 1.3, [_track(lane="mich-nb-2", speed=0.0, t=1.3)])["mich-nb-2"].state != "blocked"
    blocked = _at(monitor, 1.8, [_track(lane="mich-nb-2", speed=0.0, t=1.8)])
    assert blocked["mich-nb-2"].state == "blocked"


def test_drift_past_the_anchor_restarts_the_hold():
    monitor = _monitor(hold_s=1.0, stationary_radius_m=1.0)
    _at(monitor, 0.0, [_track(speed=0.4, x=0.0)])
    _at(monitor, 0.5, [_track(speed=0.4, x=0.2, t=0.5)])
    shifted = _at(monitor, 1.0, [_track(speed=0.4, x=3.0, t=1.0)])["mich-nb-1"]
    assert shifted.state != "blocked"
    _at(monitor, 1.5, [_track(speed=0.4, x=3.0, t=1.5)])
    settled = _at(monitor, 2.0, [_track(speed=0.4, x=3.1, t=2.0)])["mich-nb-1"]
    assert settled.state == "blocked"


def test_time_cannot_go_backwards():
    monitor = _monitor()
    monitor.update(1.0, [_track()])
    with pytest.raises(ValueError):
        monitor.update(0.5, [_track()])


def test_recorder_label_keys_parse():
    frames = read_jsonl(REAL_LABELS)
    assert len(frames) == 28
    first = frames[0].objects[0]
    assert first.track_id == "veh-0"
    assert first.cls == "vehicle"
    assert first.lane == "mich-nb-1"
    assert frames[0].intrinsics.focal_length_px == pytest.approx(385.6, abs=0.1)
    assert frames[0].pose.agl == pytest.approx(frames[0].pose.y)
    debris = next(obj for obj in frames[0].objects if obj.track_id == "deb-0")
    assert debris.cls == "unknown"
    assert debris.unknown is True
    assert debris.type_name == "tire"
    assert debris.lane is None


def test_synthetic_blockade_fixture_emits_blocked_slow_and_clear():
    frames = read_jsonl(SYNTHETIC_LABELS)
    assert frames[0].objects
    raw = SYNTHETIC_LABELS.read_text(encoding="utf-8").splitlines()
    assert raw[0].startswith("# SYNTHETIC")
    payload = json.loads(raw[1])
    assert payload["synthetic"] is True

    events = collect_lane_states(frames)
    assert lane_states_jsonl(events) == SYNTHETIC_STATES.read_text(encoding="utf-8")
    by_lane: dict[str, list] = {}
    for event in events:
        by_lane.setdefault(event.lane, []).append(event)

    blockade = by_lane["mich-nb-2"]
    assert blockade[0].state != "blocked"
    assert any(event.state == "blocked" for event in blockade)
    assert blockade[-1].state == "blocked"
    assert all(event.state == "clear" for event in by_lane["mich-nb-1"])
    assert all(event.state == "slow" for event in by_lane["mich-sb-1"])
    assert all(event.speed is not None and event.speed >= 4.0 for event in by_lane["mich-nb-1"])
    assert all(event.speed is not None and event.speed < 4.0 for event in by_lane["mich-sb-1"])


def test_real_recorder_lane_states_match_committed_file_and_stay_cautious():
    frames = read_jsonl(REAL_LABELS)
    events = collect_lane_states(frames)
    text = lane_states_jsonl(events)
    assert text == REAL_STATES.read_text(encoding="utf-8")
    assert events
    for event in events:
        LaneStateEvent.from_dict(event.to_dict())
        if event.state == "unknown":
            assert event.speed is None
        floor = LaneMonitor().min_confidence
        if event.state == "clear":
            assert event.confidence >= floor
            assert event.speed is not None and event.speed >= 4.0
        if event.state == "slow":
            assert event.confidence >= floor
            assert event.speed is not None and event.speed < 4.0
        if event.state == "blocked":
            assert event.confidence >= floor
            assert event.speed is not None
    # Shallow rays in this clip must not be published as a free lane.
    assert any(event.state == "unknown" for event in events)
    # Stopped vehicles sit in these lanes for the whole clip. Debris in this
    # sample is off-lane, so the blocked states come from those vehicles.
    blocked = {event.lane for event in events if event.state == "blocked"}
    assert blocked == {"chi-wb-0", "chi-wb-1", "chi-eb-0"}
