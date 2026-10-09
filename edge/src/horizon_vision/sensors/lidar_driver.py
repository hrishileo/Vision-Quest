"""
3D LiDAR driver interface for Horizon Vision.

Designed to feed point clouds to the edge AI computer.
Supports both simulated data (for development) and real drivers later.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import time
import numpy as np


@dataclass
class PointCloud:
    """Simple point cloud container."""
    points: np.ndarray          # (N, 3) XYZ
    intensities: Optional[np.ndarray] = None  # (N,)
    timestamp: float = 0.0
    frame_id: str = "lidar_link"

    @property
    def num_points(self) -> int:
        return self.points.shape[0]


class LidarDriver(ABC):
    """Abstract 3D LiDAR interface."""

    def __init__(self, frame_id: str = "lidar_link", max_range: float = 100.0):
        self.frame_id = frame_id
        self.max_range = max_range
        self._running = False

    @abstractmethod
    def start(self) -> None:
        ...

    @abstractmethod
    def stop(self) -> None:
        ...

    @abstractmethod
    def get_point_cloud(self) -> Optional[PointCloud]:
        """Return the latest point cloud or None if not ready."""
        ...

    def is_running(self) -> bool:
        return self._running


class SimulatedLidarDriver(LidarDriver):
    """
    Generates synthetic point clouds that roughly look like a road scene.
    Useful for developing the edge pipeline without real hardware.
    """

    def __init__(self, frame_id: str = "lidar_link", max_range: float = 80.0):
        super().__init__(frame_id=frame_id, max_range=max_range)
        self._counter = 0

    def start(self) -> None:
        self._running = True
        print("[SimulatedLidar] Started")

    def stop(self) -> None:
        self._running = False
        print("[SimulatedLidar] Stopped")

    def get_point_cloud(self) -> Optional[PointCloud]:
        if not self._running:
            return None

        self._counter += 1
        rng = np.random.default_rng(self._counter)

        # Ground plane (road)
        n_ground = 4000
        x = rng.uniform(-20, 40, n_ground)
        y = rng.uniform(-8, 8, n_ground)
        z = rng.normal(0.0, 0.05, n_ground)
        ground = np.stack([x, y, z], axis=1)

        # A few "vehicles" as dense clusters
        vehicles = []
        for cx, cy in [(12.0, 2.5), (25.0, -3.0), (8.0, -1.5)]:
            n_v = 300
            vx = rng.normal(cx, 1.8, n_v)
            vy = rng.normal(cy, 0.9, n_v)
            vz = rng.uniform(0.2, 1.6, n_v)
            vehicles.append(np.stack([vx, vy, vz], axis=1))

        points = np.concatenate([ground] + vehicles, axis=0)

        # Simple range filter
        dist = np.linalg.norm(points[:, :2], axis=1)
        mask = dist < self.max_range
        points = points[mask]

        intensities = rng.uniform(0.1, 1.0, size=points.shape[0]).astype(np.float32)

        return PointCloud(
            points=points.astype(np.float32),
            intensities=intensities,
            timestamp=time.time(),
            frame_id=self.frame_id,
        )


def create_lidar_driver(config: dict) -> LidarDriver:
    """Factory for LiDAR drivers."""
    lidar_cfg = config.get("sensors", {}).get("lidar", {})
    lidar_type = lidar_cfg.get("type", "simulated").lower()
    frame_id = lidar_cfg.get("frame_id", "lidar_link")
    max_range = float(lidar_cfg.get("max_range", 100.0))

    if lidar_type == "simulated":
        return SimulatedLidarDriver(frame_id=frame_id, max_range=max_range)

    # Future real drivers will be added here:
    # elif lidar_type == "livox":
    #     return LivoxDriver(...)
    # elif lidar_type == "velodyne":
    #     return VelodyneDriver(...)

    raise ValueError(f"Unsupported LiDAR type: {lidar_type}")
