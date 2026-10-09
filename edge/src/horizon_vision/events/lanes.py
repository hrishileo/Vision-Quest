"""Travel-lane ids for a ground point. Same rule as Vision-Quest ``city.ts``.

``lane_id_at`` picks the centerline within half a lane width. Ties prefer
the lane whose station is farther from either end. Off the travel lanes the
result is ``None``.
"""

from __future__ import annotations

from dataclasses import dataclass

SPAN = 78.0
LANE_W = 3.5
MICH_NB = (2.0, 5.5, 9.0)
MICH_SB = (-2.0, -5.5, -9.0)
CHI_EB = (2.4, 5.8)
CHI_WB = (-2.4, -5.8)
RUSH_X = (60.8, 64.4)
CROSS_Z = -36.5


@dataclass(frozen=True, slots=True)
class _Lane:
    id: str
    offset: float
    s0: float
    sign: int
    axis: str
    length: float


def _mich(lane_id: str, x: float, nb: bool) -> _Lane:
    return _Lane(lane_id, x, SPAN if nb else -SPAN, -1 if nb else 1, "z", SPAN * 2)


def _chi(lane_id: str, z: float, eb: bool) -> _Lane:
    return _Lane(lane_id, z, -SPAN if eb else SPAN, 1 if eb else -1, "x", SPAN * 2)


def _all_lanes() -> tuple[_Lane, ...]:
    rush_length = CHI_EB[0] - CROSS_Z
    conn_length = RUSH_X[0] - MICH_NB[2]
    return (
        _mich("mich-nb-0", MICH_NB[0], True),
        _mich("mich-nb-1", MICH_NB[1], True),
        _mich("mich-nb-2", MICH_NB[2], True),
        _mich("mich-sb-0", MICH_SB[0], False),
        _mich("mich-sb-1", MICH_SB[1], False),
        _mich("mich-sb-2", MICH_SB[2], False),
        _chi("chi-eb-0", CHI_EB[0], True),
        _chi("chi-eb-1", CHI_EB[1], True),
        _chi("chi-wb-0", CHI_WB[0], False),
        _chi("chi-wb-1", CHI_WB[1], False),
        _Lane("rush-nb-0", RUSH_X[0], CHI_EB[0], -1, "z", rush_length),
        _Lane("rush-nb-1", RUSH_X[1], CHI_EB[0], -1, "z", rush_length),
        _Lane("conn-wb-0", CROSS_Z, RUSH_X[0], -1, "x", conn_length),
    )


_LANES = _all_lanes()


def lane_id_at(x: float, z: float) -> str | None:
    """Lane under ``(x, z)`` on the ground plane, or ``None`` off every lane."""
    half = LANE_W * 0.5
    best: tuple[float, float, str] | None = None
    for lane in _LANES:
        lateral = abs(x - lane.offset) if lane.axis == "z" else abs(z - lane.offset)
        if lateral > half + 1e-6:
            continue
        along = lane.sign * ((z - lane.s0) if lane.axis == "z" else (x - lane.s0))
        if along < -1e-4 or along > lane.length + 1e-4:
            continue
        margin = min(along, lane.length - along)
        if (
            best is None
            or lateral < best[0] - 1e-9
            or (abs(lateral - best[0]) <= 1e-9 and margin > best[1])
        ):
            best = (lateral, margin, lane.id)
    if best is None:
        return None
    return best[2]
