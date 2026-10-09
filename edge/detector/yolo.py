"""Ultralytics adapter. Imported only when a checkpoint is actually loaded."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from horizon_vision.events.associate import DetBox
from horizon_vision.events.tiles import nms, shift_boxes, tile_windows

NAMES = {0: "vehicle", 1: "unknown"}


class YoloDetector:
    """YOLOv8n / YOLO11n checkpoint. ``detect`` returns pixel boxes.

    ``tile_w`` / ``tile_h`` above 0 also run the model on overlapping crops
    and merge them with the full-frame boxes. ``conf`` is the low floor.
    Birth of a new track is decided later, in ``ByteTrack``.
    """

    def __init__(
        self,
        weights: str | Path,
        conf: float = 0.25,
        imgsz: int = 640,
        device: str = "cpu",
        tile_w: int = 0,
        tile_h: int = 0,
        tile_overlap: float = 0.25,
        nms_iou: float = 0.5,
    ):
        from ultralytics import YOLO

        self.model = YOLO(str(weights))
        self.conf = conf
        self.imgsz = imgsz
        self.device = device
        self.tile_w = tile_w
        self.tile_h = tile_h
        self.tile_overlap = tile_overlap
        self.nms_iou = nms_iou

    def detect(self, image: object) -> list[DetBox]:
        frame = _as_rgb(image)
        boxes = self._predict(frame if frame is not None else image)
        if frame is None or self.tile_w <= 0 or self.tile_h <= 0:
            return boxes
        height, width = frame.shape[:2]
        windows = tile_windows(width, height, self.tile_w, self.tile_h, self.tile_overlap)
        for x, y, w, h in windows:
            if w == width and h == height:
                continue
            crop = frame[y : y + h, x : x + w]
            boxes.extend(shift_boxes(self._predict(crop), x, y))
        return nms(boxes, self.nms_iou)

    def _predict(self, image: object) -> list[DetBox]:
        source = image
        if isinstance(image, np.ndarray) and image.ndim == 3 and image.shape[2] == 3:
            source = image[:, :, ::-1]
        results = self.model.predict(
            source,
            conf=self.conf,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
        )
        boxes: list[DetBox] = []
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                cls_id = int(box.cls[0])
                name = NAMES.get(cls_id)
                if name is None:
                    continue
                boxes.append(
                    DetBox(
                        cls=name,
                        confidence=float(box.conf[0]),
                        u=x1,
                        v=y1,
                        w=max(0.0, x2 - x1),
                        h=max(0.0, y2 - y1),
                    )
                )
        return boxes


def _as_rgb(image: object) -> np.ndarray | None:
    """RGB array for tiling. A path is loaded; an array is returned as-is."""
    if isinstance(image, np.ndarray):
        return image
    if isinstance(image, (str, Path)):
        from PIL import Image

        return np.asarray(Image.open(image).convert("RGB"))
    return None
