"""Per-driver reroute decisions and a mock phone sink.

A driver keeps a planned edge sequence and a current node (the start of that
sequence). We recompute a path to the same destination under live lane costs.
An alert is emitted only when the new path saves at least ``min_savings_s``
against continuing on the plan. An impassable plan has infinite ETA, which
clears that bar whenever a finite detour exists. Smaller savings stay quiet.

Anti-herding runs between batches. After a batch, each edge that a rerouted
driver was sent onto (an edge on the new route that was not on their plan)
gains one count. Later batches pay ``1 + herd_factor * count`` on those edges.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from horizon_vision.hub.graph import (
    Edge,
    HubConfig,
    StreetGraph,
    state_is_untrusted,
    travel_time_s,
)
from horizon_vision.hub.lane_state import LaneState
from horizon_vision.hub.routing import astar


@dataclass(frozen=True, slots=True)
class Driver:
    """A driver already on a planned route. ``node`` is their current node."""

    driver_id: str
    node: str
    route: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RerouteAlert:
    """Structured alert for the phone. Times are seconds. ``t`` is the hub clock.

    Non-finite ETAs (an impassable plan) become JSON ``null``. Infinite
    ``saved_s`` still counts as clearing the savings threshold.
    """

    driver_id: str
    reason: str
    old_eta_s: float
    new_eta_s: float
    saved_s: float
    route: tuple[str, ...]
    t: float

    def to_dict(self) -> dict[str, object]:
        return {
            "driver_id": self.driver_id,
            "reason": self.reason,
            "old_eta_s": _json_seconds(self.old_eta_s),
            "new_eta_s": _json_seconds(self.new_eta_s),
            "saved_s": _json_seconds(self.saved_s),
            "route": list(self.route),
            "t": self.t,
        }


def _json_seconds(value: float) -> float | None:
    if not math.isfinite(value):
        return None
    return round(float(value), 3)


@dataclass(frozen=True, slots=True)
class Decision:
    driver_id: str
    old_eta_s: float
    new_eta_s: float
    saved_s: float
    route: tuple[str, ...]
    reason: str

    def alerts(self, min_savings_s: float, t: float) -> RerouteAlert | None:
        if not math.isfinite(self.new_eta_s):
            return None
        if self.saved_s < min_savings_s:
            return None
        return RerouteAlert(
            driver_id=self.driver_id,
            reason=self.reason or "reroute",
            old_eta_s=self.old_eta_s,
            new_eta_s=self.new_eta_s,
            saved_s=self.saved_s,
            route=self.route,
            t=t,
        )


class JsonlPhoneSink:
    """Mock phone delivery. Appends one JSON object per line. No network."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def write(self, alert: RerouteAlert) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(alert.to_dict(), separators=(",", ":")) + "\n")

    def write_all(self, alerts: Sequence[RerouteAlert]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        text = "".join(
            json.dumps(alert.to_dict(), separators=(",", ":")) + "\n" for alert in alerts
        )
        self.path.write_text(text, encoding="utf-8")


def index_states(states: Sequence[LaneState] | Mapping[str, LaneState]) -> dict[str, LaneState]:
    if isinstance(states, Mapping):
        return dict(states)
    indexed: dict[str, LaneState] = {}
    for state in states:
        indexed[state.lane] = state
    return indexed


def _planned_edges(graph: StreetGraph, driver: Driver) -> tuple[str, ...]:
    if not driver.route:
        raise ValueError(f"{driver.driver_id} has an empty planned route")
    first = graph.edges[driver.route[0]]
    if first.src != driver.node:
        raise ValueError(f"{driver.driver_id} is at {driver.node}, not on {first.id}")
    for left_id, right_id in zip(driver.route, driver.route[1:]):
        left = graph.edges[left_id]
        right = graph.edges[right_id]
        if left.dst != right.src:
            raise ValueError(f"{driver.driver_id} route breaks between {left_id} and {right_id}")
    return driver.route


def _reason(
    graph: StreetGraph,
    edge_ids: Sequence[str],
    states: Mapping[str, LaneState],
    now: float,
    config: HubConfig,
) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for edge_id in edge_ids:
        state = states.get(graph.edges[edge_id].lane)
        if state is None:
            continue
        if state_is_untrusted(state, now, config):
            label = f"{state.lane}:cautious"
        elif state.state == "clear":
            continue
        else:
            label = f"{state.lane}:{state.state}"
        if label not in seen:
            seen.add(label)
            parts.append(label)
    return ",".join(parts)


def evaluate_driver(
    graph: StreetGraph,
    driver: Driver,
    states: Mapping[str, LaneState],
    now: float,
    config: HubConfig,
    herd: Mapping[str, int] | None = None,
) -> Decision:
    """Recompute one driver. Does not apply anti-herding side effects."""
    planned = _planned_edges(graph, driver)
    counts = herd or {}

    def cost_of(edge: Edge) -> float:
        return travel_time_s(edge, states, now, config, counts.get(edge.id, 0))

    old_eta = 0.0
    for edge_id in planned:
        old_eta += cost_of(graph.edges[edge_id])
    destination = graph.edges[planned[-1]].dst
    found = astar(graph, driver.node, destination, cost_of)
    if found is None:
        new_eta = math.inf
        route: tuple[str, ...] = ()
    else:
        new_eta = found.cost_s
        route = found.edges
    saved = old_eta - new_eta
    return Decision(
        driver_id=driver.driver_id,
        old_eta_s=old_eta,
        new_eta_s=new_eta,
        saved_s=saved,
        route=route,
        reason=_reason(graph, planned, states, now, config),
    )


def plan_reroutes(
    graph: StreetGraph,
    drivers: Sequence[Driver],
    states: Sequence[LaneState] | Mapping[str, LaneState],
    now: float,
    config: HubConfig | None = None,
) -> list[RerouteAlert]:
    """Reroute a sequence of drivers in batches, then load the detours they took."""
    cfg = config if config is not None else HubConfig()
    indexed = index_states(states)
    herd: dict[str, int] = {}
    alerts: list[RerouteAlert] = []
    batch = cfg.batch_size
    ordered = list(drivers)
    for start in range(0, len(ordered), batch):
        emitted: list[tuple[Driver, RerouteAlert]] = []
        for driver in ordered[start : start + batch]:
            decision = evaluate_driver(graph, driver, indexed, now, cfg, herd)
            alert = decision.alerts(cfg.min_savings_s, now)
            if alert is not None:
                emitted.append((driver, alert))
        for driver, alert in emitted:
            planned = set(driver.route)
            for edge_id in alert.route:
                if edge_id not in planned:
                    herd[edge_id] = herd.get(edge_id, 0) + 1
        alerts.extend(alert for _driver, alert in emitted)
    return alerts
