"""Ground-plane projection with hand-computed answers, plus the label pipeline."""

import math
from pathlib import Path

import pytest

from horizon_vision.events.accuracy import accuracy_report
from horizon_vision.events.labels import (
    BBox,
    CameraIntrinsics,
    CameraPose,
    LabelParseError,
    parse_frame,
    read_jsonl,
)
from horizon_vision.events.monocular import estimate_ground_point
from horizon_vision.events.pipeline import PipelineResult, ScoredSample, run_label_pipeline

FIXTURE = Path(__file__).parent / "fixtures" / "mag_mile_labels.jsonl"

# 100 px focal length, principal point at the image center.
INTR = CameraIntrinsics(
    fov_deg=100.0,
    width=640,
    height=480,
    focal_length_px=100.0,
    cx=320.0,
    cy=240.0,
)


def _box(u_contact: float, v_contact: float) -> BBox:
    """A 20×10 box whose bottom-center is the given pixel."""
    return BBox(u=u_contact - 10.0, v=v_contact - 10.0, w=20.0, h=10.0)


def test_nadir_pixel_offsets_match_metres_east_and_south():
    # Yaw 0, looking straight down. Image right is east and image down is
    # south. 0.1 focal-lengths at 10 m altitude is 1 m.
    pose = CameraPose(x=0.0, y=10.0, z=0.0, agl=10.0, yaw=0.0, pitch=-math.pi / 2, roll=0.0)

    center = estimate_ground_point(_box(320.0, 240.0), pose, INTR)
    assert center is not None
    assert center.x == pytest.approx(0.0, abs=1e-9)
    assert center.y == pytest.approx(0.0, abs=1e-9)
    assert center.confidence == pytest.approx(1.0)

    east = estimate_ground_point(_box(330.0, 240.0), pose, INTR)
    assert east is not None
    assert (east.x, east.y) == pytest.approx((1.0, 0.0))

    south = estimate_ground_point(_box(320.0, 250.0), pose, INTR)
    assert south is not None
    assert (south.x, south.y) == pytest.approx((0.0, 1.0))


def test_level_camera_at_yaw_zero_looks_north_and_image_right_is_east():
    # Camera 5 m up, level, yaw 0. The optical axis points north, so a ground
    # point 20 m north is 5/20 = 0.25 focal-lengths below the principal point.
    # A further 0.1 focal-lengths of image-right is 2 m east.
    pose = CameraPose(x=0.0, y=5.0, z=0.0, agl=5.0, yaw=0.0, pitch=0.0, roll=0.0)
    estimate = estimate_ground_point(_box(330.0, 265.0), pose, INTR)
    assert estimate is not None
    assert (estimate.x, estimate.y) == pytest.approx((2.0, -20.0))


def test_rays_that_miss_the_ground_return_none():
    pose = CameraPose(x=0.0, y=5.0, z=0.0, agl=5.0, yaw=0.0, pitch=0.0, roll=0.0)
    assert estimate_ground_point(_box(320.0, 240.0), pose, INTR) is None
    assert estimate_ground_point(_box(320.0, 230.0), pose, INTR) is None
    on_ground = CameraPose(x=0.0, y=0.0, z=0.0, agl=0.0, yaw=math.pi, pitch=-math.pi / 2, roll=0.0)
    assert estimate_ground_point(_box(320.0, 240.0), on_ground, INTR) is None


def test_events_follow_the_ground_plane_not_the_label_truth():
    # Bottom-center (330, 240) on the nadir camera above is world (1, 0).
    # The label's true position is somewhere else and must not be published.
    # class is vehicle but kind is blockade, so the event is unknown.
    def frame(t: float) -> dict:
        return {
            "t": t,
            "camera": {
                "image": "ignored.png",
                "pose": {
                    "x": 0.0,
                    "y": 10.0,
                    "z": 0.0,
                    "agl": 10.0,
                    "yaw": 0.0,
                    "pitch": -math.pi / 2,
                    "roll": 0.0,
                },
                "intrinsics": {
                    "fov": 90.0,
                    "width": 640,
                    "height": 480,
                    "focal_length": 100.0,
                    "principal_point": [320.0, 240.0],
                },
            },
            "objects": [
                {
                    "track_id": 7,
                    "class": "vehicle",
                    "type": "barrier",
                    "kind": "blockade",
                    "lane": "mich-nb-2",
                    "bbox": [320.0, 230.0, 20.0, 10.0],
                    "position": {"x": 99.0, "y": 0.0, "z": 99.0},
                    "speed": None,
                }
            ],
        }

    frames = [parse_frame(frame(t)) for t in (0.0, 0.1, 0.2)]
    assert frames[0].objects[0].track_id == "7"
    assert frames[0].objects[0].unknown is True
    result = run_label_pipeline(frames)
    assert result.projected == 3
    assert len(result.events) == 1
    event = result.events[0]
    assert event.cls == "unknown"
    assert event.unknown is True
    assert event.lane == "mich-nb-2"
    assert (event.x, event.y) == pytest.approx((1.0, 0.0), abs=1e-6)
    assert event.speed == pytest.approx(0.0, abs=1e-6)
    assert result.samples[0].truth_x == pytest.approx(99.0)
    assert result.samples[0].est_x == pytest.approx(1.0)


