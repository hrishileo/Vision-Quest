"""Lane-state input for the hub.

The edge publishes these from ``horizon_vision.events.lane_state``.
The wire shape is ``{lane, state, speed, confidence, t}`` with
``state`` in ``blocked | slow | clear | unknown``. ``lane_state_from_mapping``
is the only reader of those keys.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping

LANE_STATE_VALUES = ("blocked", "slow", "clear", "unknown")
LANE_STATE_FIELDS = ("lane", "state", "speed", "confidence", "t")


class LaneStateError(ValueError):
    """A lane-state payload failed the hub's minimal contract."""


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True, slots=True)
class LaneState:
    """One lane's condition at time ``t`` (seconds).

    ``speed`` is the observed speed in m/s. It is required for a trusted
    ``slow`` state and ignored otherwise. ``confidence`` is 0–1.
    """

    lane: str
    state: str
    speed: float | None
    confidence: float
    t: float

    def __post_init__(self) -> None:
        if not isinstance(self.lane, str) or not self.lane:
            raise LaneStateError("lane must be a non-empty string")
        if self.state not in LANE_STATE_VALUES:
            raise LaneStateError(f"state must be one of {LANE_STATE_VALUES}")
        if self.speed is not None and (not _finite_number(self.speed) or self.speed < 0):
            raise LaneStateError("speed must be a non-negative finite number or null")
        if not _finite_number(self.confidence) or not 0 <= self.confidence <= 1:
            raise LaneStateError("confidence must be in [0, 1]")
        if not _finite_number(self.t):
            raise LaneStateError("t must be a finite number")


def lane_state_from_mapping(data: Mapping[str, Any]) -> LaneState:
    """Adapt one lane-state object into :class:`LaneState`.

    Unknown keys are ignored so a later edge payload can grow without
    touching the router. This function is the coupling point.
    """
    if not isinstance(data, Mapping):
        raise LaneStateError("lane state must be an object")
    missing = [key for key in LANE_STATE_FIELDS if key not in data]
    if missing:
        raise LaneStateError(f"lane state missing {missing}")
    speed = data["speed"]
    return LaneState(
        lane=str(data["lane"]) if data["lane"] is not None else "",
        state=str(data["state"]) if data["state"] is not None else "",
        speed=None if speed is None else float(speed),
        confidence=float(data["confidence"]),
        t=float(data["t"]),
    )
