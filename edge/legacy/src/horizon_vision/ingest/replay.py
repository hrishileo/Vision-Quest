"""Replay recorded web-sim samples through the same ingest parser."""

from __future__ import annotations

from pathlib import Path
from typing import Any, List
import json

from horizon_vision.ingest.server import IngestHub


def load_fixture(path: str | Path) -> List[Any]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "samples" in raw:
        raw = raw["samples"]
    if not isinstance(raw, list):
        raise ValueError("fixture must be a JSON array of ingest payloads")
    return raw


def replay_fixture(hub: IngestHub, path: str | Path) -> int:
    """Push every fixture sample into the hub. Returns accepted count."""
    samples = load_fixture(path)
    accepted = 0
    for item in samples:
        hub.accept(item)
        accepted += 1
    return accepted
