"""
Static-scene obstacle detector.

Inference input is sensor data only: a range-gated LiDAR cloud and an
optional camera image. Sim object centers / labels are never read here.
Those belong in scoring (see metrics.py).
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np

from horizon_vision.perception.fusion import Detection3D


@dataclass(frozen=True)
class ClusterParams:
    """Euclidean-cluster knobs. Tuned for the web Y-up road cloud."""

    ground_height: float = 0.20
    eps: float = 1.5
    min_points: int = 6
    min_height: float = 0.35
    max_height: float = 4.8
    min_footprint: float = 0.20
    max_length: float = 16.0
    max_width: float = 4.5


def infer_up_axis(points: np.ndarray) -> int:
    """Height is the axis with the smallest span (road scenes)."""
    if points.size == 0:
        return 2
    spans = points.max(axis=0) - points.min(axis=0)
    return int(np.argmin(spans))


def _horizontal_axes(up_axis: int) -> Tuple[int, int]:
    return tuple(i for i in range(3) if i != up_axis)  # type: ignore[return-value]


def _euclidean_clusters(xy: np.ndarray, eps: float, min_points: int) -> List[np.ndarray]:
    """Grid-hashed Euclidean clustering (PCL-style, 2D)."""
    n = xy.shape[0]
    if n == 0:
        return []

    cell = float(eps)
    grid: dict[Tuple[int, int], List[int]] = defaultdict(list)
    for i in range(n):
        grid[(int(np.floor(xy[i, 0] / cell)), int(np.floor(xy[i, 1] / cell)))].append(i)

    visited = np.zeros(n, dtype=bool)
    clusters: List[np.ndarray] = []
    neighbors = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 0), (0, 1), (1, -1), (1, 0), (1, 1))
    eps2 = eps * eps

    for seed in range(n):
        if visited[seed]:
            continue
        queue: deque[int] = deque([seed])
        visited[seed] = True
        members: List[int] = []
        while queue:
            j = queue.popleft()
            members.append(j)
            cx = int(np.floor(xy[j, 0] / cell))
            cy = int(np.floor(xy[j, 1] / cell))
            for dx, dy in neighbors:
                for k in grid[(cx + dx, cy + dy)]:
                    if visited[k]:
                        continue
                    d0 = xy[k, 0] - xy[j, 0]
                    d1 = xy[k, 1] - xy[j, 1]
                    if d0 * d0 + d1 * d1 <= eps2:
                        visited[k] = True
                        queue.append(k)
        if len(members) >= min_points:
            clusters.append(np.asarray(members, dtype=np.int32))
    return clusters


def _pca_yaw(xy: np.ndarray) -> float:
    if xy.shape[0] < 2:
        return 0.0
    centered = xy - xy.mean(axis=0)
    cov = np.cov(centered, rowvar=False)
    if cov.shape != (2, 2) or not np.isfinite(cov).all():
        return 0.0
    vals, vecs = np.linalg.eigh(cov)
    axis = vecs[:, int(np.argmax(vals))]
    return float(np.arctan2(axis[1], axis[0]))


def _classify_box(length: float, width: float, height: float) -> str:
    long_side = max(length, width)
    short_side = min(length, width)
    if height >= 1.15 and long_side < 1.05:
        return "pedestrian"
    if long_side < 2.6 and short_side < 1.1 and height < 1.65:
        return "motorcycle"
    if long_side >= 9.5:
        return "bus"
    if long_side >= 6.4 or height >= 2.45:
        return "truck"
    if height >= 1.85:
        return "van"
    return "car"


def _confidence(n_points: int, length: float, width: float, height: float) -> float:
    fill = min(1.0, n_points / 40.0)
    shape = 1.0
    if height < 0.5 or max(length, width) < 0.4:
        shape = 0.55
    return float(np.clip(0.45 + 0.4 * fill + 0.15 * shape, 0.35, 0.95))


class LidarClusterDetector:
    """
    Range-gated XY Euclidean clustering + yaw-aware AABB.

    `detect()` takes points (N,3) and an optional image. It does not
    accept object lists, centers, or labels.
    """

    name = "lidar_cluster"

    def __init__(self, params: Optional[ClusterParams] = None, up_axis: Optional[int] = None):
        self.params = params or ClusterParams()
        self.up_axis = up_axis
        self.last_up_axis = up_axis if up_axis is not None else 1

    def detect(
        self,
        points: Optional[np.ndarray],
        image: Optional[np.ndarray] = None,
    ) -> List[Detection3D]:
        del image  # reserved; v1 boxes come from the cloud only
        if points is None or points.size == 0:
            return []
        pts = np.asarray(points, dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] < 3:
            return []
        pts = pts[:, :3]
        if pts.shape[0] < self.params.min_points:
            return []

        up = self.up_axis if self.up_axis is not None else infer_up_axis(pts)
        self.last_up_axis = up
        h_axes = _horizontal_axes(up)
        height = pts[:, up]
        elevated = pts[height > self.params.ground_height]
        if elevated.shape[0] < self.params.min_points:
            return []

        xy = elevated[:, list(h_axes)]
        clusters = _euclidean_clusters(xy, self.params.eps, self.params.min_points)
        detections: List[Detection3D] = []
        for members in clusters:
            cluster = elevated[members]
            box = self._fit_box(cluster, up, h_axes)
            if box is None:
                continue
            detections.append(box)
        detections.sort(key=lambda d: float(d.center[h_axes[0]]))
        return detections

    def _fit_box(
        self,
        cluster: np.ndarray,
        up: int,
        h_axes: Sequence[int],
    ) -> Optional[Detection3D]:
        p = self.params
        xy = cluster[:, list(h_axes)]
        aa = xy.max(axis=0) - xy.min(axis=0)
        aa_length = float(max(aa[0], 0.15))
        aa_width = float(max(aa[1], 0.15))
        yaw = _pca_yaw(xy)
        c, s = float(np.cos(yaw)), float(np.sin(yaw))
        rot = np.array([[c, s], [-s, c]], dtype=np.float32)
        local = (xy - xy.mean(axis=0)) @ rot.T
        extent = local.max(axis=0) - local.min(axis=0)
        pca_length = float(max(extent[0], 0.15))
        pca_width = float(max(extent[1], 0.15))
        # Prefer AABB on this static road; keep PCA only when it is clearly tighter.
        if pca_length * pca_width < 0.85 * aa_length * aa_width:
            length, width = pca_length, pca_width
        else:
            length, width = aa_length, aa_width
            yaw = 0.0
        zmin = float(cluster[:, up].min())
        zmax = float(cluster[:, up].max())
        height = float(max(zmax - zmin, 0.15))

        if height < p.min_height or height > p.max_height:
            return None
        if min(length, width) < p.min_footprint:
            return None
        if length > p.max_length or width > p.max_width:
            return None

        center = np.zeros(3, dtype=np.float32)
        mean_xy = xy.mean(axis=0)
        center[h_axes[0]] = float(mean_xy[0])
        center[h_axes[1]] = float(mean_xy[1])
        center[up] = 0.5 * (zmin + zmax)

        size = np.array([length, width, height], dtype=np.float32)
        label = _classify_box(length, width, height)
        conf = _confidence(cluster.shape[0], length, width, height)
        return Detection3D(
            label=label,
            confidence=conf,
            center=center,
            size=size,
            yaw=yaw,
        )
