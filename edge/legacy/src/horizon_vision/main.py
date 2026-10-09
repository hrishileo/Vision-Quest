"""
Horizon Vision - Main entry point for the edge computer.

This script runs on the Jetson (or development machine) and:
1. Starts LiDAR + Camera drivers (simulated) or a local web ingest
2. Time-syncs camera + LiDAR (+ sim labels) inside a pairing window
3. Runs the LiDAR-cluster detector (sensor data only — not detectLive)
4. Scores predictions against sim labels when those are attached
5. Builds a local map
6. Records synced samples on a stub sink (ready to stream later)
"""

from __future__ import annotations

import argparse
import time
import sys
from pathlib import Path

import yaml

# Make sure the package is importable when running as script
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from horizon_vision.sensors import create_lidar_driver, create_camera_driver
from horizon_vision.perception import SensorFusion, EdgeAIEngine
from horizon_vision.mapping import LocalMapBuilder
from horizon_vision.ingest import IngestHub, IngestServer, replay_fixture
from horizon_vision.sink import SyncedSampleSink


def load_config(path: str) -> dict:
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


def apply_source_overrides(config: dict, source: str) -> dict:
    """Force sensor types to match --source without rewriting the yaml."""
    sensors = config.setdefault("sensors", {})
    if source in ("web", "fixture"):
        sensors.setdefault("lidar", {})["type"] = "web"
        sensors.setdefault("camera", {})["type"] = "web"
        if source == "web":
            config.setdefault("ingest", {})["enabled"] = True
    elif source == "simulated":
        sensors.setdefault("lidar", {})["type"] = "simulated"
        sensors.setdefault("camera", {})["type"] = "simulated"
    return config


def log_frame(frame_idx: int, fused, perception) -> None:
    sensor_x = fused.sensor_x
    pose = f" sensorX={sensor_x:5.1f}" if sensor_x is not None else ""
    n_pred = len(perception.detections)
    n_lab = len(perception.labels)
    metrics = perception.metrics
    score = ""
    if metrics is not None:
        score = (
            f" | P={metrics.precision:.2f} R={metrics.recall:.2f} "
            f"IoU={metrics.mean_iou:.2f}"
        )
    print(
        f"[{frame_idx:04d}] "
        f"t={fused.timestamp:.3f}{pose} "
        f"points={perception.num_lidar_points:5d} | "
        f"pred={n_pred:2d} labels={n_lab:2d}{score} | "
        f"AI={perception.processing_time_ms:5.1f} ms"
    )
    for d in perception.detections:
        dist = getattr(d, "distance", None)
        dist_s = f" {dist:.1f}m" if dist is not None else ""
        print(
            f"         → pred {d.label}{dist_s} conf={d.confidence:.2f} "
            f"at [{d.center[0]:.1f}, {d.center[1]:.1f}, {d.center[2]:.1f}]"
        )


def process_fused(fused, ai, local_map, sink, frame_idx: int, hub=None) -> int:
    perception = ai.process(fused)
    local_map.update(fused.point_cloud, perception)
    sink.record(fused, perception)
    if hub is not None:
        hub.publish_perception(perception)
    frame_idx += 1
    log_frame(frame_idx, fused, perception)
    return frame_idx


