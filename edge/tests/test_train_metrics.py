"""class_rows must accept the numpy arrays Ultralytics returns."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "detector"))

from train import class_rows  # noqa: E402


class _Box:
    ap_class_index = np.array([1, 0])
    p = np.array([1.0, 0.76])
    r = np.array([0.0, 0.58])

    @property
    def ap50(self):
        return np.array([0.01, 0.62])

    @property
    def ap(self):
        return np.array([0.001, 0.34])


class _Metrics:
    names = {0: "vehicle", 1: "unknown"}
    box = _Box()


def test_class_rows_reads_numpy_metrics():
    rows = class_rows(_Metrics())
    assert [row["class"] for row in rows] == ["unknown", "vehicle"]
    assert rows[0]["id"] == 1
    assert rows[0]["map50"] == 0.01
    assert rows[0]["recall"] == 0.0
    assert rows[1]["map50_95"] == 0.34
    assert rows[1]["precision"] == 0.76
