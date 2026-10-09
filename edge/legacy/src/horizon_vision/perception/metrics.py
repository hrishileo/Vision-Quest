"""
Score detector boxes against sim labels.

Labels are evaluation-only. Matching is bird's-eye (horizontal) IoU so
Y-up web labels (center on the ground) and detector centroids still pair.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np

from horizon_vision.perception.fusion import Detection3D


@dataclass
class DetectionMetrics:
    precision: float
    recall: float
    mean_iou: float
    tp: int
    fp: int
    fn: int
    matches: List[Tuple[int, int, float]] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "precision": self.precision,
            "recall": self.recall,
            "mean_iou": self.mean_iou,
            "tp": self.tp,
            "fp": self.fp,
            "fn": self.fn,
        }


def _horizontal_axes(up_axis: int) -> Tuple[int, int]:
    return tuple(i for i in range(3) if i != up_axis)  # type: ignore[return-value]


def _bev_corners(center: np.ndarray, size: np.ndarray, yaw: float, h_axes: Sequence[int]) -> np.ndarray:
    """Axis-aligned in the box yaw frame; returns 2D AABB [xmin, ymin, xmax, ymax]."""
    hx, hy = 0.5 * float(size[0]), 0.5 * float(size[1])
    cx, cy = float(center[h_axes[0]]), float(center[h_axes[1]])
    c, s = float(np.cos(yaw)), float(np.sin(yaw))
    local = np.array([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]], dtype=np.float32)
    rot = np.array([[c, -s], [s, c]], dtype=np.float32)
    world = local @ rot.T
    world[:, 0] += cx
    world[:, 1] += cy
    return np.array(
        [world[:, 0].min(), world[:, 1].min(), world[:, 0].max(), world[:, 1].max()],
        dtype=np.float32,
    )


def box_iou_bev(
    a: Detection3D,
    b: Detection3D,
    up_axis: int = 1,
) -> float:
    h_axes = _horizontal_axes(up_axis)
    aa = _bev_corners(a.center, a.size, a.yaw, h_axes)
    bb = _bev_corners(b.center, b.size, b.yaw, h_axes)
    ix = max(0.0, min(aa[2], bb[2]) - max(aa[0], bb[0]))
    iy = max(0.0, min(aa[3], bb[3]) - max(aa[1], bb[1]))
    inter = ix * iy
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, (aa[2] - aa[0]) * (aa[3] - aa[1]))
    area_b = max(0.0, (bb[2] - bb[0]) * (bb[3] - bb[1]))
    union = area_a + area_b - inter
    if union <= 1e-9:
        return 0.0
    return float(inter / union)


def evaluate_detections(
    predictions: Sequence[Detection3D],
    labels: Sequence[Detection3D],
    iou_threshold: float = 0.3,
    up_axis: Optional[int] = None,
) -> DetectionMetrics:
    if up_axis is None:
        # Do not infer from a handful of box centers — two aligned cars
        # look like zero span on X/Z and pick the wrong plane.
        up_axis = 1

    n_pred, n_lab = len(predictions), len(labels)
    if n_pred == 0 and n_lab == 0:
        return DetectionMetrics(1.0, 1.0, 1.0, 0, 0, 0)
    if n_pred == 0:
        return DetectionMetrics(0.0, 0.0, 0.0, 0, 0, n_lab)
    if n_lab == 0:
        return DetectionMetrics(0.0, 0.0, 0.0, 0, n_pred, 0)

    ious = np.zeros((n_pred, n_lab), dtype=np.float32)
    for i, pred in enumerate(predictions):
        for j, lab in enumerate(labels):
            ious[i, j] = box_iou_bev(pred, lab, up_axis=up_axis)

    used_pred = np.zeros(n_pred, dtype=bool)
    used_lab = np.zeros(n_lab, dtype=bool)
    matches: List[Tuple[int, int, float]] = []
    # Greedy: best IoU first.
    order = np.argsort(ious.ravel())[::-1]
    for flat in order:
        i, j = divmod(int(flat), n_lab)
        iou = float(ious[i, j])
        if iou < iou_threshold:
            break
        if used_pred[i] or used_lab[j]:
            continue
        used_pred[i] = True
        used_lab[j] = True
        matches.append((i, j, iou))

    tp = len(matches)
    fp = n_pred - tp
    fn = n_lab - tp
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    mean_iou = float(np.mean([m[2] for m in matches])) if matches else 0.0
    return DetectionMetrics(
        precision=precision,
        recall=recall,
        mean_iou=mean_iou,
        tp=tp,
        fp=fp,
        fn=fn,
        matches=matches,
    )
