"""Export the fine-tuned nano weights to ONNX for the Jetson Orin Nano.

    python edge/detector/export.py --weights edge/detector/runs/cam0/weights/best.pt

The onnx file is gitignored. On the Orin, build the FP16 engine with:

    /usr/src/tensorrt/bin/trtexec --onnx=best.onnx --saveEngine=best.fp16.engine --fp16

That engine is what the Orin Nano runs. This machine does not have TensorRT.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import yaml


def main() -> int:
    config = Path(__file__).resolve().parent / "config.yaml"
    with config.open(encoding="utf-8") as handle:
        cfg = yaml.safe_load(handle)
    parser = argparse.ArgumentParser(description="Export CAM0 YOLO weights to ONNX")
    parser.add_argument(
        "--weights",
        default=str(Path(__file__).resolve().parent / "runs" / "cam0" / "weights" / "best.pt"),
    )
    parser.add_argument("--imgsz", type=int, default=int(cfg["imgsz"]))
    parser.add_argument("--opset", type=int, default=12)
    args = parser.parse_args()
    weights = Path(args.weights)
    if not weights.is_file():
        raise SystemExit(f"missing weights: {weights}")
    from ultralytics import YOLO

    exported = YOLO(str(weights)).export(format="onnx", imgsz=args.imgsz, opset=args.opset, simplify=True)
    print(exported)
    print("TensorRT on the Orin Nano:")
    print(cfg["export"]["tensorrt"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
