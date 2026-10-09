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


def _scalar_results(results) -> dict:
    out = {}
    for key, value in dict(results or {}).items():
        try:
            out[str(key)] = float(value)
        except (TypeError, ValueError):
            continue
    return out


def load_config() -> dict:
    with CONFIG.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"{CONFIG} must be a mapping")
    return data


def _as_list(value) -> list:
    """Ultralytics returns per-class arrays. Do not truth-test them."""
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    return list(value)


def class_rows(metrics) -> list[dict]:
    names = getattr(metrics, "names", {}) or {}
    box = metrics.box
    # Rows follow ap_class_index, which is not necessarily 0..nc-1.
    class_ids = _as_list(getattr(box, "ap_class_index", []))
    ap50 = _as_list(getattr(box, "ap50", []))
    ap = _as_list(getattr(box, "ap", []))
    precision = _as_list(getattr(box, "p", []))
    recall = _as_list(getattr(box, "r", []))
    rows = []
    for index in range(max(len(class_ids), len(ap50))):
        class_id = int(class_ids[index]) if index < len(class_ids) else index
        name = names.get(class_id, names.get(str(class_id), str(class_id)))
        rows.append(
            {
                "class": name,
                "id": class_id,
                "map50": float(ap50[index]) if index < len(ap50) else None,
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
    seed = int(cfg.get("seed", 0))

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
        patience=20,
        seed=seed,
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
        "results": _scalar_results(getattr(metrics, "results_dict", {})),
    }
    out = Path(__file__).resolve().parent / "metrics.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
