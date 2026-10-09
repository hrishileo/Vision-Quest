"""Slice a frame into overlapping crops and merge the boxes.

Debris in a 960-wide CAM0 frame is often a few dozen pixels. A nano model
at 640 shrinks that under the stride. Running the same model on a crop, then
shifting the boxes back, is the inference-time half of that fix. Training
crops live in ``edge/detector/balance.py``.
"""

from __future__ import annotations

from horizon_vision.events.associate import DetBox, iou


def tile_windows(
    width: int,
    height: int,
    tile_w: int,
    tile_h: int,
    overlap: float,
) -> list[tuple[int, int, int, int]]:
    """``(x, y, w, h)`` windows. The last window on each axis covers the far edge.

    A tile that is already the whole image returns that one window. ``overlap``
    is the fraction of the tile shared with the next one, in ``[0, 0.9]``.
    """
    if width <= 0 or height <= 0:
        return []
    if tile_w <= 0 or tile_h <= 0 or (tile_w >= width and tile_h >= height):
        return [(0, 0, width, height)]
    tile_w = min(tile_w, width)
    tile_h = min(tile_h, height)
    overlap = min(0.9, max(0.0, overlap))
    stride_x = max(1, int(round(tile_w * (1.0 - overlap))))
    stride_y = max(1, int(round(tile_h * (1.0 - overlap))))
    xs = _stops(width, tile_w, stride_x)
    ys = _stops(height, tile_h, stride_y)
    return [(x, y, tile_w, tile_h) for y in ys for x in xs]


def _stops(length: int, tile: int, stride: int) -> list[int]:
    stops = list(range(0, max(1, length - tile + 1), stride))
    end = length - tile
    if not stops or stops[-1] != end:
        stops.append(end)
    return stops


def shift_boxes(boxes: list[DetBox], origin_u: float, origin_v: float) -> list[DetBox]:
    if origin_u == 0 and origin_v == 0:
        return list(boxes)
    return [
        DetBox(
            cls=box.cls,
            confidence=box.confidence,
            u=box.u + origin_u,
            v=box.v + origin_v,
            w=box.w,
            h=box.h,
        )
        for box in boxes
    ]


def nms(boxes: list[DetBox], iou_threshold: float) -> list[DetBox]:
    """Class-wise greedy NMS. Higher confidence wins."""
    by_cls: dict[str, list[DetBox]] = {}
    for box in boxes:
        by_cls.setdefault(box.cls, []).append(box)
    kept: list[DetBox] = []
    for group in by_cls.values():
        ordered = sorted(group, key=lambda box: box.confidence, reverse=True)
        chosen: list[DetBox] = []
        for box in ordered:
            if all(iou(box, other) < iou_threshold for other in chosen):
                chosen.append(box)
        kept.extend(chosen)
    kept.sort(key=lambda box: box.confidence, reverse=True)
    return kept


def count_matches(
    predicted: list[DetBox],
    truth: list[DetBox],
    iou_threshold: float = 0.5,
) -> dict[str, dict[str, int]]:
    """Greedy IoU matches per class. Each truth box is used at most once."""
    classes = sorted({box.cls for box in predicted} | {box.cls for box in truth})
    rows: dict[str, dict[str, int]] = {}
    for cls in classes:
        preds = [box for box in predicted if box.cls == cls]
        gts = [box for box in truth if box.cls == cls]
        pairs: list[tuple[float, int, int]] = []
        for pi, pred in enumerate(preds):
            for gi, gt in enumerate(gts):
                score = iou(pred, gt)
                if score >= iou_threshold:
                    pairs.append((score, pi, gi))
        pairs.sort(key=lambda item: item[0], reverse=True)
        used_p: set[int] = set()
        used_g: set[int] = set()
        matched = 0
        for _score, pi, gi in pairs:
            if pi in used_p or gi in used_g:
                continue
            used_p.add(pi)
            used_g.add(gi)
            matched += 1
        rows[cls] = {"matched": matched, "predicted": len(preds), "truth": len(gts)}
    return rows
