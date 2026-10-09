"""
Local map builder.

Accumulates recent LiDAR data into a short-term local map
that can later feed electronic-horizon style previews.
"""

from __future__ import annotations

from typing import Optional
import numpy as np
from collections import deque

from horizon_vision.sensors.lidar_driver import PointCloud
from horizon_vision.perception.edge_ai import PerceptionOutput


class LocalMapBuilder:
    """
    Maintains a rolling local point cloud map.
    In future versions this will also store vector road elements
    and detected objects with temporal tracking.
    """

    def __init__(self, max_frames: int = 20):
        self.max_frames = max_frames
        self._clouds: deque = deque(maxlen=max_frames)
        self._latest_detections = []

    def update(self, pc: Optional[PointCloud], perception: Optional[PerceptionOutput] = None) -> None:
        if pc is not None:
            self._clouds.append(pc.points.copy())

        if perception is not None:
            self._latest_detections = perception.detections

    def get_local_cloud(self) -> Optional[np.ndarray]:
        if not self._clouds:
            return None
        return np.concatenate(list(self._clouds), axis=0)

    def get_detection_summary(self) -> list:
        return [
            {
                "label": d.label,
                "confidence": float(d.confidence),
                "center": d.center.tolist(),
                "size": d.size.tolist(),
            }
            for d in self._latest_detections
        ]
