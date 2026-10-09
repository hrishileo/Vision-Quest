"""Edge event contract."""

import math

import pytest

from horizon_vision.events.schema import (
    CLASSES,
    EDGE_EVENT_JSON_SCHEMA,
    EdgeEvent,
    EventValidationError,
)


def _event(**overrides):
    data = {
        "class": "vehicle",
        "unknown": False,
        "x": 5.5,
        "y": 12.0,
        "speed": 8.0,
        "lane": "mich-nb-1",
        "confidence": 0.8,
        "t": 1.25,
        "track_id": "veh-12",
    }
    data.update(overrides)
    return data


def test_schema_lists_the_contract_fields():
    assert EDGE_EVENT_JSON_SCHEMA["required"] == [
        "class",
        "unknown",
        "x",
        "y",
        "speed",
        "lane",
        "confidence",
        "t",
        "track_id",
    ]
    assert EDGE_EVENT_JSON_SCHEMA["properties"]["class"]["enum"] == list(CLASSES)
    assert EDGE_EVENT_JSON_SCHEMA["additionalProperties"] is False
    rules = EDGE_EVENT_JSON_SCHEMA["allOf"]
    assert rules[0]["then"]["properties"]["unknown"]["const"] is True
    assert rules[1]["then"]["properties"]["class"]["const"] == "unknown"


def test_vehicle_and_debris_round_trip():
    vehicle = EdgeEvent.from_dict(_event())
    assert vehicle.to_dict()["class"] == "vehicle"
    assert vehicle.unknown is False

    debris = EdgeEvent.from_dict(
        {
            "class": "unknown",
            "unknown": True,
            "x": 9.0,
            "y": 16.0,
            "speed": 0.0,
            "lane": "mich-nb-2",
            "confidence": 1.0,
            "t": 0.4,
            "track_id": "deb-barrier",
        }
    )
    assert debris.cls == "unknown"
    assert debris.unknown is True
    assert debris.lane == "mich-nb-2"
    assert debris.to_dict()["class"] == "unknown"


def test_null_lane_is_valid_for_unknown():
    event = EdgeEvent.from_dict(_event(**{
        "class": "unknown",
        "unknown": True,
        "lane": None,
        "speed": 0.0,
        "track_id": "deb-tire",
    }))
    assert event.lane is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"class": "unknown", "unknown": False},
        {"class": "vehicle", "unknown": True},
        {"class": "debris", "unknown": True},
        {"confidence": 1.1},
        {"confidence": -0.01},
        {"speed": -0.1},
        {"track_id": ""},
        {"lane": ""},
        {"x": math.nan},
        {"t": math.inf},
    ],
)
def test_rejects_invalid_events(overrides):
    with pytest.raises(EventValidationError):
        EdgeEvent.from_dict(_event(**overrides))


def test_rejects_extra_and_missing_fields():
    extra = _event()
    extra["severity"] = "high"
    with pytest.raises(EventValidationError):
        EdgeEvent.from_dict(extra)
    missing = _event()
    del missing["track_id"]
    with pytest.raises(EventValidationError):
        EdgeEvent.from_dict(missing)


def test_constructor_rejects_a_vehicle_marked_unknown():
    with pytest.raises(EventValidationError):
        EdgeEvent(
            cls="vehicle",
            unknown=True,
            x=0.0,
            y=0.0,
            speed=0.0,
            lane=None,
            confidence=1.0,
            t=0.0,
            track_id="x",
        )
