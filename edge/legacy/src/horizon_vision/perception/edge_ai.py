"""
Edge AI engine for Horizon Vision.

Runs on the Jetson (or a laptop). A fused camera + LiDAR frame goes in;
predicted boxes come out. Sim labels on the fused frame are score-only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import time
import numpy as np

from horizon_vision.perception.detector import LidarClusterDetector
from horizon_vision.perception.fusion import Detection3D, FusedFrame
from horizon_vision.perception.metrics import DetectionMetrics, evaluate_detections


@dataclass
class PerceptionOutput:
    """Full output of one AI inference cycle."""
    timestamp: float
    detections: List[Detection3D] = field(default_factory=list)
    labels: List[Detection3D] = field(default_factory=list)
    metrics: Optional[DetectionMetrics] = None
    num_lidar_points: int = 0
    image_shape: Optional[tuple] = None
    processing_time_ms: float = 0.0
    extras: Dict[str, Any] = field(default_factory=dict)


class EdgeAIEngine:
    """
    Runs on the edge computer.

    Current version:
    - Accepts fused frames
    - Runs a LiDAR Euclidean-cluster detector on the point cloud
    - Scores predictions against sim labels when those are attached
    - Does not copy sim detections into the forward pass
    """

    def __init__(
        self,
        device: str = "cuda",
        target_fps: float = 15.0,
        detector: Optional[LidarClusterDetector] = None,
    ):
        self.device = device
        self.target_fps = target_fps
        self.detector = detector or LidarClusterDetector()
        self._frame_count = 0
        print(
            f"[EdgeAI] Initialized {self.detector.name} on device='{device}' "
            f"(target {target_fps} FPS)"
        )

    def process(self, fused: FusedFrame) -> PerceptionOutput:
        t0 = time.perf_counter()
        self._frame_count += 1

        num_points = 0
        img_shape = None
        points = None
        image = None

        if fused.point_cloud is not None:
            pc = fused.point_cloud
            num_points = pc.num_points
            points = pc.points

        if fused.image is not None:
            img_shape = fused.image.shape
            image = fused.image.image

        # Labels stay off the detect() call on purpose.
        labels = list(fused.detections)
        detections = self.detector.detect(points, image)
        self._fill_distances(detections, fused.sensor_x)

        metrics = None
        if labels:
            metrics = evaluate_detections(
                detections,
                labels,
                up_axis=self.detector.last_up_axis,
            )

        dt_ms = (time.perf_counter() - t0) * 1000.0

        return PerceptionOutput(
            timestamp=fused.timestamp,
            detections=detections,
            labels=labels,
            metrics=metrics,
            num_lidar_points=num_points,
            image_shape=img_shape,
            processing_time_ms=dt_ms,
            extras={
                "frame_id": self._frame_count,
                "detector": self.detector.name,
                "metrics": metrics.as_dict() if metrics is not None else None,
            },
        )

    @staticmethod
    def _fill_distances(detections: List[Detection3D], sensor_x: Optional[float]) -> None:
        if sensor_x is None:
            return
        for det in detections:
            if det.distance is not None:
                continue
            dx = float(det.center[0]) - float(sensor_x)
            # Lateral is whichever leftover horizontal axis has the larger |value|
            # after X; web Y-up uses Z, simulated Z-up uses Y.
            lateral = float(det.center[2]) if abs(float(det.center[2])) >= abs(float(det.center[1])) else float(det.center[1])
            det.distance = float(np.hypot(dx, lateral))
