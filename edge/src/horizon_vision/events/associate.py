"""Image-plane association in the style of ByteTrack.

High-confidence boxes match existing tracks first. Tracks that are still
free then match low-confidence boxes, which keeps a track through a weak
frame without letting that weak box start a new one. A track drops after
``max_misses`` frames with no match, the same hold the label tracker uses.

There is no Kalman filter here. ``TrackBook`` already smooths the ground
point once a box has an id. This step only decides which box is which.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from horizon_vision.events.labels import BBox


@dataclass(frozen=True, slots=True)
class DetBox:
    """One detector box. ``u, v`` is the top-left corner, in pixels."""

    cls: str
    confidence: float
    u: float
    v: float
    w: float
    h: float

    def as_bbox(self) -> BBox:
        return BBox(u=self.u, v=self.v, w=self.w, h=self.h)


@dataclass(frozen=True, slots=True)
class TrackedBox:
    track_id: str
    cls: str
    confidence: float
    bbox: BBox


@dataclass
class _Track:
    track_id: str
    cls: str
    confidence: float
    u: float
    v: float
    w: float
    h: float
    misses: int = 0


def iou(a: DetBox | _Track, b: DetBox | _Track) -> float:
    ax2 = a.u + a.w
    ay2 = a.v + a.h
    bx2 = b.u + b.w
    by2 = b.v + b.h
    ix1 = max(a.u, b.u)
    iy1 = max(a.v, b.v)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = a.w * a.h + b.w * b.h - inter
    if union <= 0:
        return 0.0
    return inter / union


def _greedy_match(
    tracks: list[_Track],
    boxes: list[DetBox],
    threshold: float,
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    pairs: list[tuple[float, int, int]] = []
    for ti, track in enumerate(tracks):
        for bi, box in enumerate(boxes):
            score = iou(track, box)
            if score >= threshold:
                pairs.append((score, ti, bi))
    pairs.sort(key=lambda item: item[0], reverse=True)
    used_t: set[int] = set()
    used_b: set[int] = set()
    matched: list[tuple[int, int]] = []
    for _score, ti, bi in pairs:
        if ti in used_t or bi in used_b:
            continue
        used_t.add(ti)
        used_b.add(bi)
        matched.append((ti, bi))
    free_tracks = [ti for ti in range(len(tracks)) if ti not in used_t]
    free_boxes = [bi for bi in range(len(boxes)) if bi not in used_b]
    return matched, free_tracks, free_boxes


@dataclass
class ByteTrack:
    """Associate boxes across frames. Ids are ``trk-<n>`` and are not reused."""

    iou_threshold: float = 0.3
    high_conf: float = 0.25
    max_misses: int = 5
    _tracks: list[_Track] = field(default_factory=list)
    _next: int = 0

    def update(self, boxes: list[DetBox]) -> list[TrackedBox]:
        high = [box for box in boxes if box.confidence >= self.high_conf]
        low = [box for box in boxes if box.confidence < self.high_conf]

        matched_high, free_track_idx, free_high = _greedy_match(
            self._tracks, high, self.iou_threshold
        )
        still = [self._tracks[ti] for ti in free_track_idx]
        matched_low, _free_still, _free_low = _greedy_match(still, low, self.iou_threshold)

        claimed: set[int] = set()
        for ti, bi in matched_high:
            self._apply(self._tracks[ti], high[bi])
            claimed.add(ti)
        for local_ti, bi in matched_low:
            ti = free_track_idx[local_ti]
            self._apply(self._tracks[ti], low[bi])
            claimed.add(ti)

        for ti, track in enumerate(self._tracks):
            if ti not in claimed:
                track.misses += 1
        self._tracks = [track for track in self._tracks if track.misses < self.max_misses]

        for bi in free_high:
            box = high[bi]
            self._tracks.append(
                _Track(
                    track_id=f"trk-{self._next}",
                    cls=box.cls,
                    confidence=box.confidence,
                    u=box.u,
                    v=box.v,
                    w=box.w,
                    h=box.h,
                )
            )
            self._next += 1

        return [
            TrackedBox(
                track_id=track.track_id,
                cls=track.cls,
                confidence=track.confidence,
                bbox=BBox(u=track.u, v=track.v, w=track.w, h=track.h),
            )
            for track in self._tracks
            if track.misses == 0
        ]

    @staticmethod
    def _apply(track: _Track, box: DetBox) -> None:
        track.cls = box.cls
        track.confidence = box.confidence
        track.u = box.u
        track.v = box.v
        track.w = box.w
        track.h = box.h
        track.misses = 0
