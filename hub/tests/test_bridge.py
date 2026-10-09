"""Closed loop: labels to lane state to reroute plans, and the scene-lane map."""

import json
import math
from pathlib import Path

import pytest

from horizon_vision.events.lane_state import LaneMonitor, LaneStateEvent
from horizon_vision.events.schema import EdgeEvent
from horizon_vision.hub.bridge import (
    LOOP_HUB_FLOOR,
    DriverSpec,
    build_plans,
    hub_config_for,
    monitor_for,
    run_bridge,
    split_counts,
)
from horizon_vision.hub.graph import lane_route, mag_mile_graph, travel_time_s
from horizon_vision.hub.lane_state import LaneState
from horizon_vision.hub.reroute import Driver
from horizon_vision.hub.scene_map import scene_lane
from horizon_vision.hub.scenario import corridor_of

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "lib"
    / "guide"
    / "__fixtures__"
    / "hub-scene-lanes.json"
)


def _nadir_frame(index: int, objects: list[dict]) -> dict:
    """Camera straight down. A bottom-center at the principal point is the ground under the camera.

    Pixel offsets use fx = fy = 520 at 18 m, so 1 m is 520/18 px.
    """
    return {
        "schema": 1,
        "groundTruth": True,
        "index": index,
        "t": index * 0.1,
        "rateHz": 10,
        "file": f"synthetic/{index:06d}.png",
        "labelFile": f"labels/{index:06d}.txt",
        "camera": {
            "position": {"x": 9.0, "y": 18.0, "z": 16.0},
            "agl": 18.0,
            "yaw": 0.0,
            "pitch": -math.pi / 2,
            "roll": 0.0,
            "intrinsics": {
                "fovY": 50.0,
                "width": 640,
                "height": 480,
                "fx": 520.0,
                "fy": 520.0,
                "cx": 320.0,
                "cy": 240.0,
            },
        },
        "objects": objects,
    }


def _box(u: float, v: float) -> dict:
    return {"x": u - 10.0, "y": v - 10.0, "w": 20.0, "h": 10.0}


def _metres_to_px(dx: float, dz: float) -> tuple[float, float]:
    scale = 520.0 / 18.0
    return (320.0 + dx * scale, 240.0 + dz * scale)


def _labels(n: int, include_debris: bool, vehicle_speed_px: float = 0.0) -> list[dict]:
    frames = []
    for index in range(n):
        objects = []
        if include_debris:
            objects.append(
                {
                    "trackId": "deb-barrier",
                    "class": "unknown",
                    "type": "barrier",
                    "kind": "blockade",
                    "laneId": "mich-nb-2",
                    "position": {"x": 9.0, "y": 0.0, "z": 16.0},
                    "speed": None,
                    "bbox": _box(320.0, 240.0),
                }
            )
        # Stationary vehicle 3.5 m west of the barrier, still under the nadir camera.
        u, v = _metres_to_px(-3.5, vehicle_speed_px * index * 0.1)
        objects.append(
            {
                "trackId": "veh-stall",
                "class": "vehicle",
                "type": "vehicle",
                "kind": None,
                "laneId": "mich-nb-1",
                "position": {"x": 5.5, "y": 0.0, "z": 16.0},
                "speed": 0.0,
                "bbox": _box(u, v),
            }
        )
        frames.append(_nadir_frame(index, objects))
    return frames


def _write(tmp_path: Path, frames: list[dict]) -> Path:
    path = tmp_path / "labels.jsonl"
    path.write_text("".join(json.dumps(frame) + "\n" for frame in frames), encoding="utf-8")
    return path


def _specs() -> list[DriverSpec]:
    specs = [
        DriverSpec(f"veh-{index}", "mich-nb-2", "ohio", "chicago") for index in range(1, 9)
    ]
    specs.append(DriverSpec("veh-101", "mich-sb-0", "chicago", "ohio"))
    return specs


def test_scene_map_matches_the_fixture_samples():
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert scene_lane("rush-nb") == "rush-nb-0"
    assert scene_lane("wabash-nb") == "wabash-nb-0"
    assert scene_lane("mich-nb-0") == "mich-nb-0"
    assert scene_lane("ohio-ew") is None
    for sample in payload["samples"]:
        assert corridor_of(sample["route"]) == sample["corridor"]
        assert scene_lane(sample["corridor"]) == sample["scene"]


def test_loop_policy_blocks_debris_and_not_a_stall(tmp_path: Path):
    from horizon_vision.events.labels import read_jsonl

    path = _write(tmp_path, _labels(25, include_debris=True))
    frames = read_jsonl(path)
    states, plans = run_bridge(frames, _specs(), "loop")
    by_lane: dict[str, list[str]] = {}
    for state in states:
        by_lane.setdefault(state.lane, []).append(state.state)
    assert "blocked" in by_lane["mich-nb-2"]
    assert "blocked" not in by_lane.get("mich-nb-1", [])
    assert any(state == "slow" for state in by_lane["mich-nb-1"])
    spoken = {alert.driver_id for plan in plans for alert in plan.alerts}
    assert "veh-101" not in spoken
    assert spoken == {f"veh-{index}" for index in range(1, 9)}
    counts = split_counts(next(plan.alerts for plan in plans if plan.alerts))
    assert len(counts) >= 2
    assert max(counts.values()) / sum(counts.values()) <= 0.75


def test_legacy_policy_blocks_the_stall_too(tmp_path: Path):
    from horizon_vision.events.labels import read_jsonl

    path = _write(tmp_path, _labels(25, include_debris=True))
    _states, plans = run_bridge(read_jsonl(path), _specs(), "legacy")
    blocked = {lane for plan in plans for lane in plan.blocked}
    assert "mich-nb-1" in blocked
    assert "mich-nb-2" in blocked