def test_parser_rejects_a_bad_class():
    empty = parse_frame(
        {
            "t": 0.0,
            "camera": {
                "pose": {
                    "x": 0, "y": 1, "z": 0, "agl": 1,
                    "yaw": 0, "pitch": 0, "roll": 0,
                },
                "intrinsics": {
                    "fov": 60,
                    "width": 64,
                    "height": 48,
                    "focal_length": 40,
                    "principal_point": {"cx": 32, "cy": 24},
                },
            },
            "objects": [],
        }
    )
    assert empty.objects == ()
    good = {
        "t": 0.0,
        "camera": {
            "pose": {"x": 0, "y": 1, "z": 0, "agl": 1, "yaw": 0, "pitch": -1, "roll": 0},
            "intrinsics": {
                "width": 64,
                "height": 48,
                "focal_length": 40,
                "principal_point": {"cx": 32, "cy": 24},
            },
        },
        "objects": [{"track_id": "a", "class": "pedestrian", "type": "person", "bbox": [0, 0, 1, 1], "position": [0, 0, 0]}],
    }
    with pytest.raises(LabelParseError):
        parse_frame(good)


def test_error_stats_mean_and_p95():
    samples = [
        ScoredSample(0.0, "a", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        ScoredSample(1.0, "a", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        ScoredSample(2.0, "a", 10.0, 0.0, 3.0, 0.0, 0.0, 0.0),
        ScoredSample(3.0, "a", 0.0, 0.0, None, 0.0, 0.0, 0.0),
    ]
    result = PipelineResult(events=[], samples=samples, frames=4, labels=4, projected=4)
    report = accuracy_report(result)
    assert report.position_m.n == 4
    assert report.position_m.mean == pytest.approx(2.5)
    assert report.position_m.p95 == pytest.approx(8.5)
    assert report.speed_mps.n == 3
    assert report.speed_mps.mean == pytest.approx(1.0)
    assert report.speed_mps.p95 == pytest.approx(2.7)


def test_recorder_bbox_and_lane_ids():
    frame = parse_frame(
        {
            "schema": 1,
            "groundTruth": True,
            "t": 0.1,
            "file": "images/000000.png",
            "camera": {
                "position": {"x": 1.0, "y": 8.0, "z": 2.0},
                "agl": 8.0,
                "yaw": 0.0,
                "pitch": -0.4,
                "roll": 0.0,
                "intrinsics": {
                    "fovY": 70,
                    "width": 960,
                    "height": 540,
                    "fx": 400.0,
                    "fy": 380.0,
                    "cx": 480,
                    "cy": 270,
                },
            },
            "objects": [
                {
                    "trackId": "veh-3",
                    "class": "vehicle",
                    "type": "vehicle",
                    "kind": None,
                    "laneId": "rush-nb-0",
                    "position": {"x": 60.8, "y": 0, "z": -10},
                    "speed": 4.5,
                    "bbox": {"x": 10, "y": 20, "w": 30, "h": 40},
                },
                {
                    "trackId": "deb-2",
                    "class": "unknown",
                    "type": "barrier",
                    "kind": "blockade",
                    "laneId": "mich-nb-0",
                    "position": {"x": 2.0, "y": 0, "z": 12.0},
                    "speed": None,
                    "bbox": {"x": 100, "y": 200, "w": 12, "h": 8},
                },
                {
                    "trackId": "veh-9",
                    "class": "vehicle",
                    "type": "vehicle",
                    "kind": None,
                    "laneId": "chi-eb-0",
                    "position": {"x": 4, "y": 0, "z": 2.4},
                    "speed": 0,
                    "bbox": {"x": 1, "y": 2, "w": 3, "h": 4},
                },
            ],
        }
    )
    assert frame.pose.y == pytest.approx(8.0)
    assert frame.pose.agl == pytest.approx(frame.pose.y)
    assert frame.intrinsics.focal_x == pytest.approx(400.0)
    assert frame.intrinsics.focal_y == pytest.approx(380.0)
    by_id = {obj.track_id: obj for obj in frame.objects}
    assert by_id["veh-3"].lane == "rush-nb-0"
    assert by_id["veh-3"].truth_y_up == pytest.approx(0.0)
    assert by_id["deb-2"].lane == "mich-nb-0"
    assert by_id["deb-2"].unknown is True
    assert by_id["deb-2"].kind == "blockade"
    assert by_id["veh-9"].lane == "chi-eb-0"
    # bottom-center of {x:10, y:20, w:30, h:40} is (25, 60)
    assert by_id["veh-3"].bbox.ground_contact == pytest.approx((25.0, 60.0))


def test_cam0_sample_parses_scene_lane_ids():
    frames = read_jsonl(
        Path(__file__).resolve().parents[2] / "src/lib/guide/__fixtures__/cam0-sample.labels.jsonl"
    )
    assert len(frames) == 28
    lanes = {obj.lane for frame in frames for obj in frame.objects}
    assert "mich-nb-0" in lanes
    assert "chi-eb-0" in lanes
    debris = [obj for frame in frames for obj in frame.objects if obj.unknown]
    assert debris
    assert all(obj.cls == "unknown" for obj in debris)
    # Off-lane debris still exports laneId, as null.
    assert any(obj.lane is None for obj in debris)
    assert frames[0].pose.agl == pytest.approx(frames[0].pose.y)


def test_fixture_round_trip_error_is_numerical_noise():
    frames = read_jsonl(FIXTURE)
    assert len(frames) >= 5
    result = run_label_pipeline(frames)
    report = accuracy_report(result)
    assert result.events
    assert report.position_m.n == result.projected
    assert report.position_m.mean < 1e-6
    assert report.position_m.p95 < 1e-6
    assert report.speed_mps.n > 0
    assert report.speed_mps.mean < 1e-6
    assert report.speed_mps.p95 < 1e-6
    text = report.text()
    assert "position error (ground plane):" in text
    assert "position error (emitted):" in text
    assert "speed error (tracked):" in text
    assert report.emitted_position_m.n == len(result.events)
