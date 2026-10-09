"""Debris crops keep the unknown box and drop boxes that fall outside."""

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "detector"))

from balance import write_crops  # noqa: E402


def test_crops_center_the_unknown_box(tmp_path: Path):
    images = tmp_path / "images" / "train"
    labels = tmp_path / "labels" / "train"
    images.mkdir(parents=True)
    labels.mkdir(parents=True)
    Image.new("RGB", (960, 540), (20, 20, 20)).save(images / "frame.png")
    # One vehicle at the left edge, one unknown near the right.
    (labels / "frame.txt").write_text(
        "0 0.050000 0.500000 0.040000 0.040000\n1 0.800000 0.400000 0.020000 0.030000\n",
        encoding="utf-8",
    )
    assert write_crops(tmp_path, side=384, per_image=2) == 1
    crop_label = (labels / "crop_frame_0.txt").read_text(encoding="utf-8")
    assert crop_label.startswith("1 ")
    assert "\n0 " not in "\n" + crop_label
    with Image.open(images / "crop_frame_0.png") as crop:
        assert crop.size == (384, 384)
