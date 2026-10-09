"""Fine-tune YOLOv8n (or YOLO11n) on the CAM0 corpus.

    python edge/detector/train.py --data data/yolo/data.yaml

Weights go to edge/detector/runs/ and are gitignored. Metrics are written to
edge/detector/metrics.json. Export for the Orin is a separate step; see
edge/detector/export.py and the tensorrt line in edge/detector/config.yaml.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).resolve().parent / "config.yaml"


def load_config() -> dict:
    with CONFIG.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"{CONFIG} must be a mapping")
    return data


def class_rows(metrics) -> list[dict]:
    names = getattr(metrics, "names", {}) or {}
    box = metrics.box
    rows = []
    ap50 = list(getattr(box, "ap50", []) or [])
    ap = list(getattr(box, "ap", []) or [])
    precision = list(getattr(box, "p", []) or [])
    recall = list(getattr(box, "r", []) or [])
    for index, ap50_i in enumerate(ap50):
        name = names.get(index, str(index))
        rows.append(
            {
                "class": name,
                "id": index,
                "map50": float(ap50_i),
                "map50_95": float(ap[index]) if index < len(ap) else None,
                "precision": float(precision[index]) if index < len(precision) else None,
                "recall": float(recall[index]) if index < len(recall) else None,
            }
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Fine-tune a nano YOLO on the CAM0 corpus")
    parser.add_argument("--data", default=str(ROOT / "data/yolo/data.yaml"))
    parser.add_argument("--model", default=None, help="Override config model, e.g. yolo11n.pt")
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--imgsz", type=int, default=None)
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--device", default=None)
    parser.add_argument("--name", default="cam0")
    args = parser.parse_args()

    cfg = load_config()
    model_name = args.model or cfg["model"]
    epochs = args.epochs if args.epochs is not None else int(cfg["epochs"])
    imgsz = args.imgsz if args.imgsz is not None else int(cfg["imgsz"])
    batch = args.batch if args.batch is not None else int(cfg["batch"])
    device = args.device or str(cfg["device"])
    workers = int(cfg.get("workers", 2))

    from ultralytics import YOLO

    model = YOLO(model_name)
    project = Path(__file__).resolve().parent / "runs"
    model.train(
        data=args.data,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        workers=workers,
        project=str(project),
        name=args.name,
        exist_ok=True,
        pretrained=True,
        patience=10,
        plots=False,
        verbose=True,
    )
    best = project / args.name / "weights" / "best.pt"
    trained = YOLO(str(best))
    metrics = trained.val(
        data=args.data,
        split="test",
        imgsz=imgsz,
        batch=batch,
        device=device,
        workers=workers,
        plots=False,
        verbose=False,
    )
    rows = class_rows(metrics)
    debris = next((row for row in rows if row["class"] == "unknown"), None)
    payload = {
        "model": model_name,
        "weights": str(best.relative_to(ROOT)),
        "imgsz": imgsz,
        "epochs": epochs,
        "device": device,
        "split": "test",
        "map50": float(metrics.box.map50),
        "map50_95": float(metrics.box.map),
        "per_class": rows,
        "debris_precision": None if debris is None else debris["precision"],
        "debris_recall": None if debris is None else debris["recall"],
        "results": {key: float(value) for key, value in dict(getattr(metrics, "results_dict", {})).items()},
    }
    out = Path(__file__).resolve().parent / "metrics.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
