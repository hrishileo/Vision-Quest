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

import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).resolve().parent / "config.yaml"
sys.path.insert(0, str(ROOT / "edge" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from horizon_vision.events.associate import ByteTrack, DetBox  # noqa: E402
from horizon_vision.events.detect import (  # noqa: E402
    compare_lane_states,
    compare_tailgates,
    run_detector_pipeline,
)
from horizon_vision.events.labels import read_jsonl  # noqa: E402
from horizon_vision.events.lane_state import LaneMonitor, collect_lane_states  # noqa: E402
from horizon_vision.events.tailgate import TailgateDetector, detect_tailgates  # noqa: E402
from horizon_vision.events.tiles import count_matches  # noqa: E402
from horizon_vision.events.tracking import TrackBook  # noqa: E402
from yolo import YoloDetector  # noqa: E402


def _section(cfg: dict, name: str) -> dict:
    raw = cfg.get(name, {})
    return raw if isinstance(raw, dict) else {}


def yolo_truth(path: Path, width: int, height: int) -> list[DetBox]:
    names = {0: "vehicle", 1: "unknown"}
    boxes: list[DetBox] = []
    if not path.is_file():
        return boxes
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        cls_id, cx, cy, bw, bh = line.split()[:5]
        name = names.get(int(cls_id))
        if name is None:
            continue
        pw = float(bw) * width
        ph = float(bh) * height
        boxes.append(
            DetBox(
                cls=name,
                confidence=1.0,
                u=float(cx) * width - pw / 2,
                v=float(cy) * height - ph / 2,
                w=pw,
                h=ph,
            )
        )
    return boxes


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
    with CONFIG.open(encoding="utf-8") as handle:
        cfg = yaml.safe_load(handle)
    parser.add_argument("--imgsz", type=int, default=int(cfg["imgsz"]))
    parser.add_argument("--output", default=str(ROOT / "edge/detector/report.json"))
    parser.add_argument("--annotated", default=str(ROOT / "edge/detector/samples"))
    args = parser.parse_args()

    data = Path(args.data)
    weights = Path(args.weights)
    if not weights.is_file():
        raise SystemExit(f"missing weights: {weights}")
    detect_cfg = _section(cfg, "detect")
    track_cfg = _section(cfg, "tracker")
    tail_cfg = _section(cfg, "tailgate")
    lane_cfg = _section(cfg, "lane")
    book_cfg = _section(cfg, "track_book")
    def fresh_runtime():
        return (
            ByteTrack(
                iou_threshold=float(track_cfg.get("iou_threshold", 0.15)),
                high_conf=float(track_cfg.get("high_conf", 0.25)),
                unknown_high_conf=float(track_cfg.get("unknown_high_conf", 0.12)),
                max_misses=int(track_cfg.get("max_misses", 8)),
                small_area=float(track_cfg.get("small_area", 256)),
                match_px=float(track_cfg.get("match_px", 18)),
            ),
            TrackBook(max_misses=int(book_cfg.get("max_misses", 8))),
            LaneMonitor(
                debris_fuse=bool(lane_cfg.get("debris_fuse", True)),
                debris_hold_s=float(lane_cfg.get("debris_hold_s", 1.5)),
                blocked_hold_s=float(lane_cfg.get("blocked_hold_s", 1.5)),
                block_classes=tuple(lane_cfg.get("block_classes", ["unknown"])),
                vehicle_stall_hold_s=(
                    None
                    if lane_cfg.get("vehicle_stall_hold_s") is None
                    else float(lane_cfg["vehicle_stall_hold_s"])
                ),
            ),
            TailgateDetector(
                settle_s=float(tail_cfg.get("settle_s", 0.4)),
                speed_band_mps=float(tail_cfg.get("speed_band_mps", 2.5)),
                gap_s=float(tail_cfg.get("gap_s", 0.45)),
                min_speed_mps=float(tail_cfg.get("min_speed_mps", 1.0)),
                persist_s=float(tail_cfg.get("persist_s", 0.5)),
            ),
        )

    detector = YoloDetector(
        weights,
        conf=float(detect_cfg.get("conf", 0.08)),
        imgsz=args.imgsz,
        device="cpu",
        tile_w=int(detect_cfg.get("tile_w", 0)),
        tile_h=int(detect_cfg.get("tile_h", 0)),
        tile_overlap=float(detect_cfg.get("tile_overlap", 0.25)),
        nms_iou=float(detect_cfg.get("nms_iou", 0.5)),
    )
    annotated = Path(args.annotated)

    gt_tail = []
    det_tail = []
    gt_lanes = []
    det_lanes = []
    infer_ms: list[float] = []
    box_totals: dict[str, dict[str, int]] = {}
    saved = 0
    for seq_dir in sequences(data, args.split):
        frames = read_jsonl(seq_dir / "labels.jsonl")
        images = sorted((seq_dir / "images").glob("*.png"))
        if len(images) != len(frames):
            raise SystemExit(f"{seq_dir.name}: {len(images)} images and {len(frames)} label frames")
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
        for image, preds in zip(images, batches):
            with Image.open(image) as handle:
                width, height = handle.size
            truth = yolo_truth(seq_dir / "labels" / f"{image.stem}.txt", width, height)
            for cls, row in count_matches(preds, truth).items():
                bucket = box_totals.setdefault(cls, {"matched": 0, "predicted": 0, "truth": 0})
                for key, value in row.items():
                    bucket[key] += value
        box_tracker, book, lane_monitor, tailgate = fresh_runtime()
        detected = run_detector_pipeline(
            frames,
            [None] * len(frames),
            _Replay(batches),
            box_tracker=box_tracker,
            book=book,
            lane_monitor=lane_monitor,
            tailgate=tailgate,
        )
        det_tail.extend(detected.tailgates)
        det_lanes.extend(detected.lane_states)
        if frames:
            for mid in (max(0, len(frames) // 3), len(frames) // 2):
                if saved >= 4:
                    break
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

    def _rel(path: Path) -> str:
        resolved = path.resolve()
        try:
            return str(resolved.relative_to(ROOT))
        except ValueError:
            return str(resolved)

    def _rate(row: dict[str, int]) -> dict[str, float | int]:
        matched = row["matched"]
        predicted = row["predicted"]
        truth = row["truth"]
        return {
            "matched": matched,
            "predicted": predicted,
            "truth": truth,
            "precision": (matched / predicted) if predicted else (1.0 if truth == 0 else 0.0),
            "recall": (matched / truth) if truth else (1.0 if predicted == 0 else 0.0),
        }

    report = {
        "weights": _rel(weights),
        "split": args.split,
        "frames": len(infer_ms),
        "inference_ms_cpu": mean_ms,
        "metrics": metrics,
        "boxes_iou50": {cls: _rate(row) for cls, row in sorted(box_totals.items())},
        "tailgate": compare_tailgates(gt_tail, det_tail),
        "lane_state": compare_lane_states(gt_lanes, det_lanes),
        "annotated": _rel(annotated),
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("inference_ms_cpu", "boxes_iou50", "tailgate", "lane_state")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
