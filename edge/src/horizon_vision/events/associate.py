"""Image-plane association in the style of ByteTrack.

High-confidence boxes match existing tracks first. Tracks that are still
free then match low-confidence boxes, which keeps a track through a weak
frame without letting that weak box start a new one. A track drops after
``max_misses`` frames with no match, the same hold the label tracker uses.

There is no Kalman filter here. ``TrackBook`` already smooths the ground
point once a box has an id. This step only decides which box is which.
"""

from __future__ import annotations

import math
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


def association_score(track: _Track, box: DetBox, small_area: float, match_px: float) -> float:
    """IoU, or a center score when both boxes are small.

    Distant cars are a handful of pixels. A few pixels of motion drops their
    IoU under a normal threshold and the id switches. The center score stays
    high across that shift. Large boxes keep using IoU so neighboring cars
    in a queue do not merge.
    """
    if track.cls != box.cls:
        return 0.0
    overlap = iou(track, box)
    area = min(track.w * track.h, box.w * box.h)
    if match_px <= 0 or area >= small_area:
        return overlap
    dist = math.hypot(
        (track.u + track.w / 2) - (box.u + box.w / 2),
        (track.v + track.h / 2) - (box.v + box.h / 2),
    )
    return max(overlap, max(0.0, 1.0 - dist / match_px))


def _greedy_match(
    tracks: list[_Track],
    boxes: list[DetBox],
    threshold: float,
    small_area: float = 1e9,
    match_px: float = 0.0,
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    pairs: list[tuple[float, int, int]] = []
    for ti, track in enumerate(tracks):
        for bi, box in enumerate(boxes):
            score = association_score(track, box, small_area, match_px)
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
    # None uses ``high_conf``. Debris boxes are weaker than vehicles, so the
    # detector path sets a lower birth threshold for ``unknown`` only.
    unknown_high_conf: float | None = None
    max_misses: int = 5
    # Boxes smaller than this (pixels squared) may match by center distance.
    small_area: float = 256.0
    match_px: float = 0.0
    _tracks: list[_Track] = field(default_factory=list)
    _next: int = 0

    def _birth(self, box: DetBox) -> bool:
        floor = self.high_conf
        if box.cls == "unknown" and self.unknown_high_conf is not None:
            floor = self.unknown_high_conf
        return box.confidence >= floor

    def update(self, boxes: list[DetBox]) -> list[TrackedBox]:
        high = [box for box in boxes if self._birth(box)]
        low = [box for box in boxes if not self._birth(box)]

        matched_high, free_track_idx, free_high = _greedy_match(
            self._tracks, high, self.iou_threshold, self.small_area, self.match_px
        )
        still = [self._tracks[ti] for ti in free_track_idx]
        matched_low, _free_still, _free_low = _greedy_match(
            still, low, self.iou_threshold, self.small_area, self.match_px
        )

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
