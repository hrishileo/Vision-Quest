"""Run the detector on plain photos. No camera pose, no tracking, no events.

    python edge/detector/predict_images.py --weights yolov8n.pt --out out/ img1.jpg dir/

Writes ``<name>.jpg`` with boxes drawn and ``<name>.json`` with the boxes,
plus ``summary.json`` with counts per class per image.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from yolo import YoloDetector  # noqa: E402

COLORS = {"vehicle": "#ff3b30", "person": "#0a84ff", "bicycle": "#30d158", "motor": "#ffd60a", "unknown": "#bf5af2"}
SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def collect(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            out.extend(sorted(f for f in p.iterdir() if f.suffix.lower() in SUFFIXES))
        else:
            out.append(p)
    return out


def draw(image: Image.Image, boxes) -> Image.Image:
    img = image.convert("RGB")
    pen = ImageDraw.Draw(img)
    width = max(2, img.width // 400)
    for b in boxes:
        color = COLORS.get(b.cls, "white")
        pen.rectangle([b.u, b.v, b.u + b.w, b.v + b.h], outline=color, width=width)
        pen.text((b.u + 2, max(0, b.v - 12)), f"{b.cls} {b.confidence:.2f}", fill=color)
    return img


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("images", nargs="+")
    ap.add_argument("--weights", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--tile", type=int, default=0, help="tile size in px; 0 = whole frame only")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args(argv)

    det = YoloDetector(args.weights, conf=args.conf, imgsz=args.imgsz, device=args.device,
                       tile_w=args.tile, tile_h=args.tile)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = {}
    for path in collect(args.images):
        image = Image.open(path)
        boxes = det.detect(path)
        draw(image, boxes).save(out / f"{path.stem}.jpg", quality=90)
        rows = [{"class": b.cls, "confidence": round(b.confidence, 4),
                 "u": b.u, "v": b.v, "w": b.w, "h": b.h} for b in boxes]
        (out / f"{path.stem}.json").write_text(json.dumps(rows, indent=1) + "\n")
        summary[path.name] = dict(Counter(b.cls for b in boxes))
        print(path.name, summary[path.name])
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
