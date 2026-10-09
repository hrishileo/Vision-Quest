"""A* and Dijkstra over travel time.

The A* heuristic is straight-line distance divided by the highest speed
limit in the graph. That is admissible: every edge takes at least
``length / top_speed``, and no path is shorter than the straight line.
It stays admissible when lane states and anti-herding only raise costs
(blocked edges are removed, slow speeds are capped at the limit, the
cautious factor is at least 1).
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass
from typing import Callable

from horizon_vision.hub.graph import Edge, StreetGraph

CostFn = Callable[[Edge], float]


@dataclass(frozen=True, slots=True)
class RouteResult:
    nodes: tuple[str, ...]
    edges: tuple[str, ...]
    cost_s: float


def _reconstruct(
    prev: dict[str, tuple[str | None, str | None]],
    dst: str,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    nodes: list[str] = [dst]
    edges: list[str] = []
    cursor = dst
    while True:
        parent, edge_id = prev[cursor]
        if parent is None or edge_id is None:
            break
        edges.append(edge_id)
        nodes.append(parent)
        cursor = parent
    edges.reverse()
    nodes.reverse()
    return tuple(nodes), tuple(edges)


def dijkstra(
    graph: StreetGraph,
    src: str,
    dst: str,
    cost_of: CostFn,
) -> RouteResult | None:
    """Lowest-cost path. ``cost_of`` returns seconds, or infinity to close an edge."""
    if src not in graph.nodes or dst not in graph.nodes:
        raise KeyError("src and dst must be graph nodes")
    if src == dst:
        return RouteResult(nodes=(src,), edges=(), cost_s=0.0)

    best: dict[str, float] = {src: 0.0}
    prev: dict[str, tuple[str | None, str | None]] = {src: (None, None)}
    heap: list[tuple[float, str]] = [(0.0, src)]
    while heap:
        cost, node = heapq.heappop(heap)
        if cost > best.get(node, math.inf):
            continue
        if node == dst:
            nodes, edges = _reconstruct(prev, dst)
            return RouteResult(nodes=nodes, edges=edges, cost_s=cost)
        for edge_id in graph.outgoing[node]:
            edge = graph.edges[edge_id]
            step = cost_of(edge)
            if not math.isfinite(step):
                continue
            nxt = cost + step
            if nxt < best.get(edge.dst, math.inf):
                best[edge.dst] = nxt
                prev[edge.dst] = (node, edge_id)
                heapq.heappush(heap, (nxt, edge.dst))
    return None


def astar(
    graph: StreetGraph,
    src: str,
    dst: str,
    cost_of: CostFn,
) -> RouteResult | None:
    """A* with heuristic ``straight_line / top speed limit``."""
    if src not in graph.nodes or dst not in graph.nodes:
        raise KeyError("src and dst must be graph nodes")
    if src == dst:
        return RouteResult(nodes=(src,), edges=(), cost_s=0.0)

    def heuristic(node: str) -> float:
        return graph.straight_seconds(node, dst)

    best: dict[str, float] = {src: 0.0}
    prev: dict[str, tuple[str | None, str | None]] = {src: (None, None)}
    heap: list[tuple[float, float, str]] = [(heuristic(src), 0.0, src)]
    while heap:
        _score, cost, node = heapq.heappop(heap)
        if cost > best.get(node, math.inf):
            continue
        if node == dst:
            nodes, edges = _reconstruct(prev, dst)
            return RouteResult(nodes=nodes, edges=edges, cost_s=cost)
        for edge_id in graph.outgoing[node]:
            edge = graph.edges[edge_id]
            step = cost_of(edge)
            if not math.isfinite(step):
                continue
            nxt = cost + step
            if nxt < best.get(edge.dst, math.inf):
                best[edge.dst] = nxt
                prev[edge.dst] = (node, edge_id)
                heapq.heappush(heap, (nxt + heuristic(edge.dst), nxt, edge.dst))
    return None
