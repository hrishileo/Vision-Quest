"""Add debris-centered crops to the train split.

The full frame is 960 px wide and a cone is often ~10 px. A crop around that
box, saved as its own training image, makes the same object large relative
to the network input. Crops are written next to the other train images and
are gitignored with ``data/yolo/``. Re-running replaces previous crops.

    python edge/detector/balance.py --data data/yolo
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def _boxes(label: Path, width: int, height: int) -> list[tuple[int, float, float, float, float]]:
    rows = []
    if not label.is_file():
        return rows
    for line in label.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        cls_id, cx, cy, bw, bh = line.split()[:5]
        pw = float(bw) * width
        ph = float(bh) * height
        rows.append(
            (
                int(cls_id),
                float(cx) * width - pw / 2,
                float(cy) * height - ph / 2,
                pw,
                ph,
            )
        )
    return rows


def _crop_box(u: float, v: float, bw: float, bh: float, width: int, height: int, side: int) -> tuple[int, int, int, int]:
    cx = u + bw / 2
    cy = v + bh / 2
    x0 = int(round(cx - side / 2))
    y0 = int(round(cy - side / 2))
    x0 = max(0, min(x0, width - side))
    y0 = max(0, min(y0, height - side))
    return x0, y0, side, side


def _inside(box: tuple[int, float, float, float, float], window: tuple[int, int, int, int]) -> tuple[int, float, float, float, float] | None:
    cls_id, u, v, bw, bh = box
    x0, y0, side, _side = window
    x1 = max(u, x0)
    y1 = max(v, y0)
    x2 = min(u + bw, x0 + side)
    y2 = min(v + bh, y0 + side)
    iw = x2 - x1
    ih = y2 - y1
    if iw <= 1 or ih <= 1:
        return None
    if iw * ih < 0.4 * bw * bh:
        return None
    return cls_id, x1 - x0, y1 - y0, iw, ih


def _yolo_line(box: tuple[int, float, float, float, float], side: int) -> str:
    cls_id, u, v, bw, bh = box
    cx = (u + bw / 2) / side
    cy = (v + bh / 2) / side
    return f"{cls_id} {cx:.6f} {cy:.6f} {bw / side:.6f} {bh / side:.6f}"


def write_crops(data: Path, side: int = 384, per_image: int = 2) -> int:
    images = data / "images" / "train"
    labels = data / "labels" / "train"
    if not images.is_dir():
        raise SystemExit(f"missing {images}")
    for stale in images.glob("crop_*.png"):
        stale.unlink()
    for stale in labels.glob("crop_*.txt"):
        stale.unlink()
    written = 0
    sources = sorted(path for path in images.glob("*.png") if not path.name.startswith("crop_"))
    for image_path in sources:
        with Image.open(image_path) as image:
            frame = image.convert("RGB")
            width, height = frame.size
            if width < side or height < side:
                continue
            boxes = _boxes(labels / f"{image_path.stem}.txt", width, height)
            unknown = [box for box in boxes if box[0] == 1 and box[3] >= 4 and box[4] >= 3]
            unknown.sort(key=lambda box: box[3] * box[4], reverse=True)
            # Largest debris, then the smallest still-visible one. The small
            # crop is the case the full frame was missing.
            chosen = []
            if unknown:
                chosen.append(unknown[0])
            if len(unknown) > 1 and per_image > 1:
                chosen.append(unknown[-1])
            for index, target in enumerate(chosen[:per_image]):
                window = _crop_box(target[1], target[2], target[3], target[4], width, height, side)
                kept = [item for item in (_inside(box, window) for box in boxes) if item is not None]
                if not any(item[0] == 1 for item in kept):
                    continue
                crop = frame.crop((window[0], window[1], window[0] + side, window[1] + side))
                stem = f"crop_{image_path.stem}_{index}"
                crop.save(images / f"{stem}.png")
                (labels / f"{stem}.txt").write_text(
                    "\n".join(_yolo_line(item, side) for item in kept) + "\n",
                    encoding="utf-8",
                )
                written += 1
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description="Oversample debris with centered crops")
    parser.add_argument("--data", default="data/yolo")
    parser.add_argument("--side", type=int, default=384)
    parser.add_argument("--per-image", type=int, default=2)
    args = parser.parse_args()
    count = write_crops(Path(args.data), side=args.side, per_image=args.per_image)
    print(f"wrote {count} debris crops")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
