"""Score detector tracks against the recorder on tailgating and lane state.

    PYTHONPATH=edge/src python edge/detector/compare.py \\
        --data data/yolo --weights edge/detector/runs/cam0/weights/best.pt

Camera pose comes from the label file. Boxes come from the checkpoint.
The label pipeline is the ground-truth run. Both then use the same
tailgate and lane-state code.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "edge" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from horizon_vision.events.detect import (  # noqa: E402
    compare_lane_states,
    compare_tailgates,
    run_detector_pipeline,
)
from horizon_vision.events.labels import read_jsonl  # noqa: E402
from horizon_vision.events.lane_state import collect_lane_states  # noqa: E402
from horizon_vision.events.tailgate import detect_tailgates  # noqa: E402
from yolo import YoloDetector  # noqa: E402


def sequences(data: Path, split_name: str) -> list[Path]:
    split = json.loads((data / "split.json").read_text(encoding="utf-8"))
    return [data / "sequences" / seq_id for seq_id in split[split_name]]


def draw(path: Path, gt_frame, tracked, out: Path) -> None:
    from PIL import Image, ImageDraw

    image = Image.open(path).convert("RGB")
    pen = ImageDraw.Draw(image)
    for obj in gt_frame.objects:
        box = obj.bbox
        pen.rectangle((box.u, box.v, box.u + box.w, box.v + box.h), outline=(80, 200, 120), width=2)
        pen.text((box.u, max(0, box.v - 12)), f"gt {obj.cls}", fill=(80, 200, 120))
    for box in tracked:
        b = box.bbox
        pen.rectangle((b.u, b.v, b.u + b.w, b.v + b.h), outline=(230, 140, 40), width=2)
        pen.text((b.u, b.v + b.h + 1), f"{box.cls} {box.confidence:.2f}", fill=(230, 140, 40))
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)


class _Replay:
    def __init__(self, rows: list) -> None:
        self._rows = rows
        self._i = 0

    def detect(self, image: object):
        row = self._rows[self._i]
        self._i += 1
        return row


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare detector events with label events")
    parser.add_argument("--data", default=str(ROOT / "data/yolo"))
    parser.add_argument("--weights", default=str(ROOT / "edge/detector/runs/cam0/weights/best.pt"))
    parser.add_argument("--split", default="test")
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--output", default=str(ROOT / "edge/detector/report.json"))
    parser.add_argument("--annotated", default=str(ROOT / "edge/detector/samples"))
    args = parser.parse_args()

    data = Path(args.data)
    weights = Path(args.weights)
    if not weights.is_file():
        raise SystemExit(f"missing weights: {weights}")
    detector = YoloDetector(weights, conf=0.25, imgsz=args.imgsz, device="cpu")
    annotated = Path(args.annotated)

    gt_tail = []
    det_tail = []
    gt_lanes = []
    det_lanes = []
    infer_ms: list[float] = []
    saved = 0
    for seq_dir in sequences(data, args.split):
        frames = read_jsonl(seq_dir / "labels.jsonl")
        images = [seq_dir / "images" / frame.file.split("/")[-1] for frame in frames]
        missing = [path for path in images if not path.is_file()]
        if missing:
            raise SystemExit(f"missing image {missing[0]}")
        gt_tail.extend(detect_tailgates(frames))
        gt_lanes.extend(collect_lane_states(frames))
        if images:
            detector.detect(str(images[0]))
        batches = []
        for image in images:
            t0 = time.perf_counter()
            batches.append(detector.detect(str(image)))
            infer_ms.append((time.perf_counter() - t0) * 1000.0)
        detected = run_detector_pipeline(frames, [None] * len(frames), _Replay(batches))
        det_tail.extend(detected.tailgates)
        det_lanes.extend(detected.lane_states)
        if saved < 4 and frames:
            mid = len(frames) // 2
            draw(
                images[mid],
                frames[mid],
                detected.per_frame[mid],
                annotated / f"{seq_dir.name}_{mid:06d}.png",
            )
            saved += 1
        print(f"{seq_dir.name}: detections replayed on {len(frames)} frames")

    metrics_path = Path(__file__).resolve().parent / "metrics.json"
    metrics = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.is_file() else None
    mean_ms = sum(infer_ms) / len(infer_ms) if infer_ms else 0.0
    report = {
        "weights": str(weights),
        "split": args.split,
        "frames": len(infer_ms),
        "inference_ms_cpu": mean_ms,
        "metrics": metrics,
        "tailgate": compare_tailgates(gt_tail, det_tail),
        "lane_state": compare_lane_states(gt_lanes, det_lanes),
        "annotated": str(annotated),
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("inference_ms_cpu", "tailgate", "lane_state")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
