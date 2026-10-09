"""Hub detour: Mag Mile graph, A* optimality, reroute threshold, anti-herding."""

import json
import math
import random

import pytest

from horizon_vision.hub.graph import (
    CHICAGO_LANE_IDS,
    METRES_PER_MILE,
    MICHIGAN_LANE_IDS,
    MICH_NB_X,
    MICH_SB_X,
    HubConfig,
    lane_route,
    mag_mile_graph,
    travel_time_s,
)
from horizon_vision.hub.lane_state import LaneState, LaneStateError, lane_state_from_mapping
from horizon_vision.hub.reroute import JsonlPhoneSink, evaluate_driver, plan_reroutes
from horizon_vision.hub.routing import astar, dijkstra
from horizon_vision.hub.scenario import (
    corridor_of,
    debris_drivers,
    debris_lane_states,
    run_debris_scenario,
)


def test_lane_state_adapter_is_the_only_wire_parser():
    state = lane_state_from_mapping(
        {
            "lane": "mich-nb-2",
            "state": "slow",
            "speed": 4.5,
            "confidence": 0.8,
            "t": 12.0,
            "segment": "ignored-until-edge-lands",
        }
    )
    assert state == LaneState("mich-nb-2", "slow", 4.5, 0.8, 12.0)
    with pytest.raises(LaneStateError):
        lane_state_from_mapping(
            {"lane": "mich-nb-1", "state": "closed", "speed": 0, "confidence": 1, "t": 0}
        )


def test_mag_mile_axes_and_free_flow_time():
    graph = mag_mile_graph()
    ohio_nb = graph.nodes["mich-ohio-nb0"]
    chicago_nb = graph.nodes["mich-chicago-nb0"]
    # y grows south, so Ohio is south of Chicago Avenue.
    assert ohio_nb[1] > chicago_nb[1]
    # Rush and Wabash are west of the Michigan centerline (100 E grid).
    assert graph.nodes["wabash-ohio"][0] < graph.nodes["rush-ohio"][0] < ohio_nb[0]
    for index, x in enumerate(MICH_NB_X):
        assert graph.nodes[f"mich-ohio-nb{index}"][0] == x
    for index, x in enumerate(MICH_SB_X):
        assert graph.nodes[f"mich-ohio-sb{index}"][0] == x
    lane_ids = {edge.lane for edge in graph.edges.values()}
    assert set(MICHIGAN_LANE_IDS) <= lane_ids
    assert {"chi-eb-0", "chi-wb-0"} <= lane_ids
    assert CHICAGO_LANE_IDS == ("chi-eb-0", "chi-eb-1", "chi-wb-0", "chi-wb-1")
    route = lane_route("mich-nb-0", "ohio", "chicago")
    free = sum(graph.edges[edge_id].free_flow_s for edge_id in route)
    # 800 N to 600 N is a quarter mile. At 30 mph that is 30 seconds.
    assert free == pytest.approx(0.25 * 3600 / 30, abs=1e-6)
    start, end = graph.edges[route[0]].src, graph.edges[route[-1]].dst
    assert graph.straight_seconds(start, end) <= free + 1e-9
    assert graph.nodes["mich-ohio-nb0"][1] == pytest.approx(200 / 800 * METRES_PER_MILE)


def test_astar_matches_dijkstra_on_randomized_costs():
    graph = mag_mile_graph()
    rng = random.Random(5)
    nodes = list(graph.nodes)
    compared = 0
    for _trial in range(40):
        multipliers = {edge_id: rng.uniform(1.0, 5.0) for edge_id in graph.edges}

        def cost_of(edge, multipliers=multipliers):
            return edge.free_flow_s * multipliers[edge.id]

        src = rng.choice(nodes)
        dst = rng.choice(nodes)
        star = astar(graph, src, dst, cost_of)
        plain = dijkstra(graph, src, dst, cost_of)
        if star is None:
            assert plain is None
            continue
        assert plain is not None
        assert star.cost_s == pytest.approx(plain.cost_s, rel=1e-9, abs=1e-6)
        walked = sum(cost_of(graph.edges[edge_id]) for edge_id in star.edges)
        assert walked == pytest.approx(star.cost_s, rel=1e-9, abs=1e-6)
        compared += 1
    assert compared >= 30
    stay = astar(graph, "mich-ohio-nb0", "mich-ohio-nb0", lambda edge: edge.free_flow_s)
    assert stay is not None and stay.cost_s == 0 and stay.edges == ()


