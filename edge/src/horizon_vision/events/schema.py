"""Edge event contract.

One cleaned road event. Coordinates are metres on the flat ground plane:
``x`` east, ``y`` south (Vision-Quest Mag Mile: world +X east, +Z south).
``t`` is seconds. ``speed`` is a non-negative magnitude in m/s.

Debris and blockades use ``class == "unknown"`` and ``unknown is True``.
They still carry position, lane, and time so a hub can warn on a blocked lane.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping

CLASSES = ("vehicle", "unknown")

EDGE_EVENT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://horizonvision.local/schemas/edge-event.json",
    "title": "HorizonVisionEdgeEvent",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "class",
        "unknown",
        "x",
        "y",
        "speed",
        "lane",
        "confidence",
        "t",
        "track_id",
    ],
    "properties": {
        "class": {"type": "string", "enum": list(CLASSES)},
        "unknown": {"type": "boolean"},
        "x": {"type": "number"},
        "y": {"type": "number"},
        "speed": {"type": "number", "minimum": 0},
        "lane": {"type": ["string", "null"], "minLength": 1},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "t": {"type": "number"},
        "track_id": {"type": "string", "minLength": 1},
    },
    "allOf": [
        {
            "if": {"properties": {"class": {"const": "unknown"}}, "required": ["class"]},
            "then": {"properties": {"unknown": {"const": True}}},
        },
        {
            "if": {"properties": {"unknown": {"const": True}}, "required": ["unknown"]},
            "then": {"properties": {"class": {"const": "unknown"}}},
        },
    ],
}


class EventValidationError(ValueError):
    """An edge event failed the contract."""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def edge_event_json_schema() -> dict[str, Any]:
    return EDGE_EVENT_JSON_SCHEMA


@dataclass(frozen=True, slots=True)
class EdgeEvent:
    """Published edge event. ``cls`` serializes as JSON ``class``."""

    cls: str
    unknown: bool
    x: float
    y: float
    speed: float
    lane: str | None
    confidence: float
    t: float
    track_id: str

    def __post_init__(self) -> None:
        errors = semantic_errors(self.to_dict())
        if errors:
            raise EventValidationError("; ".join(errors))

    def to_dict(self) -> dict[str, Any]:
        return {
            "class": self.cls,
            "unknown": self.unknown,
            "x": self.x,
            "y": self.y,
            "speed": self.speed,
            "lane": self.lane,
            "confidence": self.confidence,
            "t": self.t,
            "track_id": self.track_id,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> EdgeEvent:
        errors = schema_errors(data) + semantic_errors(data)
        if errors:
            raise EventValidationError("; ".join(errors))
        return cls(
            cls=str(data["class"]),
            unknown=bool(data["unknown"]),
            x=float(data["x"]),
            y=float(data["y"]),
            speed=float(data["speed"]),
            lane=data["lane"],
            confidence=float(data["confidence"]),
            t=float(data["t"]),
            track_id=str(data["track_id"]),
        )


def schema_errors(data: Mapping[str, Any]) -> list[str]:
    """Structural checks mirrored from ``EDGE_EVENT_JSON_SCHEMA``."""
    if not isinstance(data, Mapping):
        return ["event must be an object"]
    errors: list[str] = []
    props = EDGE_EVENT_JSON_SCHEMA["properties"]
    required = EDGE_EVENT_JSON_SCHEMA["required"]
    extra = set(data) - set(props)
    missing = [key for key in required if key not in data]
    if extra:
        errors.append(f"unexpected fields: {sorted(extra)}")
    if missing:
        errors.append(f"missing fields: {missing}")
        return errors

    for key, spec in props.items():
        value = data[key]
        allowed = spec["type"] if isinstance(spec["type"], list) else [spec["type"]]
        if not _matches_type(value, allowed):
            errors.append(f"{key} has type {type(value).__name__}, expected {allowed}")
            continue
        if isinstance(value, str) and "minLength" in spec and len(value) < spec["minLength"]:
            errors.append(f"{key} must be a non-empty string")
        if "enum" in spec and value not in spec["enum"]:
            errors.append(f"{key} must be one of {spec['enum']}")
        if _is_number(value):
            if "minimum" in spec and value < spec["minimum"]:
                errors.append(f"{key} must be >= {spec['minimum']}")
            if "maximum" in spec and value > spec["maximum"]:
                errors.append(f"{key} must be <= {spec['maximum']}")
    return errors


def semantic_errors(data: Mapping[str, Any]) -> list[str]:
    """Cross-field rules the JSON schema also states with if/then."""
    errors: list[str] = []
    cls = data.get("class")
    unknown = data.get("unknown")
    if cls == "unknown" and unknown is not True:
        errors.append("class 'unknown' requires unknown=true")
    if unknown is True and cls != "unknown":
        errors.append("unknown=true requires class 'unknown'")
    if unknown is False and cls == "unknown":
        errors.append("class 'unknown' cannot set unknown=false")
    for key in ("x", "y", "speed", "confidence", "t"):
        if key in data and not _is_number(data[key]):
            errors.append(f"{key} must be a finite number")
    if _is_number(data.get("speed")) and data["speed"] < 0:
        errors.append("speed must be >= 0")
    if _is_number(data.get("confidence")) and not 0 <= data["confidence"] <= 1:
        errors.append("confidence must be in [0, 1]")
    lane = data.get("lane", None)
    if lane is not None and (not isinstance(lane, str) or not lane):
        errors.append("lane must be a non-empty string or null")
    track_id = data.get("track_id")
    if not isinstance(track_id, str) or not track_id:
        errors.append("track_id must be a non-empty string")
    if cls not in CLASSES:
        errors.append(f"class must be one of {CLASSES}")
    if not isinstance(unknown, bool):
        errors.append("unknown must be a boolean")
    return errors


def _matches_type(value: Any, allowed: list[str]) -> bool:
    checks = {
        "string": lambda v: isinstance(v, str),
        "boolean": lambda v: isinstance(v, bool),
        "null": lambda v: v is None,
        "number": _is_number,
        "object": lambda v: isinstance(v, Mapping),
    }
    return any(checks[name](value) for name in allowed if name in checks)
