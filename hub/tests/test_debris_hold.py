"""Hub debris hold: a debris-blocked lane survives short dropouts, then clears."""

import math

import pytest

from horizon_vision.events.schema import EdgeEvent
from horizon_vision.hub.bridge import (
    LOOP_BLOCKED_HOLD_S,
    DriverSpec,
    blocked_hold_for,
    build_plans,
    drivers_from_specs,
    hub_config_for,
    monitor_for,
)
from horizon_vision.hub.graph import mag_mile_graph

HZ = 10
LANE = "mich-nb-1"


def _debris(t: float) -> EdgeEvent:
    return EdgeEvent(cls="unknown", unknown=True, x=5.5, y=100.0, speed=0.0,
                     lane=LANE, confidence=0.9, t=t, track_id="deb-1")


def _car(t: float, track: str = "veh-1", speed: float = 8.0) -> EdgeEvent:
    # Moving car in the same lane keeps the lane observed, so a missed debris
    # frame reads as a fast lane rather than going stale.
    return EdgeEvent(cls="vehicle", unknown=False, x=5.5, y=60.0 - speed * t, speed=speed,
                     lane=LANE, confidence=0.9, t=t, track_id=track)


def _loop_states(frames: int, debris_at) -> list:
    monitor = monitor_for("loop")
    states = []
    for i in range(frames):
        t = round(i / HZ, 6)
        events = [_car(t)]
        if debris_at(i):
            events.append(_debris(t))
        states.extend(monitor.update(t, events))
    return states


def _plans(states, hold: float):
    graph = mag_mile_graph()
    drivers = drivers_from_specs(graph, [DriverSpec("nb-1", LANE, "ohio", "chicago")])
    return build_plans(states, drivers, hub_config_for("loop"), graph,
                       closures_only=True, blocked_hold_s=hold)


def _blocked_at(states, lane=LANE):
    return [s.t for s in states if s.lane == lane and s.state == "blocked"]


def test_loop_policy_uses_the_hold_and_legacy_does_not():
    assert blocked_hold_for("loop") == LOOP_BLOCKED_HOLD_S > 0
    assert blocked_hold_for("legacy") == 0.0
    with pytest.raises(ValueError):
        blocked_hold_for("other")


def test_one_frame_dropout_flips_without_the_hold():
    # Frame 30 misses the debris box. The edge publishes the lane fast, not blocked.
    states = _loop_states(50, lambda i: i != 30)
    assert 3.0 not in _blocked_at(states)
    blocked_sets = [p.blocked for p in _plans(states, 0.0)]
    assert blocked_sets == [(LANE,), (), (LANE,)]


def test_hold_survives_a_one_frame_dropout():
    states = _loop_states(50, lambda i: i != 30)
    plans = _plans(states, LOOP_BLOCKED_HOLD_S)
    assert [p.blocked for p in plans] == [(LANE,)]
    assert plans[0].alerts, "the closure still reroutes the northbound driver"


def test_hold_survives_the_longest_dropout_it_is_sized_for():
    frames_held = round(LOOP_BLOCKED_HOLD_S * HZ)
    states = _loop_states(60, lambda i: not 30 <= i < 30 + frames_held)
    assert [p.blocked for p in _plans(states, LOOP_BLOCKED_HOLD_S)] == [(LANE,)]


def test_lane_clears_within_the_hold_after_debris_is_gone():
    states = _loop_states(60, lambda i: i < 30)
    last_blocked = max(_blocked_at(states))
    plans = _plans(states, LOOP_BLOCKED_HOLD_S)
    assert [p.blocked for p in plans] == [(LANE,), ()]
    cleared = plans[-1]
    assert cleared.alerts == ()
    assert cleared.t - last_blocked <= LOOP_BLOCKED_HOLD_S + 1 / HZ + 1e-9
    assert cleared.t - last_blocked > LOOP_BLOCKED_HOLD_S


def test_hold_never_covers_a_stopped_vehicle_under_debris_only_rule():
    monitor = monitor_for("loop")
    states = []
    for i in range(60):
        t = round(i / HZ, 6)
        states.extend(monitor.update(t, [_car(t, track="veh-stall", speed=0.0)]))
    assert _blocked_at(states) == []
    assert {s.state for s in states if s.lane == LANE} == {"slow"}
    assert _plans(states, LOOP_BLOCKED_HOLD_S) == []


def test_stall_next_to_cleared_debris_does_not_extend_the_closure():
    # Debris leaves at frame 30. A stopped car stays in the lane. The lane
    # must clear once the hold runs out; the stall alone keeps it slow.
    monitor = monitor_for("loop")
    states = []
    for i in range(60):
        t = round(i / HZ, 6)
        events = [_car(t, track="veh-stall", speed=0.0)]
        if i < 30:
            events.append(_debris(t))
        states.extend(monitor.update(t, events))
    plans = _plans(states, LOOP_BLOCKED_HOLD_S)
    assert [p.blocked for p in plans] == [(LANE,), ()]
    assert plans[-1].t - max(_blocked_at(states)) <= LOOP_BLOCKED_HOLD_S + 1 / HZ + 1e-9


@pytest.mark.parametrize("bad", [-0.1, math.inf, math.nan])
def test_hold_rejects_bad_values(bad):
    with pytest.raises(ValueError):
        _plans([], bad)
