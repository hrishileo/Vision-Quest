"""YoloDetector against a fake model: per-class cutoffs and tile seams.

The fake stands in for ultralytics. The frame encodes each pixel's own (x, y),
so the fake knows which crop it was handed and "sees" the scene objects
clipped to that crop, the way a real detector boxes the visible part.
"""

import sys
import types
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "detector"))

NAMES = {0: "vehicle", 1: "person", 2: "bicycle", 3: "motor"}


class _Tensor(list):
    def tolist(self):
        return list(self)


class _Box:
    def __init__(self, xyxy, cls_id, conf):
        self.xyxy = [_Tensor(xyxy)]
        self.cls = [cls_id]
        self.conf = [conf]


class _Result:
    def __init__(self, boxes):
        self.boxes = boxes


class _FakeYOLO:
    # (class id, score, frame xyxy[, "tile only"])
    scene: list[tuple] = []

    def __init__(self, weights):
        self.names = NAMES
        self.calls: list[float] = []

    def predict(self, source, conf, imgsz, device, verbose):
        self.calls.append(conf)
        # The adapter flips RGB to BGR, so x is in channel 2 and y in channel 1.
        ox, oy = int(source[0, 0, 2]), int(source[0, 0, 1])
        h, w = source.shape[:2]
        boxes = []
        full = (w, h) == (1360, 765)
        for cls_id, score, (x1, y1, x2, y2), *small in self.scene:
            if small and full:
                continue  # too small for the downscaled full frame
            cx1, cy1 = max(x1, ox), max(y1, oy)
            cx2, cy2 = min(x2, ox + w), min(y2, oy + h)
            if cx2 - cx1 < 4 or cy2 - cy1 < 4 or score < conf:
                continue
            boxes.append(_Box([cx1 - ox, cy1 - oy, cx2 - ox, cy2 - oy], cls_id, score))
        return [_Result(boxes)]


@pytest.fixture
def detector_cls(monkeypatch):
    fake = types.ModuleType("ultralytics")
    fake.YOLO = _FakeYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", fake)
    from yolo import YoloDetector

    return YoloDetector


def _frame(width=1360, height=765):
    ys, xs = np.mgrid[0:height, 0:width]
    return np.stack([xs, ys, np.zeros_like(xs)], axis=-1).astype(np.int32)


def _detect(cls, scene, **kwargs):
    _FakeYOLO.scene = scene
    det = cls("fake.pt", **kwargs)
    return det, det.detect(_frame())


def test_bike_cutoff_keeps_a_weak_bike_but_not_a_weak_car(detector_cls):
    scene = [
        (2, 0.12, (100, 100, 120, 130)),  # bicycle above its 0.10 cutoff
        (2, 0.07, (200, 100, 220, 130)),  # bicycle below it
        (0, 0.12, (300, 100, 360, 140)),  # vehicle below the global 0.25
        (0, 0.60, (400, 100, 460, 140)),
    ]
    det, boxes = _detect(detector_cls, scene, conf=0.25, class_conf={"bicycle": 0.10})
    assert det.model.calls == [0.10]
    got = sorted((b.cls, b.confidence) for b in boxes)
    assert got == [("bicycle", 0.12), ("vehicle", 0.60)]


def test_without_class_conf_the_global_cutoff_applies_to_all(detector_cls):
    scene = [(2, 0.12, (100, 100, 120, 130)), (0, 0.60, (400, 100, 460, 140))]
    det, boxes = _detect(detector_cls, scene, conf=0.25)
    assert det.model.calls == [0.25]
    assert [b.cls for b in boxes] == ["vehicle"]


def test_a_class_cutoff_can_also_raise_the_bar(detector_cls):
    scene = [(1, 0.30, (100, 100, 110, 125)), (0, 0.30, (400, 100, 460, 140))]
    det, boxes = _detect(detector_cls, scene, conf=0.25, class_conf={"person": 0.5})
    assert det.model.calls == [0.25]
    assert [b.cls for b in boxes] == ["vehicle"]


def test_misspelled_class_cutoff_is_an_error(detector_cls):
    _FakeYOLO.scene = []
    with pytest.raises(ValueError, match="bike"):
        detector_cls("fake.pt", class_conf={"bike": 0.1})


def test_truck_cut_by_a_seam_leaves_no_fragment(detector_cls):
    # 640 tiles with 0.25 overlap on 1360 wide start at x = 0, 480, 720.
    # The first tile sees only x 600..640 of this truck. That sliver's IoU
    # with the whole truck is 0.13, so NMS alone would keep it as a second car.
    truck = (0, 0.9, (600.0, 300.0, 900.0, 420.0))
    _det, boxes = _detect(detector_cls, [truck], tile_w=640, tile_h=640)
    assert [(b.u, b.v, b.u + b.w, b.v + b.h) for b in boxes] == [(600.0, 300.0, 900.0, 420.0)]


def test_small_car_on_a_seam_is_kept_from_the_tile_that_holds_it(detector_cls):
    # x 634..664 crosses the first tile's right cut at 640; the tile at 480
    # holds it whole. Too small for the full frame, so tiles are the only
    # source. It must come through once, unclipped.
    car = (0, 0.9, (634.0, 200.0, 664.0, 215.0), "tile only")
    _det, boxes = _detect(detector_cls, [car], tile_w=640, tile_h=640)
    assert [(b.u, b.u + b.w) for b in boxes] == [(634.0, 664.0)]


def test_car_on_the_frame_border_is_kept_in_tiles(detector_cls):
    # Touching the real image edge is not a cut. The car is too small for the
    # full frame, so the corner tile's box is the only one that can find it.
    car = (0, 0.9, (0.0, 0.0, 30.0, 20.0), "tile only")
    _det, boxes = _detect(detector_cls, [car], tile_w=640, tile_h=640)
    assert [(b.u, b.v, b.w, b.h) for b in boxes] == [(0.0, 0.0, 30.0, 20.0)]
