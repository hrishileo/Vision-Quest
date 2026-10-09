"""
Sensor fusion with exclusive nearest-timestamp pairing.

Camera + LiDAR (and optional sim labels) are matched inside a
real time window. Unpaired samples are dropped — this is not "latest
of each." Sim detections on the fused frame are labels, not AI output.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from horizon_vision.perception.sync import TimeSynchronizer
from horizon_vision.sensors.lidar_driver import PointCloud
from horizon_vision.sensors.camera_driver import ImageFrame


@dataclass
class Detection3D:
    """3D box. Sim ingest uses this for labels; the detector emits its own."""

    label: str
    confidence: float
    center: np.ndarray  # (3,)
    size: np.ndarray  # (3,) l,w,h
    yaw: float = 0.0
    object_id: Optional[int] = None
    distance: Optional[float] = None


@dataclass
class FusedFrame:
    """Combined sensor package ready for AI."""

    point_cloud: Optional[PointCloud]
    image: Optional[ImageFrame]
    timestamp: float
    frame_id: str = "base_link"
    detections: List[Detection3D] = field(default_factory=list)
    sensor_x: Optional[float] = None
    source: str = "fused"


class SensorFusion:
    """
    Time-syncs camera, LiDAR, and optional detections.

    `update_*` / `push_*` enqueue a sample. `get_fused()` pops at most
    one exclusive nearest pair whose timestamps fit inside `window_s`.
    """

    def __init__(self, window_s: float = 0.050, max_age_s: Optional[float] = 0.250):
        self._sync = TimeSynchronizer(
            window_s=window_s,
            required=("camera", "lidar"),
            optional=("detections",),
            max_age_s=max_age_s,
        )

    @property
    def window_s(self) -> float:
        return self._sync.window_s

    def queue_sizes(self) -> dict:
        return self._sync.queue_sizes()

    def update_lidar(self, pc: PointCloud) -> None:
        self._sync.push("lidar", pc.timestamp, pc)

    def update_camera(self, img: ImageFrame) -> None:
        self._sync.push("camera", img.timestamp, img)

    def update_detections(
        self,
        timestamp: float,
        detections: List[Detection3D],
        sensor_x: Optional[float] = None,
    ) -> None:
        self._sync.push("detections", timestamp, (detections, sensor_x))

    # Aliases used by the ingest path.
    push_lidar = update_lidar
    push_camera = update_camera
    push_detections = update_detections

    def get_fused(self) -> Optional[FusedFrame]:
        matched = self._sync.pop_matched()
        if matched is None:
            return None

        image = matched["camera"].payload
        cloud = matched["lidar"].payload
        ts = (matched["camera"].timestamp + matched["lidar"].timestamp) / 2.0

        detections: List[Detection3D] = []
        sensor_x: Optional[float] = None
        if "detections" in matched:
            detections, sensor_x = matched["detections"].payload
            ts = (
                matched["camera"].timestamp
                + matched["lidar"].timestamp
                + matched["detections"].timestamp
            ) / 3.0

        return FusedFrame(
            point_cloud=cloud,
            image=image,
            timestamp=ts,
            detections=list(detections),
            sensor_x=sensor_x,
        )
