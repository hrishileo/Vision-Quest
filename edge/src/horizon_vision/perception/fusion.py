"""
Basic sensor fusion node.

Takes synchronized (or near-synchronized) LiDAR + Camera data
and prepares a unified input package for the edge AI engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import time

from horizon_vision.sensors.lidar_driver import PointCloud
from horizon_vision.sensors.camera_driver import ImageFrame


@dataclass
class FusedFrame:
    """Combined sensor package ready for AI."""
    point_cloud: Optional[PointCloud]
    image: Optional[ImageFrame]
    timestamp: float
    frame_id: str = "base_link"


class SensorFusion:
    """
    Simple fusion that currently just packages the latest data.
    Later this will handle time synchronization, extrinsic calibration,
    and projection of LiDAR onto the image plane.
    """

    def __init__(self):
        self._latest_pc: Optional[PointCloud] = None
        self._latest_img: Optional[ImageFrame] = None

    def update_lidar(self, pc: PointCloud) -> None:
        self._latest_pc = pc

    def update_camera(self, img: ImageFrame) -> None:
        self._latest_img = img

    def get_fused(self) -> Optional[FusedFrame]:
        if self._latest_pc is None and self._latest_img is None:
            return None

        ts = time.time()
        if self._latest_pc is not None:
            ts = self._latest_pc.timestamp
        elif self._latest_img is not None:
            ts = self._latest_img.timestamp

        return FusedFrame(
            point_cloud=self._latest_pc,
            image=self._latest_img,
            timestamp=ts,
        )
