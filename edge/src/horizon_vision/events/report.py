"""Print monocular position and speed error against a label fixture.

Usage:
    PYTHONPATH=edge/src:hub/src python -m horizon_vision.events.report \\
        --fixture edge/tests/fixtures/mag_mile_labels.jsonl
"""

from __future__ import annotations

import argparse
from pathlib import Path

from horizon_vision.events.accuracy import accuracy_report, accuracy_table
from horizon_vision.events.labels import read_jsonl
from horizon_vision.events.pipeline import run_label_pipeline
from horizon_vision.events.tracking import TrackBook


def build_report(fixture: str | Path, min_hits: int, max_misses: int, alpha: float) -> str:
    frames = read_jsonl(fixture)
    result = run_label_pipeline(
        frames,
        TrackBook(min_hits=min_hits, max_misses=max_misses, alpha=alpha),
    )
    report = accuracy_report(result)
    return report.text() + "\n\n" + accuracy_table(result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Score monocular estimates against label truth")
    parser.add_argument("--fixture", required=True, help="JSONL label file")
    parser.add_argument("--min-hits", type=int, default=3)
    parser.add_argument("--max-misses", type=int, default=5)
    parser.add_argument("--alpha", type=float, default=0.5)
    args = parser.parse_args(argv)
    print(build_report(args.fixture, args.min_hits, args.max_misses, args.alpha))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
