"""Run the Mag Mile debris scenario and write alerts plus a short summary.

    PYTHONPATH=edge/src:hub/src python -m horizon_vision.hub \\
        --output /tmp/debris_alerts.jsonl \\
        --summary /tmp/debris_summary.txt
"""

from __future__ import annotations

import argparse
from pathlib import Path

from horizon_vision.hub.reroute import JsonlPhoneSink
from horizon_vision.hub.scenario import run_debris_scenario


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hub detour: Mag Mile debris scenario")
    parser.add_argument("--output", type=Path, required=True, help="Alerts JSONL path")
    parser.add_argument("--summary", type=Path, required=True, help="Short text summary path")
    args = parser.parse_args(argv)

    result = run_debris_scenario()
    JsonlPhoneSink(args.output).write_all(result.alerts)
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(result.summary, encoding="utf-8")
    print(result.summary, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
