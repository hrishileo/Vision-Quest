"""Debris on Michigan Avenue northbound, and the alerts it produces.

Eight northbound drivers share a route that crosses the blocked lanes.
Two southbound drivers do not. The northbound drivers are decided in two
batches so anti-herding can move the second batch onto the other parallel
street.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from horizon_vision.hub.graph import SOUTH_TO_NORTH, HubConfig, StreetGraph, lane_route, mag_mile_graph
from horizon_vision.hub.lane_state import LaneState, lane_state_from_mapping
from horizon_vision.hub.reroute import Driver, RerouteAlert, plan_reroutes

NOW_S = 1000.0


def debris_lane_states(now: float = NOW_S) -> list[LaneState]:
    """All three Vision-Quest northbound lanes blocked. Payloads use the adapter."""
    payloads = tuple(
        {
            "lane": lane,
            "state": "blocked",
            "speed": None,
            "confidence": 0.95,
            "t": now,
        }
        for lane in ("mich-nb-0", "mich-nb-1", "mich-nb-2")
    )
    return [lane_state_from_mapping(payload) for payload in payloads]


def _driver(graph: StreetGraph, driver_id: str, lane: str, start: str, end: str) -> Driver:
    route = lane_route(lane, start, end)
    node = graph.edges[route[0]].src
    return Driver(driver_id=driver_id, node=node, route=route)


def debris_drivers(graph: StreetGraph) -> list[Driver]:
    """Northbound drivers first so each anti-herding batch is all northbound."""
    south, north = SOUTH_TO_NORTH[0], SOUTH_TO_NORTH[-1]
    drivers = [
        _driver(graph, f"nb-{index:02d}", "mich-nb-0", south, north) for index in range(1, 9)
    ]
    drivers.extend(
        _driver(graph, f"sb-{index:02d}", "mich-sb-0", north, south) for index in range(1, 3)
    )
    return drivers


def corridor_of(route: tuple[str, ...] | list[str]) -> str:
    """Which longitudinal corridor a route actually travels."""
    for name in (
        "wabash-nb",
        "rush-nb",
        "wabash-sb",
        "rush-sb",
        "mich-nb-0",
        "mich-nb-1",
        "mich-nb-2",
        "mich-sb-0",
        "mich-sb-1",
        "mich-sb-2",
    ):
        if any(edge_id.startswith(f"{name}@") for edge_id in route):
            return name
    return "other"


@dataclass(frozen=True, slots=True)
class DebrisRun:
    alerts: tuple[RerouteAlert, ...]
    silent_driver_ids: tuple[str, ...]
    summary: str


def run_debris_scenario(
    now: float = NOW_S,
    config: HubConfig | None = None,
) -> DebrisRun:
    cfg = config if config is not None else HubConfig()
    graph = mag_mile_graph()
    drivers = debris_drivers(graph)
    alerts = tuple(plan_reroutes(graph, drivers, debris_lane_states(now), now, cfg))
    spoken = {alert.driver_id for alert in alerts}
    silent = tuple(driver.driver_id for driver in drivers if driver.driver_id not in spoken)
    return DebrisRun(
        alerts=alerts,
        silent_driver_ids=silent,
        summary=format_summary(alerts, silent, now, cfg),
    )


def format_summary(
    alerts: tuple[RerouteAlert, ...] | list[RerouteAlert],
    silent_driver_ids: tuple[str, ...] | list[str],
    now: float,
    config: HubConfig,
) -> str:
    counts: dict[str, int] = {}
    lines = [
        "HorizonVision hub debris scenario",
        "Map: approximate Chicago address grid, Michigan Ave centerline at Chicago Ave.",
        "Axes: x east metres, y south metres (same plane as edge events).",
        "Ohio 600 N, Ontario 628 N, Erie 658 N, Huron 700 N, Chicago Ave 800 N;",
        "Wabash 44 E, Rush 65 E, Michigan 100 E. Both parallel streets are west of Michigan.",
        "Blocked lanes: mich-nb-0, mich-nb-1, mich-nb-2 (Vision-Quest ids, inner is 0).",
        (
            f"t={now:.1f}s  min_savings_s={config.min_savings_s:.0f}  "
            f"herd_factor={config.herd_factor}  batch_size={config.batch_size}"
        ),
        "",
        f"alerts: {len(alerts)}",
    ]
    for alert in alerts:
        via = corridor_of(alert.route)
        counts[via] = counts.get(via, 0) + 1
        lines.append(
            f"  {alert.driver_id}  reason={alert.reason}  "
            f"old_eta_s={_fmt_eta(alert.old_eta_s)}  "
            f"new_eta_s={_fmt_eta(alert.new_eta_s)}  "
            f"saved_s={_fmt_saved(alert.saved_s, config.min_savings_s)}  "
            f"via={via}"
        )
    lines.append("")
    if silent_driver_ids:
        lines.append(
            "no alert: "
            + ", ".join(silent_driver_ids)
            + " (planned route does not cross the blocked lanes)"
        )
    else:
        lines.append("no alert: (none)")
    split = "  ".join(f"{name}={count}" for name, count in sorted(counts.items())) or "(none)"
    lines.append(f"detour split: {split}")
    lines.append(
        "JSON null old_eta_s/saved_s means the planned route is impassable; "
        f"that still clears the {config.min_savings_s:.0f}s savings bar."
    )
    return "\n".join(lines) + "\n"


def _fmt_eta(value: float) -> str:
    if math.isinf(value):
        return "impassable"
    return f"{value:.3f}"


def _fmt_saved(value: float, threshold: float) -> str:
    if math.isinf(value):
        return f"unbounded (>={threshold:.0f}s; planned route impassable)"
    return f"{value:.3f}"
