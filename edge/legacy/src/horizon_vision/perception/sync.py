"""
Exclusive nearest-timestamp pairing for sensor streams.

Camera + LiDAR (and optional detections) are matched only when their
timestamps fall inside a real window. Unpaired samples are dropped.
This is not "latest of each."
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, List, Optional, Sequence, Tuple
import threading


@dataclass(frozen=True)
class TimedSample:
    """One timestamped item on a named stream."""

    timestamp: float
    payload: Any


class TimeSynchronizer:
    """
    Pair samples across named streams by exclusive nearest timestamp.

    Required streams must all be present in a match. Optional streams
    attach when a sample falls inside the same window; otherwise they
    are omitted (and later dropped if they go stale).
    """

    def __init__(
        self,
        window_s: float = 0.050,
        required: Sequence[str] = ("camera", "lidar"),
        optional: Sequence[str] = ("detections",),
        max_age_s: Optional[float] = 0.250,
        max_queue: int = 64,
    ) -> None:
        if window_s <= 0:
            raise ValueError("window_s must be positive")
        if not required:
            raise ValueError("at least one required stream is needed")

        self.window_s = float(window_s)
        self.required: Tuple[str, ...] = tuple(required)
        self.optional: Tuple[str, ...] = tuple(optional)
        self.max_age_s = None if max_age_s is None else float(max_age_s)
        self.max_queue = int(max_queue)

        names = (*self.required, *self.optional)
        if len(set(names)) != len(names):
            raise ValueError("stream names must be unique")

        self._queues: Dict[str, Deque[TimedSample]] = {name: deque() for name in names}
        self._lock = threading.Lock()
        self._newest_ts = 0.0
        self.dropped = 0

    def known_streams(self) -> Tuple[str, ...]:
        return tuple(self._queues.keys())

    def queue_sizes(self) -> Dict[str, int]:
        with self._lock:
            return {name: len(q) for name, q in self._queues.items()}

    def push(self, stream: str, timestamp: float, payload: Any) -> None:
        if stream not in self._queues:
            raise KeyError(f"unknown stream: {stream}")
        sample = TimedSample(timestamp=float(timestamp), payload=payload)
        with self._lock:
            q = self._queues[stream]
            q.append(sample)
            if len(q) >= 2 and q[-1].timestamp < q[-2].timestamp:
                ordered = sorted(q, key=lambda s: s.timestamp)
                q.clear()
                q.extend(ordered)
            while len(q) > self.max_queue:
                q.popleft()
                self.dropped += 1
            self._newest_ts = max(self._newest_ts, sample.timestamp)
            self._drop_stale_unlocked()

    def pop_matched(self) -> Optional[Dict[str, TimedSample]]:
        """
        Consume one exclusive nearest match, or return None.

        The required streams are paired first (minimum timestamp span
        among candidates inside the window). Optional streams then
        attach to the nearest sample within the window of the pair's
        mean timestamp.
        """
        with self._lock:
            # Match first so a still-valid pair is not age-dropped on the
            # same call that could have consumed it.
            if any(len(self._queues[name]) == 0 for name in self.required):
                self._drop_stale_unlocked()
                return None

            required_match = self._best_required_tuple()
            if required_match is None:
                self._drop_stale_unlocked()
                return None

            result: Dict[str, TimedSample] = {}
            for name, sample in required_match.items():
                self._queues[name].remove(sample)
                result[name] = sample

            ref_ts = sum(s.timestamp for s in result.values()) / len(result)
            for name in self.optional:
                nearest = self._nearest_unlocked(name, ref_ts)
                if nearest is not None and abs(nearest.timestamp - ref_ts) <= self.window_s:
                    self._queues[name].remove(nearest)
                    result[name] = nearest

            self._drop_stale_unlocked()
            return result

    def _best_required_tuple(self) -> Optional[Dict[str, TimedSample]]:
        """Exclusive nearest required-stream tuple inside the window."""
        queues = [self._queues[name] for name in self.required]
        best: Optional[Dict[str, TimedSample]] = None
        best_key: Optional[Tuple[float, float]] = None

        def walk(index: int, chosen: List[TimedSample]) -> None:
            nonlocal best, best_key
            if index == len(self.required):
                ts = [s.timestamp for s in chosen]
                span = max(ts) - min(ts)
                if span > self.window_s:
                    return
                # Prefer tighter spans, then earlier groups.
                # Microseconds avoid float jitter when spans are equal.
                key = (round(span * 1_000_000), min(ts))
                if best_key is None or key < best_key:
                    best_key = key
                    best = {
                        name: sample
                        for name, sample in zip(self.required, chosen)
                    }
                return
            for sample in queues[index]:
                walk(index + 1, chosen + [sample])

        walk(0, [])
        return best

    def _nearest_unlocked(self, stream: str, ref_ts: float) -> Optional[TimedSample]:
        q = self._queues[stream]
        if not q:
            return None
        return min(q, key=lambda s: (abs(s.timestamp - ref_ts), s.timestamp))

    def _drop_stale_unlocked(self) -> None:
        if self._newest_ts <= 0:
            return

        # Age-out: anything older than newest - max_age can never wait usefully.
        # Disabled when max_age_s is None (fixture replay of sparse timestamps).
        if self.max_age_s is not None:
            cutoff = self._newest_ts - self.max_age_s
            for q in self._queues.values():
                while q and q[0].timestamp < cutoff:
                    q.popleft()
                    self.dropped += 1

        # Unpairable required samples: every other required stream already
        # has a newer sample past the window, so a future arrival cannot help.
        for name in self.required:
            q = self._queues[name]
            keep: Deque[TimedSample] = deque()
            for sample in q:
                if self._is_unpairable(name, sample):
                    self.dropped += 1
                else:
                    keep.append(sample)
            q.clear()
            q.extend(keep)

        # Optional samples that missed every current required group and
        # are already older than newest - window will never attach.
        for name in self.optional:
            q = self._queues[name]
            keep = deque()
            for sample in q:
                if self._newest_ts > sample.timestamp + self.window_s:
                    # Still keep if some required sample could attach.
                    if self._optional_can_wait(sample):
                        keep.append(sample)
                    else:
                        self.dropped += 1
                else:
                    keep.append(sample)
            q.clear()
            q.extend(keep)

    def _is_unpairable(self, stream: str, sample: TimedSample) -> bool:
        for other in self.required:
            if other == stream:
                continue
            other_q = self._queues[other]
            if not other_q:
                return False
            newest_other = other_q[-1].timestamp
            if newest_other <= sample.timestamp + self.window_s:
                return False
            if any(abs(other_s.timestamp - sample.timestamp) <= self.window_s for other_s in other_q):
                return False
        # Only unpairable when every other required stream exists and is
        # already past the window with no in-window partner.
        return all(self._queues[other] for other in self.required if other != stream)

    def _optional_can_wait(self, sample: TimedSample) -> bool:
        for name in self.required:
            q = self._queues[name]
            if not q:
                return True
            if any(abs(other.timestamp - sample.timestamp) <= self.window_s for other in q):
                return True
            if q[-1].timestamp <= sample.timestamp + self.window_s:
                return True
        return False
