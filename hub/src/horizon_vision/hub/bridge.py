"""Closed loop from CAM0 labels to reroute plans.

Labels go through the edge lane monitor, then the hub planner. A plan is
emitted whenever the set of ``blocked`` lanes changes. An empty blocked set
emits an empty alert list so the sim can stop rerouting.

Two policies:

- ``legacy`` is the published default. A stopped vehicle can close a lane,
  and the hub ignores a block whose confidence is under 0.5.
- ``loop`` closes a lane only for class ``unknown`` (debris), trusts a block
  down to the edge publish floor (0.2), and lets a shallow debris ray dwell
  at 0.05. A stall or a queue stays ``slow``.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from horizon_vision.events.labels import FrameLabels, read_jsonl
from horizon_vision.events.lane_state import LaneMonitor, LaneStateEvent, collect_lane_states
from horizon_vision.hub.graph import HubConfig, StreetGraph, lane_route, mag_mile_graph
from horizon_vision.hub.lane_state import lane_state_from_mapping
from horizon_vision.hub.reroute import Driver, RerouteAlert, plan_reroutes
from horizon_vision.hub.scenario import corridor_of

LOOP_UNKNOWN_FLOOR = 0.05
LOOP_HUB_FLOOR = 0.2


@dataclass(frozen=True, slots=True)
class DriverSpec:
    driver_id: str
    lane: str
    origin: str
    destination: str


@dataclass(frozen=True, slots=True)
class Plan:
    t: float
    blocked: tuple[str, ...]
    alerts: tuple[RerouteAlert, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "t": self.t,
            "blocked": list(self.blocked),
            "alerts": [alert.to_dict() for alert in self.alerts],
        }


def monitor_for(policy: str) -> LaneMonitor:
    if policy == "legacy":
        return LaneMonitor()
    if policy == "loop":
        return LaneMonitor(
            block_classes=("unknown",),
            unknown_min_confidence=LOOP_UNKNOWN_FLOOR,
        )
    raise ValueError(f"unknown policy {policy!r}")


def hub_config_for(policy: str) -> HubConfig:
    if policy == "legacy":
        return HubConfig()
    if policy == "loop":
        return HubConfig(min_confidence=LOOP_HUB_FLOOR)
    raise ValueError(f"unknown policy {policy!r}")


def drivers_from_specs(graph: StreetGraph, specs: Sequence[DriverSpec]) -> list[Driver]:
    drivers: list[Driver] = []
    for spec in specs:
        route = lane_route(spec.lane, spec.origin, spec.destination)
        node = graph.edges[route[0]].src
        drivers.append(Driver(driver_id=spec.driver_id, node=node, route=route))
    return drivers


def parse_driver_specs(payload: Mapping[str, Any]) -> list[DriverSpec]:
    raw = payload.get("drivers")
    if not isinstance(raw, list):
        raise ValueError("drivers must be a list")
    specs: list[DriverSpec] = []
    for item in raw:
        if not isinstance(item, Mapping):
            raise ValueError("driver must be an object")
        specs.append(
            DriverSpec(
                driver_id=str(item["driver_id"]),
                lane=str(item["lane"]),
                origin=str(item["origin"]),
                destination=str(item["destination"]),
            )
        )
    return specs


def _snapshot(latest: Mapping[str, LaneStateEvent]) -> list[dict[str, Any]]:
    return [latest[lane].to_dict() for lane in sorted(latest)]


def build_plans(
    states: Sequence[LaneStateEvent],
    drivers: Sequence[Driver],
    config: HubConfig,
    graph: StreetGraph | None = None,
    closures_only: bool = False,
) -> list[Plan]:
    """Replan whenever the blocked-lane set changes. Absence of a block clears it.

    ``closures_only`` drops alerts whose reason is a slow or cautious lane.
    A southbound driver with a momentary slow reading must not be sent around
    the block on Michigan.
    """
    street = graph if graph is not None else mag_mile_graph()
    by_t: dict[float, list[LaneStateEvent]] = {}
    for state in states:
        by_t.setdefault(state.t, []).append(state)
    latest: dict[str, LaneStateEvent] = {}
    blocked: set[str] = set()
    plans: list[Plan] = []
    for t in sorted(by_t):
        for state in by_t[t]:
            latest[state.lane] = state
        now = {lane for lane, state in latest.items() if state.state == "blocked"}
        if now == blocked:
            continue
        blocked = set(now)
        if blocked:
            hub_states = [lane_state_from_mapping(item) for item in _snapshot(latest)]
            alerts = tuple(plan_reroutes(street, drivers, hub_states, t, config))
            if closures_only:
                alerts = tuple(alert for alert in alerts if ":blocked" in alert.reason)
        else:
            alerts = ()
        plans.append(Plan(t=t, blocked=tuple(sorted(blocked)), alerts=alerts))
    return plans


def run_bridge(
    frames: Sequence[FrameLabels],
    specs: Sequence[DriverSpec],
    policy: str,
) -> tuple[list[LaneStateEvent], list[Plan]]:
    graph = mag_mile_graph()
    drivers = drivers_from_specs(graph, specs)
    states = collect_lane_states(list(frames), monitor=monitor_for(policy))
    plans = build_plans(
        states,
        drivers,
        hub_config_for(policy),
        graph,
        closures_only=policy == "loop",
    )
    return states, plans


def split_counts(alerts: Sequence[RerouteAlert]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for alert in alerts:
        name = corridor_of(alert.route)
        counts[name] = counts.get(name, 0) + 1
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Labels to lane state to reroute plans")
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--drivers", type=Path, required=True)
    parser.add_argument("--policy", choices=("legacy", "loop"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--states", type=Path, default=None)
    args = parser.parse_args(argv)

    specs = parse_driver_specs(json.loads(args.drivers.read_text(encoding="utf-8")))
    frames = read_jsonl(args.labels)
    states, plans = run_bridge(frames, specs, args.policy)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"policy": args.policy, "plans": [plan.to_dict() for plan in plans]}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    if args.states is not None:
        args.states.parent.mkdir(parents=True, exist_ok=True)
        text = "".join(json.dumps(state.to_dict()) + "\n" for state in states)
        args.states.write_text(text, encoding="utf-8")
    last = plans[-1] if plans else None
    blocked = ",".join(last.blocked) if last else ""
    print(f"plans={len(plans)} blocked={blocked or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