def test_debris_reroutes_only_drivers_who_cross_the_block():
    result = run_debris_scenario()
    assert {alert.driver_id for alert in result.alerts} == {f"nb-{i:02d}" for i in range(1, 9)}
    assert result.silent_driver_ids == ("sb-01", "sb-02")
    for alert in result.alerts:
        assert alert.reason == "mich-nb-0:blocked"
        assert math.isinf(alert.old_eta_s)
        assert alert.saved_s >= 60
        assert math.isfinite(alert.new_eta_s)
        assert corridor_of(alert.route) in ("rush-nb", "wabash-nb")
        assert not any(edge_id.startswith("mich-nb-") for edge_id in alert.route)


def test_slow_but_under_threshold_emits_nothing():
    graph = mag_mile_graph()
    now = 1000.0
    config = HubConfig()
    states = [
        lane_state_from_mapping(
            {"lane": lane, "state": "slow", "speed": 4.0, "confidence": 0.9, "t": now}
        )
        for lane in ("mich-nb-0", "mich-nb-1", "mich-nb-2")
    ]
    driver = next(driver for driver in debris_drivers(graph) if driver.driver_id == "nb-01")
    decision = evaluate_driver(graph, driver, {state.lane: state for state in states}, now, config)
    assert decision.saved_s > 0
    assert decision.saved_s < config.min_savings_s
    assert corridor_of(decision.route) in ("rush-nb", "wabash-nb")
    assert plan_reroutes(graph, [driver], states, now, config) == []


def test_stale_or_low_confidence_is_cautious_not_clear():
    graph = mag_mile_graph()
    edge = graph.edges["mich-nb-0@ohio--ontario"]
    now = 500.0
    config = HubConfig()
    free = edge.free_flow_s
    cautious = free * config.cautious_factor
    untrusted = [
        LaneState("mich-nb-0", "clear", None, 0.2, now),
        LaneState("mich-nb-0", "clear", 12.0, 0.99, now - config.max_age_s - 1),
        LaneState("mich-nb-0", "unknown", None, 0.99, now),
        LaneState("mich-nb-0", "blocked", None, 0.49, now),
        LaneState("mich-nb-0", "slow", 1.0, 0.99, now - 10_000),
    ]
    for state in untrusted:
        cost = travel_time_s(edge, {state.lane: state}, now, config)
        assert cost == pytest.approx(cautious)
        assert cost > free

    fresh_clear = LaneState("mich-nb-0", "clear", None, config.min_confidence, now - config.max_age_s)
    assert travel_time_s(edge, {fresh_clear.lane: fresh_clear}, now, config) == pytest.approx(free)

    driver = next(item for item in debris_drivers(graph) if item.driver_id == "nb-01")
    route_free = sum(graph.edges[edge_id].free_flow_s for edge_id in driver.route)
    stale_clear = LaneState("mich-nb-0", "clear", None, 0.99, now - 1000)
    decision = evaluate_driver(graph, driver, {stale_clear.lane: stale_clear}, now, config)
    assert decision.old_eta_s == pytest.approx(route_free * config.cautious_factor)
    assert decision.old_eta_s > route_free
    blocked = LaneState("mich-nb-0", "blocked", None, 0.95, now)
    assert math.isinf(travel_time_s(edge, {blocked.lane: blocked}, now, config))
    slow = LaneState("mich-nb-0", "slow", 4.0, 0.95, now)
    assert travel_time_s(edge, {slow.lane: slow}, now, config) == pytest.approx(edge.length_m / 4.0)


def test_anti_herding_splits_drivers_across_side_streets():
    result = run_debris_scenario()
    via = [corridor_of(alert.route) for alert in result.alerts]
    assert via[:4] == ["rush-nb", "rush-nb", "rush-nb", "rush-nb"]
    assert via[4:] == ["wabash-nb", "wabash-nb", "wabash-nb", "wabash-nb"]
    assert len(set(via)) > 1


def test_scenario_writes_jsonl_and_summary(tmp_path):
    result = run_debris_scenario()
    output = tmp_path / "alerts.jsonl"
    summary = tmp_path / "summary.txt"
    JsonlPhoneSink(output).write_all(result.alerts)
    summary.write_text(result.summary, encoding="utf-8")

    rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 8
    assert list(rows[0]) == [
        "driver_id",
        "reason",
        "old_eta_s",
        "new_eta_s",
        "saved_s",
        "route",
        "t",
    ]
    assert rows[0]["old_eta_s"] is None
    assert rows[0]["saved_s"] is None
    assert rows[0]["new_eta_s"] >= 0
    assert "rush-nb" in summary.read_text(encoding="utf-8")
    assert "wabash-nb" in summary.read_text(encoding="utf-8")
    assert "sb-01" in summary.read_text(encoding="utf-8")
