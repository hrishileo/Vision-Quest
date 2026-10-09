"""
Edge AI engine for Horizon Vision.

This is the core module that runs on the Jetson (or other edge computer).
It receives fused LiDAR + Camera data and produces perception outputs
(detections, segmentation, local map features, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
import time
import numpy as np

from horizon_vision.perception.fusion import FusedFrame


@dataclass
class Detection3D:
    """Simple 3D detection result."""
    label: str
    confidence: float
    center: np.ndarray          # (3,)
    size: np.ndarray            # (3,) l,w,h
    yaw: float = 0.0


@dataclass
class PerceptionOutput:
    """Full output of one AI inference cycle."""
    timestamp: float
    detections: List[Detection3D] = field(default_factory=list)
    num_lidar_points: int = 0
    image_shape: Optional[tuple] = None
    processing_time_ms: float = 0.0
    extras: Dict[str, Any] = field(default_factory=dict)


class EdgeAIEngine:
    """
    Runs on the edge computer.

    Current version:
    - Accepts fused frames
    - Performs lightweight heuristic "detections" on the point cloud
      (placeholder for real neural network models)
    - Ready to be swapped with TensorRT / MMDetection3D / YOLO + depth later
    """

    def __init__(self, device: str = "cuda", target_fps: float = 15.0):
        self.device = device
        self.target_fps = target_fps
        self._frame_count = 0
        print(f"[EdgeAI] Initialized on device='{device}' (target {target_fps} FPS)")

    def process(self, fused: FusedFrame) -> PerceptionOutput:
        t0 = time.perf_counter()
        self._frame_count += 1

        detections: List[Detection3D] = []
        num_points = 0
        img_shape = None

        if fused.point_cloud is not None:
            pc = fused.point_cloud
            num_points = pc.num_points
            detections = self._heuristic_vehicle_detections(pc.points)

        if fused.image is not None:
            img_shape = fused.image.shape

        dt_ms = (time.perf_counter() - t0) * 1000.0

        return PerceptionOutput(
            timestamp=fused.timestamp,
            detections=detections,
            num_lidar_points=num_points,
            image_shape=img_shape,
            processing_time_ms=dt_ms,
            extras={"frame_id": self._frame_count},
        )

    def _heuristic_vehicle_detections(self, points: np.ndarray) -> List[Detection3D]:
        """
        Very simple placeholder detector.
        Clusters points that are elevated above the ground plane
        and returns a few fake 3D boxes. Replace with real model later.
        """
        if points.shape[0] < 100:
            return []

        # Rough ground removal
        z = points[:, 2]
        elevated = points[z > 0.4]

        if elevated.shape[0] < 50:
            return []

        # Extremely naive clustering by x-distance bins
        detections = []
        for x_center in [10.0, 20.0, 30.0]:
            mask = np.abs(elevated[:, 0] - x_center) < 4.0
            cluster = elevated[mask]
            if cluster.shape[0] < 40:
                continue

            center = cluster.mean(axis=0)
            size = np.array([4.5, 2.0, 1.6], dtype=np.float32)  # typical car

            detections.append(
                Detection3D(
                    label="vehicle",
                    confidence=0.75,
                    center=center.astype(np.float32),
                    size=size,
                    yaw=0.0,
                )
            )

        return detections
