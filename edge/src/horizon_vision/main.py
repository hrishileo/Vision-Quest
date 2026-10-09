"""
Horizon Vision - Main entry point for the edge computer.

This script runs on the Jetson (or development machine) and:
1. Starts LiDAR + Camera drivers
2. Fuses the data
3. Runs the Edge AI engine
4. Builds a local map
5. Prints / logs perception results (ready to stream later)
"""

from __future__ import annotations

import argparse
import time
import sys
from pathlib import Path

import yaml

# This file is edge/src/horizon_vision/main.py. The edge root holds config/.
EDGE_ROOT = Path(__file__).resolve().parents[2]
_SRC = str(EDGE_ROOT / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from horizon_vision.sensors import create_lidar_driver, create_camera_driver
from horizon_vision.perception import SensorFusion, EdgeAIEngine
from horizon_vision.mapping import LocalMapBuilder


def load_config(path: str) -> dict:
    with open(path, "r") as f:
        return yaml.safe_load(f)


def main():
    parser = argparse.ArgumentParser(description="Horizon Vision Edge Pipeline")
    parser.add_argument(
        "--config",
        type=str,
        default=str(EDGE_ROOT / "config" / "sensors.yaml"),
        help="Path to sensors.yaml",
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Stop after N frames (0 = run forever)",
    )
    args = parser.parse_args()

    config = load_config(args.config)
    edge_cfg = config.get("edge", {})

    print("=" * 60)
    print("  Horizon Vision - Edge Perception Pipeline")
    print("=" * 60)

    # --- Sensors ---
    lidar = create_lidar_driver(config)
    camera = create_camera_driver(config)

    lidar.start()
    camera.start()

    # --- Pipeline ---
    fusion = SensorFusion()
    ai = EdgeAIEngine(
        device=edge_cfg.get("device", "cuda"),
        target_fps=float(edge_cfg.get("target_fps", 15)),
    )
    local_map = LocalMapBuilder(max_frames=15)

    print("\nPipeline running. Press Ctrl+C to stop.\n")

    frame_idx = 0
    try:
        while True:
            # 1. Grab sensor data
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

            # 2. Run Edge AI
            perception = ai.process(fused)

            # 3. Update local map
            local_map.update(fused.point_cloud, perception)

            # 4. Log results (later this becomes the stream to phone/car)
            frame_idx += 1
            print(
                f"[{frame_idx:04d}] "
                f"points={perception.num_lidar_points:5d} | "
                f"detections={len(perception.detections):2d} | "
                f"AI={perception.processing_time_ms:5.1f} ms"
            )

            if perception.detections:
                for d in perception.detections:
                    print(
                        f"         → {d.label} conf={d.confidence:.2f} "
                        f"at [{d.center[0]:.1f}, {d.center[1]:.1f}, {d.center[2]:.1f}]"
                    )

            if args.max_frames > 0 and frame_idx >= args.max_frames:
                print("\nReached max frames. Stopping.")
                break

            # Simple rate control
            time.sleep(0.05)

    except KeyboardInterrupt:
        print("\nShutting down...")

    finally:
        lidar.stop()
        camera.stop()
        print("Horizon Vision stopped cleanly.")


if __name__ == "__main__":
    main()
