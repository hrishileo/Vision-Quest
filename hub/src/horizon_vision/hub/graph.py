"""Approximate Magnificent Mile street graph and edge travel times.

Coordinates are metres on the same ground plane as ``horizon_vision.events``:
``x`` east, ``y`` south. The origin is the Michigan Avenue centerline at
Chicago Avenue.

Lengths come from the Chicago address grid (800 numbers per mile, State /
Madison origin), not from a survey. Downtown blocks are subdivided, so this
is an approximation. Address numbers follow the city grid as listed in
"Streets and highways of Chicago":

- Ohio Street 600 N, Ontario Street 628 N, Erie Street 658 N,
  Huron Street 700 N, Chicago Avenue 800 N
- Wabash Avenue 44 E, Rush Street 65 E, Michigan Avenue 100 E

Rush and Wabash are both west of Michigan. Rush sits between them.

Real one-ways in this stretch are not enforced. Rush is northbound-only
north of Ohio, Wabash is southbound, Ohio and Erie are eastbound, and
Ontario and Huron are westbound. The graph links both directions at every
junction so a driver can leave Michigan onto either parallel street.

Each edge stores a length and a speed limit. The base cost is travel time,
``length / speed_limit``.

Michigan and Chicago Avenue lane ids and center offsets are copied from
Vision-Quest ``src/lib/guide/city.ts`` (``main``, and the same list on
recorder branch ``cursor/cam0-corpus-d178``). Michigan is six lanes, inner
index 0: ``mich-nb-0..2`` at x = 2.0, 5.5, 9.0 and ``mich-sb-0..2`` at
x = −2.0, −5.5, −9.0. Chicago Avenue in that scene is ``chi-eb-0``,
``chi-eb-1``, ``chi-wb-0``, ``chi-wb-1``. This graph's Chicago crossing is
one link each way, tagged ``chi-eb-0`` and ``chi-wb-0``. Rush, Wabash, and
the other cross streets are not lanes in that scene; their ids are hub-local.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping

from horizon_vision.hub.lane_state import LaneState

# Statute mile. 800 address numbers per mile on the Chicago grid.
METRES_PER_MILE = 1609.344
METRES_PER_NUMBER = METRES_PER_MILE / 800
MPH_TO_MPS = METRES_PER_MILE / 3600.0

MICHIGAN_SPEED_MPS = 30 * MPH_TO_MPS
SIDE_STREET_SPEED_MPS = 25 * MPH_TO_MPS

# Lane centers from Vision-Quest city.ts. Inner lane is index 0. +x is east.
MICH_NB_X = (2.0, 5.5, 9.0)
MICH_SB_X = (-2.0, -5.5, -9.0)
MICHIGAN_LANE_IDS = (
    "mich-nb-0",
    "mich-nb-1",
    "mich-nb-2",
    "mich-sb-0",
    "mich-sb-1",
    "mich-sb-2",
)
# Scene also has chi-eb-1 and chi-wb-1. The crossing below uses the inner pair.
CHICAGO_LANE_IDS = ("chi-eb-0", "chi-eb-1", "chi-wb-0", "chi-wb-1")

# North-address numbers. y is metres south of Chicago Avenue (800 N).
CROSS_STREETS: tuple[tuple[str, int], ...] = (
    ("ohio", 600),
    ("ontario", 628),
    ("erie", 658),
    ("huron", 700),
    ("chicago", 800),
)
SOUTH_TO_NORTH: tuple[str, ...] = tuple(name for name, _number in CROSS_STREETS)

# East-address numbers relative to Michigan Avenue at 100 E.
X_RUSH = -(100 - 65) * METRES_PER_NUMBER
X_WABASH = -(100 - 44) * METRES_PER_NUMBER


def cross_y(address_n: int) -> float:
    """Metres south of Chicago Avenue for a north address number."""
    return (800 - address_n) * METRES_PER_NUMBER


@dataclass(frozen=True, slots=True)
class HubConfig:
    """Knobs for costing lanes and deciding whether to speak up."""

    min_savings_s: float = 60.0
    max_age_s: float = 60.0
    min_confidence: float = 0.5
    cautious_factor: float = 2.0
    herd_factor: float = 0.25
    batch_size: int = 4

    def __post_init__(self) -> None:
        if self.min_savings_s < 0:
            raise ValueError("min_savings_s must be >= 0")
        if self.max_age_s < 0:
            raise ValueError("max_age_s must be >= 0")
        if not 0 <= self.min_confidence <= 1:
            raise ValueError("min_confidence must be in [0, 1]")
        if self.cautious_factor < 1:
            raise ValueError("cautious_factor must be >= 1 (worse than free flow)")
        if self.herd_factor < 0:
            raise ValueError("herd_factor must be >= 0")
        if self.batch_size < 1:
            raise ValueError("batch_size must be >= 1")


@dataclass(frozen=True, slots=True)
class Edge:
    """One directed street segment. ``lane`` is the id a lane state names."""

    id: str
    src: str
    dst: str
    length_m: float
    speed_mps: float
    lane: str

    @property
    def free_flow_s(self) -> float:
        return self.length_m / self.speed_mps


class StreetGraph:
    """Directed graph. Node coordinates are ``(x east, y south)`` metres."""

    def __init__(self) -> None:
        self.nodes: dict[str, tuple[float, float]] = {}
        self.edges: dict[str, Edge] = {}
        self.outgoing: dict[str, list[str]] = {}
        self._top_speed: float | None = None

    def add_node(self, node_id: str, x: float, y: float) -> None:
        self.nodes[node_id] = (x, y)
        self.outgoing.setdefault(node_id, [])

    def add_edge(
        self,
        edge_id: str,
        src: str,
        dst: str,
        speed_mps: float,
        lane: str,
    ) -> Edge:
        if src not in self.nodes or dst not in self.nodes:
            raise KeyError(f"edge {edge_id} references an unknown node")
        x1, y1 = self.nodes[src]
        x2, y2 = self.nodes[dst]
        length = math.hypot(x2 - x1, y2 - y1)
        if length <= 0 or speed_mps <= 0:
            raise ValueError(f"edge {edge_id} needs positive length and speed")
        if edge_id in self.edges:
            raise ValueError(f"duplicate edge {edge_id}")
        edge = Edge(
            id=edge_id,
            src=src,
            dst=dst,
            length_m=length,
            speed_mps=speed_mps,
            lane=lane,
        )
        self.edges[edge_id] = edge
        self.outgoing[src].append(edge_id)
        self._top_speed = None
        return edge

    @property
    def top_speed_mps(self) -> float:
        """Fastest speed limit in the graph. The A* heuristic divides by this."""
        if self._top_speed is None:
            if not self.edges:
                raise ValueError("graph has no edges")
            self._top_speed = max(edge.speed_mps for edge in self.edges.values())
        return self._top_speed

    def straight_seconds(self, src: str, dst: str) -> float:
        """Admissible time heuristic: straight-line distance / top speed limit."""
        x1, y1 = self.nodes[src]
        x2, y2 = self.nodes[dst]
        return math.hypot(x2 - x1, y2 - y1) / self.top_speed_mps


def _node(place: str, cross: str) -> str:
    if place in ("rush", "wabash"):
        return f"{place}-{cross}"
    return f"mich-{cross}-{place}"


def mag_mile_graph() -> StreetGraph:
    """A few blocks of Michigan Avenue, Rush, Wabash, and the cross streets."""
    graph = StreetGraph()
    y_by_cross = {name: cross_y(number) for name, number in CROSS_STREETS}

    # key, x, northbound lane id, southbound lane id, speed.
    # Michigan keys are the scene's 0-based lane index.
    corridors: tuple[tuple[str, float, str | None, str | None, float], ...] = (
        ("wabash", X_WABASH, "wabash-nb", "wabash-sb", SIDE_STREET_SPEED_MPS),
        ("rush", X_RUSH, "rush-nb", "rush-sb", SIDE_STREET_SPEED_MPS),
        ("sb2", MICH_SB_X[2], None, "mich-sb-2", MICHIGAN_SPEED_MPS),
        ("sb1", MICH_SB_X[1], None, "mich-sb-1", MICHIGAN_SPEED_MPS),
        ("sb0", MICH_SB_X[0], None, "mich-sb-0", MICHIGAN_SPEED_MPS),
        ("nb0", MICH_NB_X[0], "mich-nb-0", None, MICHIGAN_SPEED_MPS),
        ("nb1", MICH_NB_X[1], "mich-nb-1", None, MICHIGAN_SPEED_MPS),
        ("nb2", MICH_NB_X[2], "mich-nb-2", None, MICHIGAN_SPEED_MPS),
    )

    for place, x, _nb, _sb, _speed in corridors:
        for cross, y in y_by_cross.items():
            graph.add_node(_node(place, cross), x, y)

    for place, _x, nb_lane, sb_lane, speed in corridors:
        for src_cross, dst_cross in zip(SOUTH_TO_NORTH, SOUTH_TO_NORTH[1:]):
            if nb_lane is not None:
                graph.add_edge(
                    f"{nb_lane}@{src_cross}--{dst_cross}",
                    _node(place, src_cross),
                    _node(place, dst_cross),
                    speed,
                    nb_lane,
                )
            if sb_lane is not None:
                graph.add_edge(
                    f"{sb_lane}@{dst_cross}--{src_cross}",
                    _node(place, dst_cross),
                    _node(place, src_cross),
                    speed,
                    sb_lane,
                )

    west_to_east = [place for place, *_rest in corridors]
    for cross in SOUTH_TO_NORTH:
        for left, right in zip(west_to_east, west_to_east[1:]):
            east_lane = _crossing_lane(cross, eastbound=True)
            west_lane = _crossing_lane(cross, eastbound=False)
            graph.add_edge(
                f"{east_lane}@{left}--{right}",
                _node(left, cross),
                _node(right, cross),
                SIDE_STREET_SPEED_MPS,
                east_lane,
            )
            graph.add_edge(
                f"{west_lane}@{right}--{left}",
                _node(right, cross),
                _node(left, cross),
                SIDE_STREET_SPEED_MPS,
                west_lane,
            )
    return graph


def _crossing_lane(cross: str, eastbound: bool) -> str:
    """Lane id for a cross-street link.

    Chicago Avenue uses the Vision-Quest inner lanes. Other cross streets
    are not in that scene, so they keep a hub-local id.
    """
    if cross == "chicago":
        return "chi-eb-0" if eastbound else "chi-wb-0"
    return f"{cross}-ew"


def lane_route(lane: str, start: str, end: str) -> tuple[str, ...]:
    """Edge ids along ``lane`` from ``start`` cross street to ``end``.

    ``start`` and ``end`` are names in :data:`SOUTH_TO_NORTH`. Northbound
    lanes run toward Chicago Avenue; southbound lanes run toward Ohio.
    """
    order = list(SOUTH_TO_NORTH)
    i = order.index(start)
    j = order.index(end)
    if i == j:
        raise ValueError("route needs two different cross streets")
    if j > i:
        crosses = order[i : j + 1]
    else:
        crosses = order[j : i + 1][::-1]
    return tuple(f"{lane}@{a}--{b}" for a, b in zip(crosses, crosses[1:]))


def state_is_untrusted(state: LaneState, now: float, config: HubConfig) -> bool:
    """Stale or low-confidence observations are not safe to treat as fact."""
    if state.confidence < config.min_confidence:
        return True
    return (now - state.t) > config.max_age_s


def travel_time_s(
    edge: Edge,
    states: Mapping[str, LaneState],
    now: float,
    config: HubConfig,
    herd_count: int = 0,
) -> float:
    """Travel time on ``edge`` after lane state and anti-herding.

    Trusted ``blocked`` is impassable. Trusted ``slow`` is
    ``length / observed speed``, capped at the edge speed limit so a bad
    reading cannot outrun the heuristic. ``unknown``, and anything stale or
    below ``min_confidence``, uses ``free_flow * cautious_factor``, which is
    worse than free flow and is never the clear-road cost. Anti-herding
    multiplies the finite cost by ``1 + herd_factor * drivers_sent``.
    """
    base = edge.free_flow_s
    state = states.get(edge.lane)
    if state is None:
        live = base
    elif state_is_untrusted(state, now, config) or state.state in ("unknown",):
        live = base * config.cautious_factor
    elif state.state == "blocked":
        return math.inf
    elif state.state == "slow":
        if state.speed is None or state.speed <= 0:
            return math.inf
        live = edge.length_m / min(state.speed, edge.speed_mps)
    elif state.state == "clear":
        live = base
    else:
        live = base * config.cautious_factor

    if herd_count > 0 and math.isfinite(live):
        live *= 1.0 + config.herd_factor * herd_count
    return live
