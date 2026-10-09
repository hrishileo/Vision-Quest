"""Ingest payload parsing, HTTP path, and fixture replay."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np

from horizon_vision.ingest.payloads import IngestError, parse_ingest_payload
from horizon_vision.ingest.replay import replay_fixture
from horizon_vision.ingest.server import IngestHub, IngestServer
from horizon_vision.perception.fusion import SensorFusion
from horizon_vision.perception.edge_ai import EdgeAIEngine
from horizon_vision.sink import SyncedSampleSink


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "web_samples.json"


def _post(url: str, payload: dict, timeout: float = 2.0) -> dict:
    raw = json.dumps(payload).encode("utf-8")
    req = Request(url, data=raw, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(url: str, timeout: float = 2.0) -> dict:
    with urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


class ParsePayloadTests(unittest.TestCase):
    def test_combined_web_sample(self) -> None:
        parsed = parse_ingest_payload(
            {
                "t": 1723712345.123,
                "sensorX": 14.2,
                "camera": {"width": 64, "height": 36, "encoding": "stub"},
                "lidar": {"points": [[12.0, 0.4, -3.3], [13.0, 0.5, 3.2]]},
                "detections": [
                    {
                        "id": 3,
                        "label": "truck",
                        "center": [20.0, 0.0, 3.3],
                        "size": [8.0, 2.4, 2.8],
                        "distance": 7.1,
                    }
                ],
            }
        )
        self.assertEqual(parsed.streams, ("camera", "lidar", "detections"))
        self.assertAlmostEqual(parsed.timestamp, 1723712345.123)
        self.assertAlmostEqual(parsed.sensor_x or 0.0, 14.2)
        assert parsed.camera is not None
        self.assertEqual(parsed.camera.encoding, "stub")
        self.assertEqual(parsed.camera.image.shape, (36, 64, 3))
        assert parsed.lidar is not None
        self.assertEqual(parsed.lidar.num_points, 2)
        assert parsed.detections is not None
        self.assertEqual(parsed.detections[0].label, "truck")
        self.assertEqual(parsed.detections[0].object_id, 3)

    def test_rejects_empty_payload(self) -> None:
        with self.assertRaises(IngestError):
            parse_ingest_payload({"t": 1.0})

    def test_rejects_missing_timestamp(self) -> None:
        with self.assertRaises(IngestError):
            parse_ingest_payload({"camera": {"width": 8, "height": 8}})

    def test_lidar_only_is_ok(self) -> None:
        parsed = parse_ingest_payload({"t": 1.0, "lidar": {"points": []}})
        self.assertEqual(parsed.streams, ("lidar",))


class IngestHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fusion = SensorFusion(window_s=0.050)
        self.hub = IngestHub(self.fusion)
        self.server = IngestServer(self.hub, host="127.0.0.1", port=0)
        self.server.start()
        self.addCleanup(self.server.stop)

    def test_health(self) -> None:
        body = _get(f"{self.server.url}/health")
        self.assertTrue(body["ok"])
        self.assertEqual(body["accepted"], 0)

    def test_post_combined_sample_enqueues_three_streams(self) -> None:
        body = _post(
            f"{self.server.url}/ingest",
            {
                "t": 10.0,
                "sensorX": 4.5,
                "camera": {"width": 16, "height": 8, "encoding": "stub"},
                "lidar": {"points": [[1.0, 0.2, 0.0]]},
                "detections": [
                    {
                        "id": 1,
                        "label": "car",
                        "center": [6.0, 0.0, 0.0],
                        "size": [4.0, 1.8, 1.5],
                    }
                ],
            },
        )
        self.assertTrue(body["ok"])
        self.assertEqual(body["enqueued"], ["camera", "lidar", "detections"])
        fused = self.fusion.get_fused()
        self.assertIsNotNone(fused)
        assert fused is not None
        self.assertEqual(len(fused.detections), 1)
        self.assertEqual(fused.detections[0].label, "car")
        self.assertAlmostEqual(fused.sensor_x or 0.0, 4.5)

    def test_separate_posts_pair_inside_window(self) -> None:
        _post(
            f"{self.server.url}/ingest",
            {"t": 20.000, "camera": {"width": 8, "height": 8}},
        )
        _post(
            f"{self.server.url}/ingest",
            {"t": 20.040, "lidar": {"points": [[2.0, 0.1, 0.0]]}},
        )
        fused = self.fusion.get_fused()
        self.assertIsNotNone(fused)

    def test_separate_posts_outside_window_do_not_fuse(self) -> None:
        _post(
            f"{self.server.url}/ingest",
            {"t": 30.000, "camera": {"width": 8, "height": 8}},
        )
        _post(
            f"{self.server.url}/ingest",
            {"t": 30.090, "lidar": {"points": [[2.0, 0.1, 0.0]]}},
        )
        self.assertIsNone(self.fusion.get_fused())

    def test_bad_json_is_rejected(self) -> None:
        req = Request(
            f"{self.server.url}/ingest",
            data=b"not-json",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as ctx:
            urlopen(req, timeout=2.0)
        self.assertEqual(ctx.exception.code, 400)

    def test_unknown_route(self) -> None:
        req = Request(
            f"{self.server.url}/nope",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as ctx:
            urlopen(req, timeout=2.0)
        self.assertEqual(ctx.exception.code, 404)


class FixtureReplayTests(unittest.TestCase):
    def test_fixture_produces_synced_frames_with_sim_detections(self) -> None:
        fusion = SensorFusion(window_s=0.050, max_age_s=None)
        hub = IngestHub(fusion)
        accepted = replay_fixture(hub, FIXTURE)
        self.assertEqual(accepted, 7)

        ai = EdgeAIEngine(device="cpu", target_fps=15)
        sink = SyncedSampleSink()
        while True:
            fused = fusion.get_fused()
            if fused is None:
                break
            perception = ai.process(fused)
            sink.record(fused, perception)

        # Two combined samples + one split triplet. The 80 ms pair is dropped.
        self.assertEqual(len(sink.ready), 3)
        self.assertTrue(all(item["synced"] for item in sink.ready))

        first = sink.ready[0]
        self.assertAlmostEqual(first["sensor_x"], 10.0)
        self.assertEqual(first["labels"][0]["label"], "car")
        self.assertEqual(first["detector"], "lidar_cluster")

        second = sink.ready[1]
        labels = {d["label"] for d in second["labels"]}
        self.assertEqual(labels, {"car", "van"})

        third = sink.ready[2]
        self.assertEqual(third["labels"][0]["label"], "pedestrian")
        self.assertAlmostEqual(third["sensor_x"], 22.4)

    def test_engine_does_not_passthrough_sim_labels(self) -> None:
        fusion = SensorFusion(window_s=0.050)
        hub = IngestHub(fusion)
        hub.accept(
            {
                "t": 1.0,
                "sensorX": 3.0,
                "camera": {"width": 8, "height": 8},
                "lidar": {"points": [[1.0, 0.0, 0.0]] * 10},
                "detections": [
                    {
                        "id": 9,
                        "label": "bus",
                        "center": [12.0, 0.0, 0.0],
                        "size": [11.0, 2.5, 3.0],
                    }
                ],
            }
        )
        fused = fusion.get_fused()
        assert fused is not None
        perception = EdgeAIEngine(device="cpu").process(fused)
        self.assertEqual(perception.labels[0].label, "bus")
        self.assertEqual(len(perception.detections), 0)

    def test_labels_alias_and_camera_pixels(self) -> None:
        import base64

        pixels = base64.b64encode(bytes([10, 20, 30, 40, 50, 60])).decode("ascii")
        parsed = parse_ingest_payload(
            {
                "t": 2.0,
                "sensorX": 1.0,
                "camera": {"width": 2, "height": 1, "encoding": "rgb8", "pixels": pixels},
                "lidar": {"points": [[3.0, 0.4, 0.0]]},
                "labels": [
                    {
                        "id": 2,
                        "label": "car",
                        "center": [8.0, 0.0, 0.0],
                        "size": [4.4, 1.8, 1.5],
                    }
                ],
            }
        )
        self.assertEqual(parsed.streams, ("camera", "lidar", "detections"))
        assert parsed.camera is not None
        self.assertEqual(parsed.camera.encoding, "rgb8")
        self.assertEqual(parsed.camera.image.shape, (1, 2, 3))
        self.assertEqual(int(parsed.camera.image[0, 0, 0]), 10)
        assert parsed.detections is not None
        self.assertEqual(parsed.detections[0].label, "car")

    def test_predictions_endpoint_returns_detector_boxes(self) -> None:
        fusion = SensorFusion(window_s=0.050)
        hub = IngestHub(fusion)
        server = IngestServer(hub, host="127.0.0.1", port=0)
        server.start()
        self.addCleanup(server.stop)

        rng = np.random.default_rng(3)
        veh = np.stack(
            [
                rng.uniform(18.0, 22.0, 80),
                rng.uniform(0.2, 1.5, 80),
                rng.uniform(-0.9, 0.9, 80),
            ],
            axis=1,
        ).astype(np.float32)
        hub.accept(
            {
                "t": 4.0,
                "sensorX": 10.0,
                "camera": {"width": 8, "height": 8},
                "lidar": {"points": veh.tolist()},
                "labels": [
                    {
                        "label": "car",
                        "center": [20.0, 0.0, 0.0],
                        "size": [4.4, 1.8, 1.5],
                    }
                ],
            }
        )
        fused = fusion.get_fused()
        assert fused is not None
        perception = EdgeAIEngine(device="cpu").process(fused)
        hub.publish_perception(perception)
        body = _get(f"{server.url}/predictions")
        self.assertEqual(body["detector"], "lidar_cluster")
        self.assertGreaterEqual(len(body["predictions"]), 1)
        self.assertEqual(body["labels"][0]["label"], "car")
        self.assertIsNotNone(body["metrics"])


if __name__ == "__main__":
    unittest.main()
