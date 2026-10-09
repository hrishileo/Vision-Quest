"""LiDAR-cluster detector: sensor-only inference + label metrics."""

from __future__ import annotations

import inspect
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np

from horizon_vision.perception.detector import LidarClusterDetector, infer_up_axis
from horizon_vision.perception.edge_ai import EdgeAIEngine
from horizon_vision.perception.fusion import Detection3D, FusedFrame
from horizon_vision.perception.metrics import box_iou_bev, evaluate_detections
from horizon_vision.sensors.camera_driver import ImageFrame
from horizon_vision.sensors.lidar_driver import PointCloud


ROOT = Path(__file__).resolve().parents[1]
CLUSTER_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "static_cluster.json"


def _box(
    label: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float] = (4.4, 1.8, 1.5),
    yaw: float = 0.0,
) -> Detection3D:
    return Detection3D(
        label=label,
        confidence=1.0,
        center=np.asarray(center, dtype=np.float32),
        size=np.asarray(size, dtype=np.float32),
        yaw=yaw,
    )


def _isolated_vehicle_cloud(
    center=(20.0, 0.85, 0.0),
    size=(4.4, 1.8, 1.5),
    n_vehicle: int = 90,
    n_ground: int = 50,
    seed: int = 7,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    gx = rng.uniform(8.0, 32.0, n_ground)
    gy = rng.uniform(0.0, 0.05, n_ground)
    gz = rng.uniform(-6.0, 6.0, n_ground)
    ground = np.stack([gx, gy, gz], axis=1)
    vx = rng.uniform(center[0] - size[0] / 2, center[0] + size[0] / 2, n_vehicle)
    vy = rng.uniform(0.15, size[2], n_vehicle)
    vz = rng.uniform(center[2] - size[1] / 2, center[2] + size[1] / 2, n_vehicle)
    vehicle = np.stack([vx, vy, vz], axis=1)
    return np.concatenate([ground, vehicle], axis=0).astype(np.float32)


class DetectorContractTests(unittest.TestCase):
    def test_detect_signature_has_no_ground_truth(self) -> None:
        sig = inspect.signature(LidarClusterDetector.detect)
        self.assertEqual(list(sig.parameters), ["self", "points", "image"])
        src = inspect.getsource(LidarClusterDetector.detect)
        self.assertNotIn("fused.detections", src)
        self.assertNotIn("object_id", src)
        self.assertNotIn("ground_truth", src)

    def test_engine_does_not_copy_sim_centers(self) -> None:
        src = inspect.getsource(EdgeAIEngine.process)
        self.assertNotIn("detections = list(fused.detections)", src)
        self.assertIn("self.detector.detect(points, image)", src)

    def test_misleading_labels_are_ignored_at_inference(self) -> None:
        points = _isolated_vehicle_cloud(center=(20.0, 0.85, 0.0))
        fused = FusedFrame(
            point_cloud=PointCloud(points=points, timestamp=1.0),
            image=ImageFrame(image=np.zeros((8, 8, 3), dtype=np.uint8), timestamp=1.0),
            timestamp=1.0,
            detections=[_box("bus", (99.0, 0.0, 99.0), (12.0, 2.6, 3.1))],
            sensor_x=10.0,
        )
        out = EdgeAIEngine(device="cpu").process(fused)
        self.assertGreaterEqual(len(out.detections), 1)
        pred = min(out.detections, key=lambda d: abs(float(d.center[0]) - 20.0))
        self.assertLess(abs(float(pred.center[0]) - 20.0), 1.5)
        self.assertLess(abs(float(pred.center[2]) - 0.0), 1.2)
        self.assertGreater(abs(float(pred.center[0]) - 99.0), 50.0)
        self.assertEqual(out.labels[0].label, "bus")
        self.assertNotEqual(pred.label, "bus")


class ClusteringTests(unittest.TestCase):
    def test_finds_obvious_isolated_vehicle(self) -> None:
        points = _isolated_vehicle_cloud()
        preds = LidarClusterDetector().detect(points)
        self.assertEqual(len(preds), 1)
        pred = preds[0]
        self.assertAlmostEqual(float(pred.center[0]), 20.0, delta=0.8)
        self.assertAlmostEqual(float(pred.center[2]), 0.0, delta=0.6)
        self.assertGreater(float(pred.size[0]), 3.0)
        self.assertLess(float(pred.size[0]), 6.0)
        self.assertGreater(float(pred.size[2]), 0.8)
        self.assertIn(pred.label, {"car", "van", "truck"})

    def test_empty_cloud_is_empty(self) -> None:
        self.assertEqual(LidarClusterDetector().detect(np.zeros((0, 3), dtype=np.float32)), [])
        self.assertEqual(LidarClusterDetector().detect(None), [])

    def test_ground_only_is_empty(self) -> None:
        rng = np.random.default_rng(1)
        ground = np.stack(
            [rng.uniform(0, 30, 200), rng.uniform(0, 0.05, 200), rng.uniform(-5, 5, 200)],
            axis=1,
        ).astype(np.float32)
        self.assertEqual(LidarClusterDetector().detect(ground), [])

    def test_infer_up_axis_y_for_web_cloud(self) -> None:
        points = _isolated_vehicle_cloud()
        self.assertEqual(infer_up_axis(points), 1)


class MetricsTests(unittest.TestCase):
    def test_perfect_overlap(self) -> None:
        a = _box("car", (20.0, 0.8, 0.0))
        metrics = evaluate_detections([a], [a], up_axis=1)
        self.assertEqual(metrics.tp, 1)
        self.assertGreater(metrics.mean_iou, 0.99)
        self.assertEqual(metrics.precision, 1.0)
        self.assertEqual(metrics.recall, 1.0)

    def test_no_overlap_is_false_positive(self) -> None:
        pred = _box("car", (20.0, 0.8, 0.0))
        lab = _box("car", (40.0, 0.0, 3.3))
        self.assertLess(box_iou_bev(pred, lab, up_axis=1), 0.05)
        metrics = evaluate_detections([pred], [lab], up_axis=1)
        self.assertEqual(metrics.tp, 0)
        self.assertEqual(metrics.fp, 1)
        self.assertEqual(metrics.fn, 1)

    def test_engine_scores_in_the_cloud_horizontal_plane(self) -> None:
        points = _isolated_vehicle_cloud()
        fused = FusedFrame(
            point_cloud=PointCloud(points=points, timestamp=1.0),
            image=ImageFrame(image=np.zeros((8, 8, 3), dtype=np.uint8), timestamp=1.0),
            timestamp=1.0,
            detections=[_box("car", (20.0, 0.0, 0.0))],
            sensor_x=10.0,
        )
        out = EdgeAIEngine(device="cpu").process(fused)
        assert out.metrics is not None
        self.assertGreaterEqual(out.metrics.tp, 1)
        self.assertGreater(out.metrics.mean_iou, 0.7)

    def test_metrics_run_on_cluster_fixture(self) -> None:
        payload = json.loads(CLUSTER_FIXTURE.read_text())
        sample = payload["samples"][0]
        points = np.asarray(sample["lidar"]["points"], dtype=np.float32)
        labels = [
            _box(
                item["label"],
                tuple(item["center"]),
                tuple(item["size"]),
                float(item.get("yaw", 0.0)),
            )
            for item in sample["labels"]
        ]
        preds = LidarClusterDetector().detect(points)
        metrics = evaluate_detections(preds, labels, up_axis=1)
        self.assertGreaterEqual(len(preds), 1)
        self.assertGreaterEqual(metrics.tp, 1)
        self.assertGreaterEqual(metrics.precision, 0.99)
        self.assertGreaterEqual(metrics.recall, 0.99)
        self.assertGreater(metrics.mean_iou, 0.7)

    def test_fixture_cli_prints_predictions(self) -> None:
        env = os.environ.copy()
        env["PYTHONPATH"] = str(ROOT / "src")
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "horizon_vision.main",
                "--source",
                "fixture",
                "--fixture",
                str(CLUSTER_FIXTURE),
            ],
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("pred=", result.stdout)
        self.assertIn("→ pred", result.stdout)
        self.assertNotIn("passthrough", result.stdout.lower())


if __name__ == "__main__":
    unittest.main()
