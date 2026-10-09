#!/usr/bin/env bash
# Camera-only edge + hub, then the parked LiDAR suite, then the occupancy grid.
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v python >/dev/null 2>&1; then
  PY=python
else
  PY=python3
fi
"$PY" -m pytest
(cd edge/legacy && "$PY" -m pytest)
node --experimental-strip-types --test edge/legacy/occupancy/occupancyGrid.test.ts