def test_clearing_debris_drops_the_block_and_the_alerts(tmp_path: Path):
    from horizon_vision.events.labels import read_jsonl

    frames = _labels(20, include_debris=True) + _labels(20, include_debris=False)
    for index, frame in enumerate(frames):
        frame["index"] = index
        frame["t"] = index * 0.1
    _states, plans = run_bridge(read_jsonl(_write(tmp_path, frames)), _specs(), "loop")
    assert any(plan.blocked == ("mich-nb-2",) or "mich-nb-2" in plan.blocked for plan in plans)
    assert plans[-1].blocked == ()
    assert plans[-1].alerts == ()


def test_loop_hub_trusts_a_block_the_default_floor_drops():
    graph = mag_mile_graph()
    edge = graph.edges["mich-nb-0@ohio--ontario"]
    state = LaneState("mich-nb-0", "blocked", 0.0, 0.35, 10.0)
    legacy = hub_config_for("legacy")
    loop = hub_config_for("loop")
    assert LOOP_HUB_FLOOR == 0.2
    assert math.isinf(travel_time_s(edge, {state.lane: state}, 10.0, loop))
    cautious = edge.free_flow_s * legacy.cautious_factor
    assert travel_time_s(edge, {state.lane: state}, 10.0, legacy) == pytest.approx(cautious)


def test_eight_drivers_split_when_every_northbound_lane_is_blocked():
    graph = mag_mile_graph()
    now = 20.0
    states = [
        LaneStateEvent(lane=lane, state="blocked", speed=0.0, confidence=0.9, t=now)
        for lane in ("mich-nb-0", "mich-nb-1", "mich-nb-2")
    ]
    drivers = []
    for index, lane in enumerate(["mich-nb-0"] * 8, start=1):
        from horizon_vision.hub.graph import lane_route

        route = lane_route(lane, "ohio", "chicago")
        drivers.append(Driver(f"veh-{index}", graph.edges[route[0]].src, route))
    drivers.append(
        Driver(
            "veh-101",
            graph.edges[lane_route("mich-sb-0", "chicago", "ohio")[0]].src,
            lane_route("mich-sb-0", "chicago", "ohio"),
        )
    )
    plans = build_plans(states, drivers, hub_config_for("loop"), graph)
    assert len(plans) == 1
    ids = [alert.driver_id for alert in plans[0].alerts]
    assert "veh-101" not in ids
    assert len(ids) == 8
    via = [corridor_of(alert.route) for alert in plans[0].alerts]
    assert via[:4] == ["rush-nb"] * 4
    assert via[4:] == ["wabash-nb"] * 4


def test_loop_ignores_a_slow_southbound_lane_when_the_closure_is_northbound():
    graph = mag_mile_graph()
    now = 4.0
    states = [
        LaneStateEvent(lane=lane, state="blocked", speed=0.0, confidence=0.9, t=now)
        for lane in ("mich-nb-0", "mich-nb-1", "mich-nb-2")
    ]
    states.append(LaneStateEvent(lane="mich-sb-1", state="slow", speed=0.67, confidence=0.83, t=now))
    drivers = []
    for index, lane in enumerate(["mich-nb-0"] * 4, start=1):
        route = lane_route(lane, "ohio", "chicago")
        drivers.append(Driver(f"veh-{index}", graph.edges[route[0]].src, route))
    sb = lane_route("mich-sb-1", "chicago", "ohio")
    drivers.append(Driver("veh-102", graph.edges[sb[0]].src, sb))
    plans = build_plans(states, drivers, hub_config_for("loop"), graph, closures_only=True)
    ids = [alert.driver_id for alert in plans[0].alerts]
    assert "veh-102" not in ids
    assert ids == [f"veh-{index}" for index in range(1, 5)]
    open_plans = build_plans(states, drivers, hub_config_for("legacy"), graph, closures_only=False)
    assert any(alert.driver_id == "veh-102" for alert in open_plans[0].alerts)


def test_unknown_only_monitor_does_not_block_on_a_vehicle():
    monitor = monitor_for("loop")
    assert isinstance(monitor, LaneMonitor)
    assert monitor.vehicle_stall_hold_s is None
    stall = EdgeEvent(
        cls="vehicle",
        unknown=False,
        x=5.5,
        y=10.0,
        speed=0.0,
        lane="mich-nb-1",
        confidence=0.9,
        t=0.0,
        track_id="veh-stall",
    )
    debris = EdgeEvent(
        cls="unknown",
        unknown=True,
        x=2.0,
        y=10.0,
        speed=0.0,
        lane="mich-nb-0",
        confidence=0.08,
        t=0.0,
        track_id="deb-1",
    )
    # Gaps must stay within max_gap_s (0.5) or the dwell episode resets.
    for t in (0.0, 0.5, 1.0, 1.5, 2.0):
        stall = EdgeEvent(
            cls="vehicle",
            unknown=False,
            x=5.5,
            y=10.0,
            speed=0.0,
            lane="mich-nb-1",
            confidence=0.9,
            t=t,
            track_id="veh-stall",
        )
        debris = EdgeEvent(
            cls="unknown",
            unknown=True,
            x=2.0,
            y=10.0,
            speed=0.0,
            lane="mich-nb-0",
            confidence=0.08,
            t=t,
            track_id="deb-1",
        )
        got = {event.lane: event for event in monitor.update(t, [stall, debris])}
    assert got["mich-nb-1"].state == "slow"
    assert got["mich-nb-0"].state == "blocked"
