"""Track hold, confirm, dedupe, and drop."""

import pytest

from horizon_vision.events.tracking import Observation, TrackBook


def _obs(track_id="veh-1", x=0.0, y=0.0, cls="vehicle", unknown=False, lane="mich-nb-1"):
    return Observation(
        track_id=track_id,
        x=x,
        y=y,
        cls=cls,
        unknown=unknown,
        lane=lane,
        confidence=0.9,
    )


def test_emits_only_after_min_hits_and_smooths_position():
    book = TrackBook(min_hits=3, max_misses=2, alpha=0.5)
    assert book.update(0.0, [_obs(x=0.0)]) == []
    assert book.update(1.0, [_obs(x=10.0)]) == []
    assert book.smoothed_position("veh-1") == pytest.approx((5.0, 0.0))
    assert book.speed_of("veh-1") == pytest.approx(10.0)

    events = book.update(2.0, [_obs(x=20.0)])
    assert len(events) == 1
    event = events[0]
    assert event.track_id == "veh-1"
    assert event.t == 2.0
    # smoothed = 0.5*20 + 0.5*5
    assert event.x == pytest.approx(12.5)
    assert event.y == pytest.approx(0.0)
    # raw step is still 10 m/s, so the smoothed speed stays 10
    assert event.speed == pytest.approx(10.0)
    assert event.cls == "vehicle"
    assert event.unknown is False
    assert event.lane == "mich-nb-1"


def test_duplicate_id_in_one_frame_is_one_hit():
    book = TrackBook(min_hits=2, max_misses=2, alpha=1.0)
    first = book.update(0.0, [_obs(x=0.0), _obs(x=50.0)])
    assert first == []
    assert book.smoothed_position("veh-1") == pytest.approx((50.0, 0.0))
    events = book.update(1.0, [_obs(x=60.0)])
    assert len(events) == 1
    assert events[0].speed == pytest.approx(10.0)


def test_same_timestamp_does_not_emit_twice():
    book = TrackBook(min_hits=2, max_misses=2, alpha=1.0)
    book.update(0.0, [_obs(x=0.0)])
    book.update(1.0, [_obs(x=10.0)])
    assert book.update(1.0, [_obs(x=10.0)]) == []


def test_holds_through_a_short_gap_and_drops_after_max_misses():
    book = TrackBook(min_hits=2, max_misses=2, alpha=1.0)
    book.update(0.0, [_obs()])
    book.update(1.0, [_obs(x=10.0)])
    assert book.update(2.0, []) == []
    assert "veh-1" in book.track_ids

    held = book.update(3.0, [_obs(x=30.0)])
    assert len(held) == 1
    assert held[0].speed == pytest.approx(10.0)

    assert book.update(4.0, []) == []
    assert book.update(5.0, []) == []
    assert "veh-1" not in book.track_ids

    assert book.update(6.0, [_obs(x=0.0)]) == []
    assert book.update(7.0, [_obs(x=10.0)])[0].speed == pytest.approx(10.0)


def test_unknown_label_keeps_lane_and_zero_speed():
    book = TrackBook(min_hits=2, max_misses=3, alpha=1.0)
    obs = _obs(track_id="deb-1", cls="unknown", unknown=True, lane="mich-nb-2")
    book.update(0.0, [obs])
    events = book.update(0.5, [obs])
    assert len(events) == 1
    assert events[0].cls == "unknown"
    assert events[0].unknown is True
    assert events[0].lane == "mich-nb-2"
    assert events[0].speed == pytest.approx(0.0)


def test_time_cannot_go_backwards():
    book = TrackBook()
    book.update(1.0, [_obs()])
    with pytest.raises(ValueError):
        book.update(0.5, [_obs()])
