"""
Camera driver interface for Horizon Vision.

Feeds images to the edge AI computer alongside LiDAR data.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Tuple
import time
import numpy as np

try:
    import cv2
except ImportError:
    cv2 = None


@dataclass
class ImageFrame:
    """Camera frame container."""
    image: np.ndarray           # BGR or RGB, HxWxC
    timestamp: float = 0.0
    frame_id: str = "camera_link"
    encoding: str = "bgr8"

    @property
    def shape(self) -> Tuple[int, ...]:
        return self.image.shape


class CameraDriver(ABC):
    """Abstract camera interface."""

    def __init__(self, frame_id: str = "camera_link", width: int = 1280, height: int = 720):
        self.frame_id = frame_id
        self.width = width
        self.height = height
        self._running = False

    @abstractmethod
    def start(self) -> None:
        ...

    @abstractmethod
    def stop(self) -> None:
        ...

    @abstractmethod
    def get_frame(self) -> Optional[ImageFrame]:
        """Return the latest image frame or None."""
        ...

    def is_running(self) -> bool:
        return self._running


class SimulatedCameraDriver(CameraDriver):
    """
    Generates synthetic road-like images for pipeline development.
    """

    def __init__(self, frame_id: str = "camera_link", width: int = 1280, height: int = 720):
        super().__init__(frame_id=frame_id, width=width, height=height)
        self._counter = 0

    def start(self) -> None:
        self._running = True
        print("[SimulatedCamera] Started")

    def stop(self) -> None:
        self._running = False
        print("[SimulatedCamera] Stopped")

    def get_frame(self) -> Optional[ImageFrame]:
        if not self._running:
            return None

        self._counter += 1

        # Simple synthetic road scene
        img = np.zeros((self.height, self.width, 3), dtype=np.uint8)

        # Sky
        img[: self.height // 2, :] = (180, 140, 100)

        # Road
        img[self.height // 2 :, :] = (60, 60, 60)

        if cv2 is not None:
            # Lane markings
            for y in range(self.height // 2 + 20, self.height, 40):
                cv2.rectangle(
                    img,
                    (self.width // 2 - 8, y),
                    (self.width // 2 + 8, y + 20),
                    (220, 220, 220),
                    -1,
                )
            # Fake vehicle blobs
            cv2.rectangle(img, (400, 380), (520, 480), (30, 30, 180), -1)
            cv2.rectangle(img, (750, 400), (900, 500), (20, 120, 40), -1)
            noise = np.random.randint(0, 15, img.shape, dtype=np.uint8)
            img = cv2.add(img, noise)
        else:
            # Fallback without OpenCV
            img[380:480, 400:520] = (30, 30, 180)
            img[400:500, 750:900] = (20, 120, 40)

        return ImageFrame(
            image=img,
            timestamp=time.time(),
            frame_id=self.frame_id,
            encoding="bgr8",
        )


class WebIngestCameraDriver(CameraDriver):
    """
    Camera frames arrive on the HTTP ingest server from the web sim.

    This driver does not invent a scene — `get_frame()` stays empty so
    the main loop reads fused samples from the ingest hub.
    """

    def start(self) -> None:
        self._running = True
        print("[WebCamera] Waiting for web-sim samples on ingest")

    def stop(self) -> None:
        self._running = False
        print("[WebCamera] Stopped")

    def get_frame(self) -> Optional[ImageFrame]:
        return None


def create_camera_driver(config: dict) -> CameraDriver:
    """Factory for camera drivers."""
    cam_cfg = config.get("sensors", {}).get("camera", {})
    cam_type = cam_cfg.get("type", "simulated").lower()
    frame_id = cam_cfg.get("frame_id", "camera_link")
    width = int(cam_cfg.get("width", 1280))
    height = int(cam_cfg.get("height", 720))

    if cam_type == "simulated":
        return SimulatedCameraDriver(frame_id=frame_id, width=width, height=height)

    if cam_type in ("web", "ingest"):
        return WebIngestCameraDriver(frame_id=frame_id, width=width, height=height)

    raise ValueError(f"Unsupported camera type: {cam_type}")
