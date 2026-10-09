"""
Parse web-sim ingest payloads into camera / LiDAR / label samples.

The web viewer and the fixture replay path share this schema so a
browser is not required to prove the pipe.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, List, Optional, Sequence, Tuple

import numpy as np

from horizon_vision.perception.fusion import Detection3D
from horizon_vision.sensors.camera_driver import ImageFrame
from horizon_vision.sensors.lidar_driver import PointCloud


class IngestError(ValueError):
    """Raised when an HTTP / fixture payload is not a usable sample."""


@dataclass
class ParsedSample:
    """One ingest message, split into the streams it carried."""

    timestamp: float
    sensor_x: Optional[float]
    camera: Optional[ImageFrame]
    lidar: Optional[PointCloud]
    detections: Optional[List[Detection3D]]
    streams: Tuple[str, ...]


def parse_ingest_payload(payload: Any) -> ParsedSample:
    if not isinstance(payload, dict):
        raise IngestError("payload must be a JSON object")

    timestamp = _as_float(payload.get("t"), "t")
    sensor_x = _optional_float(payload.get("sensorX", payload.get("sensor_x")), "sensorX")

    camera = None
    lidar = None
    detections = None
    streams: List[str] = []

    if "camera" in payload and payload["camera"] is not None:
        camera = _parse_camera(payload["camera"], timestamp)
        streams.append("camera")

    if "lidar" in payload and payload["lidar"] is not None:
        lidar = _parse_lidar(payload["lidar"], timestamp)
        streams.append("lidar")

    # `labels` is the preferred name (sim GT for scoring). `detections`
    # is accepted so older fixtures and the ingest tests still parse.
    raw_labels = payload.get("labels")
    if raw_labels is None:
        raw_labels = payload.get("detections")
    if raw_labels is not None:
        detections = _parse_detections(raw_labels)
        streams.append("detections")

    if not streams:
        raise IngestError("payload needs camera, lidar, and/or detections")

    return ParsedSample(
        timestamp=timestamp,
        sensor_x=sensor_x,
        camera=camera,
        lidar=lidar,
        detections=detections,
        streams=tuple(streams),
    )


def stub_camera_frame(
    timestamp: float,
    width: int = 64,
    height: int = 36,
    sensor_x: Optional[float] = None,
    encoding: str = "stub",
) -> ImageFrame:
    """Tiny placeholder image so the edge box has a camera sample."""
    w = max(1, int(width))
    h = max(1, int(height))
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[: h // 2, :] = (180, 140, 100)
    img[h // 2 :, :] = (60, 60, 60)
    if sensor_x is not None:
        # Distinct tint per sensor pose so frames are not identical stubs.
        col = int(max(0, min(255, 40 + (sensor_x * 3) % 180)))
        img[h // 2 :, : max(1, w // 8)] = (col, 70, 70)
    return ImageFrame(
        image=img,
        timestamp=timestamp,
        frame_id="camera_link",
        encoding=encoding or "stub",
    )


def _parse_camera(raw: Any, timestamp: float) -> ImageFrame:
    if not isinstance(raw, dict):
        raise IngestError("camera must be an object")
    width = int(raw.get("width", 64))
    height = int(raw.get("height", 36))
    encoding = str(raw.get("encoding", "stub"))
    sensor_x = _optional_float(raw.get("sensorX", raw.get("sensor_x")), "camera.sensorX")
    pixels = raw.get("pixels")
    if pixels:
        return _camera_from_pixels(pixels, width, height, timestamp, encoding)
    return stub_camera_frame(
        timestamp=timestamp,
        width=width,
        height=height,
        sensor_x=sensor_x,
        encoding=encoding,
    )


def _camera_from_pixels(
    pixels: Any,
    width: int,
    height: int,
    timestamp: float,
    encoding: str,
) -> ImageFrame:
    if not isinstance(pixels, str) or not pixels:
        raise IngestError("camera.pixels must be a base64 string")
    try:
        raw = base64.b64decode(pixels, validate=False)
    except (ValueError, TypeError) as exc:
        raise IngestError("camera.pixels is not valid base64") from exc
    expected = max(1, width) * max(1, height) * 3
    if len(raw) != expected:
        raise IngestError(
            f"camera.pixels length {len(raw)} != {expected} (width*height*3)"
        )
    img = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3).copy()
    return ImageFrame(
        image=img,
        timestamp=timestamp,
        frame_id="camera_link",
        encoding=encoding or "rgb8",
    )


def _parse_lidar(raw: Any, timestamp: float) -> PointCloud:
    if not isinstance(raw, dict):
        raise IngestError("lidar must be an object")
    points_raw = raw.get("points", [])
    if not isinstance(points_raw, list):
        raise IngestError("lidar.points must be an array")

    pts: List[Sequence[float]] = []
    for i, item in enumerate(points_raw):
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            raise IngestError(f"lidar.points[{i}] must be [x, y, z]")
        pts.append((float(item[0]), float(item[1]), float(item[2])))

    if pts:
        points = np.asarray(pts, dtype=np.float32)
    else:
        points = np.zeros((0, 3), dtype=np.float32)

    intensities = None
    if "intensities" in raw and raw["intensities"] is not None:
        intensities = np.asarray(raw["intensities"], dtype=np.float32)

    return PointCloud(
        points=points,
        intensities=intensities,
        timestamp=timestamp,
        frame_id=str(raw.get("frame_id", "lidar_link")),
    )


def _parse_detections(raw: Any) -> List[Detection3D]:
    if not isinstance(raw, list):
        raise IngestError("detections must be an array")
    out: List[Detection3D] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise IngestError(f"detections[{i}] must be an object")
        label = str(item.get("label", "object"))
        center = _vec3(item.get("center"), f"detections[{i}].center")
        size = _vec3(item.get("size"), f"detections[{i}].size", default=(1.0, 1.0, 1.0))
        yaw = float(item.get("yaw", 0.0))
        object_id = item.get("id")
        distance = item.get("distance")
        out.append(
            Detection3D(
                label=label,
                confidence=float(item.get("confidence", 1.0)),
                center=np.asarray(center, dtype=np.float32),
                size=np.asarray(size, dtype=np.float32),
                yaw=yaw,
                object_id=int(object_id) if object_id is not None else None,
                distance=float(distance) if distance is not None else None,
            )
        )
    return out


def _as_float(value: Any, name: str) -> float:
    if value is None:
        raise IngestError(f"{name} is required")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise IngestError(f"{name} must be a number") from exc


def _optional_float(value: Any, name: str) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise IngestError(f"{name} must be a number") from exc


def _vec3(
    value: Any,
    name: str,
    default: Optional[Tuple[float, float, float]] = None,
) -> Tuple[float, float, float]:
    if value is None:
        if default is None:
            raise IngestError(f"{name} is required")
        return default
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        raise IngestError(f"{name} must be [x, y, z]")
    return (float(value[0]), float(value[1]), float(value[2]))
