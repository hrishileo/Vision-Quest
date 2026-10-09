"""Map hub lane ids onto Vision-Quest scene lanes.

Michigan and the Chicago Avenue inner lanes already use the ids in
``src/lib/guide/city.ts``. Rush and Wabash are hub-local (``rush-nb``,
``wabash-nb``, no index). The drivable scene lanes are ``rush-nb-0`` and
``wabash-nb-0``. Cross streets that are not in the excerpt (``ohio-ew`` and
the rest) are not scene lanes. A reroute is driven by the longitudinal
corridor.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_FIXTURE = (
    Path(__file__).resolve().parents[4] / "src" / "lib" / "guide" / "__fixtures__" / "hub-scene-lanes.json"
)


@lru_cache(maxsize=1)
def scene_lane_table() -> dict[str, str]:
    payload = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    lanes = payload["lanes"]
    if not isinstance(lanes, dict) or not lanes:
        raise ValueError("hub-scene-lanes.json is missing lanes")
    return {str(key): str(value) for key, value in lanes.items()}


def scene_lane(hub_lane: str) -> str | None:
    """Scene lane a hub lane drives on, or None when the sim has no such road."""
    return scene_lane_table().get(hub_lane)
