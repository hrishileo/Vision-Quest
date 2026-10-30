"""Overlapping crops and class-wise box matching."""

from horizon_vision.events.associate import DetBox
from horizon_vision.events.tiles import count_matches, drop_seam_boxes, nms, shift_boxes, tile_windows


def test_tiles_cover_the_far_edge():
    windows = tile_windows(960, 540, 480, 320, 0.25)
    assert windows[0] == (0, 0, 480, 320)
    assert any(x + w == 960 for x, _y, w, _h in windows)
    assert any(y + h == 540 for _x, y, _w, h in windows)
    assert len(windows) > 1


def test_full_frame_is_one_window():
    assert tile_windows(960, 540, 0, 0, 0.25) == [(0, 0, 960, 540)]


def test_shift_and_nms_keep_the_stronger_duplicate():
    weak = DetBox("unknown", 0.2, 10, 10, 20, 12)
    strong = DetBox("unknown", 0.8, 12, 11, 20, 12)
    vehicle = DetBox("vehicle", 0.4, 10, 10, 20, 12)
    shifted = shift_boxes([weak], 100, 50)
    assert shifted[0].u == 110
    assert shifted[0].v == 60
    kept = nms([weak, strong, vehicle], 0.5)
    unknown = [box for box in kept if box.cls == "unknown"]
    assert len(unknown) == 1
    assert unknown[0].confidence == 0.8
    assert any(box.cls == "vehicle" for box in kept)


def test_count_matches_is_per_class_and_one_to_one():
    truth = [
        DetBox("unknown", 1, 0, 0, 20, 10),
        DetBox("unknown", 1, 100, 0, 20, 10),
        DetBox("vehicle", 1, 0, 40, 30, 20),
    ]
    predicted = [
        DetBox("unknown", 0.9, 1, 1, 20, 10),
        DetBox("unknown", 0.4, 2, 1, 18, 10),
        DetBox("vehicle", 0.7, 200, 200, 10, 10),
    ]
    rows = count_matches(predicted, truth, 0.5)
    assert rows["unknown"] == {"matched": 1, "predicted": 2, "truth": 2}
    assert rows["vehicle"] == {"matched": 0, "predicted": 1, "truth": 1}


def test_seam_boxes_drop_on_interior_cuts_only():
    # Middle tile of a 1360x765 frame: cut on the left and right, not on top
    # or bottom (it spans the full height here).
    window = (480, 0, 640, 765)
    left_cut = DetBox("vehicle", 0.9, 0.0, 100, 40, 30)
    right_cut = DetBox("vehicle", 0.9, 600.0, 100, 40, 30)
    top_border = DetBox("vehicle", 0.9, 200.0, 0.0, 40, 30)
    bottom_border = DetBox("vehicle", 0.9, 200.0, 735.0, 40, 30)
    inside = DetBox("vehicle", 0.9, 300.0, 300.0, 40, 30)
    kept = drop_seam_boxes(
        [left_cut, right_cut, top_border, bottom_border, inside], window, 1360, 765, 2.0
    )
    assert kept == [top_border, bottom_border, inside]


def test_whole_frame_window_has_no_seams():
    box = DetBox("vehicle", 0.9, 0.0, 0.0, 1360, 765)
    assert drop_seam_boxes([box], (0, 0, 1360, 765), 1360, 765) == [box]
