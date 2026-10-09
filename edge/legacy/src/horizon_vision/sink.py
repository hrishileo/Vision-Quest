"""
Stub sink for timestamp-synced samples.

Records that a fused frame is ready. Does not invent traffic or
reroute events — those are later work.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from horizon_vision.perception.edge_ai import PerceptionOutput
from horizon_vision.perception.fusion import Detection3D, FusedFrame


def _box_entry(d: Detection3D) -> Dict[str, Any]:
    return {
        "id": getattr(d, "object_id", None),
        "label": d.label,
        "confidence": float(d.confidence),
        "center": d.center.tolist(),
        "size": d.size.tolist(),
        "yaw": float(d.yaw),
        "distance": getattr(d, "distance", None),
    }


class SyncedSampleSink:
    """In-memory log of synced frames. Ready to swap for a stream later."""

    def __init__(self) -> None:
        self.ready: List[Dict[str, Any]] = []

    def record(
        self,
        fused: FusedFrame,
        perception: Optional[PerceptionOutput] = None,
    ) -> Dict[str, Any]:
        predictions = perception.detections if perception is not None else []
        labels = (
            perception.labels
            if perception is not None
            else list(fused.detections)
        )
        metrics = None
        detector = None
        if perception is not None:
            metrics = perception.extras.get("metrics")
            detector = perception.extras.get("detector")
        entry: Dict[str, Any] = {
            "synced": True,
            "timestamp": fused.timestamp,
            "sensor_x": fused.sensor_x,
            "num_lidar_points": (
                fused.point_cloud.num_points if fused.point_cloud is not None else 0
            ),
            "num_detections": len(predictions),
            "detections": [_box_entry(d) for d in predictions],
            "labels": [_box_entry(d) for d in labels],
            "metrics": metrics,
            "detector": detector,
        }
        self.ready.append(entry)
        return entry