def main():
    parser = argparse.ArgumentParser(description="Horizon Vision Edge Pipeline")
    parser.add_argument(
        "--config",
        type=str,
        default="config/sensors.yaml",
        help="Path to sensors.yaml",
    )
    parser.add_argument(
        "--source",
        type=str,
        choices=("simulated", "web", "fixture"),
        default=None,
        help="Sample source: simulated drivers, live web ingest, or a JSON fixture",
    )
    parser.add_argument(
        "--fixture",
        type=str,
        default=None,
        help="JSON fixture of web ingest payloads (implies --source fixture)",
    )
    parser.add_argument(
        "--ingest-host",
        type=str,
        default=None,
        help="Ingest bind host (default from config or 127.0.0.1)",
    )
    parser.add_argument(
        "--ingest-port",
        type=int,
        default=None,
        help="Ingest bind port (default from config or 8765)",
    )
    parser.add_argument(
        "--sync-window-ms",
        type=float,
        default=None,
        help="Camera/LiDAR pairing window in milliseconds (default 50)",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Stop after N fused frames (0 = run forever)",
    )
    args = parser.parse_args()

    config = load_config(args.config)
    source = args.source
    if source is None:
        source = "fixture" if args.fixture else config.get("source", "simulated")
    if args.fixture and source != "fixture":
        source = "fixture"
    config = apply_source_overrides(config, source)

    ingest_cfg = config.get("ingest", {})
    edge_cfg = config.get("edge", {})
    window_ms = args.sync_window_ms
    if window_ms is None:
        window_ms = float(ingest_cfg.get("sync_window_ms", 50))
    window_s = window_ms / 1000.0

    print("=" * 60)
    print("  Horizon Vision - Edge Perception Pipeline")
    print("=" * 60)
    print(f"  source={source}  sync_window={window_ms:.0f} ms")

    lidar = create_lidar_driver(config)
    camera = create_camera_driver(config)
    lidar.start()
    camera.start()

    # Fixture timestamps can span seconds; do not age-drop against the newest t.
    max_age_s = None if source == "fixture" else max(window_s * 5.0, 0.250)
    fusion = SensorFusion(window_s=window_s, max_age_s=max_age_s)
    hub = IngestHub(fusion)
    ai = EdgeAIEngine(
        device=edge_cfg.get("device", "cuda"),
        target_fps=float(edge_cfg.get("target_fps", 15)),
    )
    local_map = LocalMapBuilder(max_frames=15)
    sink = SyncedSampleSink()
    server = None

    if source == "web":
        host = args.ingest_host or ingest_cfg.get("host", "127.0.0.1")
        port = int(args.ingest_port or ingest_cfg.get("port", 8765))
        server = IngestServer(hub, host=host, port=port)
        server.start()
        print(f"\nWaiting for web-sim POSTs at {server.url}/ingest")
        print("Run `cd web && npm run dev` and open the viewer.\n")
    elif source == "fixture":
        fixture_path = args.fixture or ingest_cfg.get("fixture")
        if not fixture_path:
            raise SystemExit("--source fixture requires --fixture PATH")
        n = replay_fixture(hub, fixture_path)
        print(f"\nReplayed {n} fixture samples from {fixture_path}\n")
    else:
        print("\nPipeline running (simulated drivers). Press Ctrl+C to stop.\n")

    frame_idx = 0
    try:
        if source == "fixture":
            while True:
                fused = fusion.get_fused()
                if fused is None:
                    break
                frame_idx = process_fused(fused, ai, local_map, sink, frame_idx, hub)
                if args.max_frames > 0 and frame_idx >= args.max_frames:
                    break
            print(f"\nFixture done. {len(sink.ready)} synced frame(s).")
            return

        while True:
            if source == "simulated":
                pc = lidar.get_point_cloud()
                img = camera.get_frame()
                if pc is not None:
                    fusion.update_lidar(pc)
                if img is not None:
                    fusion.update_camera(img)

            fused = fusion.get_fused()
            if fused is None:
                time.sleep(0.01)
                continue

            frame_idx = process_fused(fused, ai, local_map, sink, frame_idx, hub)

            if args.max_frames > 0 and frame_idx >= args.max_frames:
                print("\nReached max frames. Stopping.")
                break

            time.sleep(0.05)

    except KeyboardInterrupt:
        print("\nShutting down...")

    finally:
        if server is not None:
            server.stop()
        lidar.stop()
        camera.stop()
        print(f"Horizon Vision stopped cleanly. synced_frames={len(sink.ready)}")


if __name__ == "__main__":
    main()
