"""Ultralytics adapter. Imported only when a checkpoint is actually loaded."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from horizon_vision.events.associate import DetBox

NAMES = {0: "vehicle", 1: "unknown"}


class YoloDetector:
    """YOLOv8n / YOLO11n checkpoint. ``detect`` returns pixel boxes."""

    def __init__(self, weights: str | Path, conf: float = 0.25, imgsz: int = 320, device: str = "cpu"):
        from ultralytics import YOLO

        self.model = YOLO(str(weights))
        self.conf = conf
        self.imgsz = imgsz
        self.device = device

    def detect(self, image: object) -> list[DetBox]:
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
