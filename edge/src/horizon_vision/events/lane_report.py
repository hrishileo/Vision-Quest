"""Write lane-state events for a label file.

Usage:
    PYTHONPATH=edge/src:hub/src python -m horizon_vision.events.lane_report \\
        --fixture src/lib/guide/__fixtures__/cam0-sample.labels.jsonl \\
        --out edge/tests/fixtures/cam0_lane_states.jsonl
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from horizon_vision.events.labels import read_jsonl
from horizon_vision.events.lane_state import (
    LaneMonitor,
    LaneStateEvent,
    collect_lane_states,
    lane_states_jsonl,
)


def summarize_lane_states(frame_count: int, events: list[LaneStateEvent]) -> str:
    counts = Counter(event.state for event in events)
    latest: dict[str, str] = {}
    for event in events:
        latest[event.lane] = event.state
    lines = [
        "HorizonVision lane state",
        f"frames={frame_count} events={len(events)}",
        "counts " + " ".join(
            f"{name}={counts.get(name, 0)}" for name in ("blocked", "slow", "clear", "unknown")
        ),
        "latest " + " ".join(f"{lane}={state}" for lane, state in sorted(latest.items())),
    ]
    return "\n".join(lines) + "\n"


def build_lane_report(
    fixture: str | Path,
    monitor: LaneMonitor | None = None,
) -> str:
    frames = read_jsonl(fixture)
    events = collect_lane_states(frames, monitor=monitor)
    return summarize_lane_states(len(frames), events)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit lane-state events from a label file")
    parser.add_argument("--fixture", required=True, help="JSONL label file")
    parser.add_argument("--out", help="Write lane-state JSONL here")
    parser.add_argument("--hold", type=float, default=1.5)
    parser.add_argument("--stationary", type=float, default=0.5, help="m/s at or below which a track is still")
    parser.add_argument("--slow", type=float, default=4.0, help="m/s below which a lane is slow")
    parser.add_argument("--stale", type=float, default=1.0)
    parser.add_argument("--min-confidence", type=float, default=0.2)
    args = parser.parse_args(argv)
    monitor = LaneMonitor(
        hold_s=args.hold,
        stationary_mps=args.stationary,
        slow_mps=args.slow,
        stale_s=args.stale,
        min_confidence=args.min_confidence,
    )
    frames = read_jsonl(args.fixture)
    events = collect_lane_states(frames, monitor=monitor)
    if args.out:
        Path(args.out).write_text(lane_states_jsonl(events), encoding="utf-8")
    print(summarize_lane_states(len(frames), events))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
