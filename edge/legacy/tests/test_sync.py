"""Exclusive nearest-timestamp pairing."""

from __future__ import annotations

import unittest

from horizon_vision.perception.sync import TimeSynchronizer


class TimeSynchronizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sync = TimeSynchronizer(window_s=0.050, max_age_s=0.250)

    def test_pair_within_window(self) -> None:
        self.sync.push("camera", 1.000, "cam")
        self.sync.push("lidar", 1.030, "lid")
        matched = self.sync.pop_matched()
        self.assertIsNotNone(matched)
        assert matched is not None
        self.assertEqual(matched["camera"].payload, "cam")
        self.assertEqual(matched["lidar"].payload, "lid")
        self.assertNotIn("detections", matched)

    def test_same_timestamp_pairs(self) -> None:
        self.sync.push("camera", 5.0, "c")
        self.sync.push("lidar", 5.0, "l")
        self.sync.push("detections", 5.0, ["car"])
        matched = self.sync.pop_matched()
        assert matched is not None
        self.assertEqual(matched["detections"].payload, ["car"])

    def test_reject_outside_window(self) -> None:
        self.sync.push("camera", 1.000, "cam")
        self.sync.push("lidar", 1.060, "lid")
        self.assertIsNone(self.sync.pop_matched())

    def test_drop_unpaired_when_other_stream_has_moved_on(self) -> None:
        self.sync.push("camera", 1.000, "old-cam")
        self.sync.push("lidar", 1.080, "late-lid")
        self.assertIsNone(self.sync.pop_matched())
        sizes = self.sync.queue_sizes()
        self.assertEqual(sizes["camera"], 0)
        self.assertGreaterEqual(self.sync.dropped, 1)

    def test_nearest_wins_among_in_window_candidates(self) -> None:
        self.sync.push("camera", 0.100, "cam")
        self.sync.push("lidar", 0.080, "near")
        self.sync.push("lidar", 0.145, "far")
        matched = self.sync.pop_matched()
        assert matched is not None
        self.assertEqual(matched["lidar"].payload, "near")
        self.assertEqual(self.sync.queue_sizes()["lidar"], 1)

    def test_exclusive_sample_cannot_pair_twice(self) -> None:
        self.sync.push("camera", 0.000, "cam-a")
        self.sync.push("camera", 0.010, "cam-b")
        self.sync.push("lidar", 0.006, "lid")
        first = self.sync.pop_matched()
        assert first is not None
        self.assertEqual(first["camera"].payload, "cam-b")
        self.assertEqual(first["lidar"].payload, "lid")
        self.assertIsNone(self.sync.pop_matched())
        self.assertEqual(self.sync.queue_sizes()["lidar"], 0)

    def test_earlier_group_wins_when_spans_tie(self) -> None:
        self.sync.push("camera", 0.0, "c0")
        self.sync.push("camera", 0.010, "c1")
        self.sync.push("lidar", 0.005, "l0")
        self.sync.push("lidar", 0.015, "l1")
        first = self.sync.pop_matched()
        second = self.sync.pop_matched()
        assert first is not None and second is not None
        self.assertEqual(first["camera"].payload, "c0")
        self.assertEqual(first["lidar"].payload, "l0")
        self.assertEqual(second["camera"].payload, "c1")
        self.assertEqual(second["lidar"].payload, "l1")

    def test_detections_attach_inside_window(self) -> None:
        self.sync.push("camera", 2.000, "c")
        self.sync.push("lidar", 2.020, "l")
        self.sync.push("detections", 2.010, ["pedestrian"])
        matched = self.sync.pop_matched()
        assert matched is not None
        self.assertEqual(matched["detections"].payload, ["pedestrian"])

    def test_detections_outside_window_are_not_attached(self) -> None:
        self.sync.push("camera", 2.000, "c")
        self.sync.push("lidar", 2.010, "l")
        self.sync.push("detections", 2.080, ["stale"])
        matched = self.sync.pop_matched()
        assert matched is not None
        self.assertNotIn("detections", matched)

    def test_out_of_order_arrival_still_pairs(self) -> None:
        self.sync.push("lidar", 4.030, "l")
        self.sync.push("camera", 4.000, "c")
        matched = self.sync.pop_matched()
        assert matched is not None
        self.assertEqual(matched["camera"].payload, "c")

    def test_max_age_drops_abandoned_samples(self) -> None:
        sync = TimeSynchronizer(window_s=0.050, max_age_s=0.100)
        sync.push("camera", 1.000, "old")
        sync.push("lidar", 1.200, "new")
        self.assertEqual(sync.queue_sizes()["camera"], 0)
        self.assertIsNone(sync.pop_matched())


class SensorFusionPairingTests(unittest.TestCase):
    def test_get_fused_requires_both_modalities(self) -> None:
        from horizon_vision.perception.fusion import SensorFusion
        from horizon_vision.sensors.camera_driver import ImageFrame
        from horizon_vision.sensors.lidar_driver import PointCloud
        import numpy as np

        fusion = SensorFusion(window_s=0.050)
        img = ImageFrame(image=np.zeros((2, 2, 3), dtype=np.uint8), timestamp=1.0)
        fusion.update_camera(img)
        self.assertIsNone(fusion.get_fused())

        pc = PointCloud(points=np.zeros((1, 3), dtype=np.float32), timestamp=1.02)
        fusion.update_lidar(pc)
        fused = fusion.get_fused()
        self.assertIsNotNone(fused)
        assert fused is not None
        self.assertIsNotNone(fused.image)
        self.assertIsNotNone(fused.point_cloud)

    def test_does_not_staple_latest_of_each(self) -> None:
        from horizon_vision.perception.fusion import SensorFusion
        from horizon_vision.sensors.camera_driver import ImageFrame
        from horizon_vision.sensors.lidar_driver import PointCloud
        import numpy as np

        fusion = SensorFusion(window_s=0.050)
        fusion.update_camera(
            ImageFrame(image=np.zeros((2, 2, 3), dtype=np.uint8), timestamp=1.0)
        )
        fusion.update_lidar(
            PointCloud(points=np.zeros((1, 3), dtype=np.float32), timestamp=1.2)
        )
        self.assertIsNone(fusion.get_fused())


if __name__ == "__main__":
    unittest.main()
