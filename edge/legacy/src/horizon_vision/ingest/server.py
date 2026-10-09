"""
Local HTTP ingest for the web sim.

The Vite viewer POSTs ~10 Hz JSON samples to /ingest. No cloud
services — bind to a loopback port on the edge process.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import urlparse
import json
import threading

from horizon_vision.ingest.payloads import IngestError, parse_ingest_payload
from horizon_vision.perception.edge_ai import PerceptionOutput
from horizon_vision.perception.fusion import Detection3D, SensorFusion


def _box_json(d: Detection3D) -> Dict[str, Any]:
    return {
        "id": getattr(d, "object_id", None),
        "label": d.label,
        "confidence": float(d.confidence),
        "center": [float(x) for x in d.center.tolist()],
        "size": [float(x) for x in d.size.tolist()],
        "yaw": float(d.yaw),
        "distance": getattr(d, "distance", None),
    }


class IngestHub:
    """Accept parsed samples and enqueue them on the fusion synchronizer."""

    def __init__(self, fusion: SensorFusion):
        self.fusion = fusion
        self.accepted = 0
        self.rejected = 0
        self._lock = threading.Lock()
        self._latest: Optional[Dict[str, Any]] = None

    def accept(self, payload: Any) -> Dict[str, Any]:
        parsed = parse_ingest_payload(payload)
        if parsed.camera is not None:
            self.fusion.push_camera(parsed.camera)
        if parsed.lidar is not None:
            self.fusion.push_lidar(parsed.lidar)
        if parsed.detections is not None:
            self.fusion.push_detections(
                parsed.timestamp,
                parsed.detections,
                sensor_x=parsed.sensor_x,
            )
        with self._lock:
            self.accepted += 1
        return {
            "ok": True,
            "enqueued": list(parsed.streams),
            "t": parsed.timestamp,
            "sensorX": parsed.sensor_x,
            "queued": self.fusion.queue_sizes(),
        }

    def publish_perception(self, perception: PerceptionOutput) -> None:
        """Latest detector output for the viewer (GT labels stay separate)."""
        payload = {
            "ok": True,
            "detector": perception.extras.get("detector", "lidar_cluster"),
            "timestamp": perception.timestamp,
            "predictions": [_box_json(d) for d in perception.detections],
            "labels": [_box_json(d) for d in perception.labels],
            "metrics": perception.metrics.as_dict() if perception.metrics is not None else None,
            "num_lidar_points": perception.num_lidar_points,
        }
        with self._lock:
            self._latest = payload

    def latest_predictions(self) -> Dict[str, Any]:
        with self._lock:
            if self._latest is None:
                return {
                    "ok": True,
                    "detector": "lidar_cluster",
                    "predictions": [],
                    "labels": [],
                    "metrics": None,
                }
            return dict(self._latest)

    def health(self) -> Dict[str, Any]:
        latest = self.latest_predictions()
        return {
            "ok": True,
            "accepted": self.accepted,
            "rejected": self.rejected,
            "queued": self.fusion.queue_sizes(),
            "detector": latest.get("detector", "lidar_cluster"),
            "num_predictions": len(latest.get("predictions") or []),
        }


def _json_bytes(data: Dict[str, Any], status: int = 200) -> tuple[int, bytes]:
    return status, json.dumps(data).encode("utf-8")


def make_handler(hub: IngestHub):
    class IngestHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            # Keep the edge loop readable; health polls are noisy.
            path = str(args[0]) if args else ""
            if path.startswith("GET /health") or path.startswith("GET /predictions"):
                return
            print(f"[Ingest] {self.address_string()} {fmt % args}")

        def _cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _write(self, status: int, body: bytes, content_type: str = "application/json") -> None:
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._write(204, b"")

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path in ("/health", "/"):
                status, body = _json_bytes(hub.health())
                self._write(status, body)
                return
            if path in ("/predictions", "/predictions/"):
                status, body = _json_bytes(hub.latest_predictions())
                self._write(status, body)
                return
            self._write(404, json.dumps({"ok": False, "error": "not found"}).encode("utf-8"))

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path not in ("/ingest", "/ingest/"):
                self._write(404, json.dumps({"ok": False, "error": "not found"}).encode("utf-8"))
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                with hub._lock:
                    hub.rejected += 1
                self._write(400, json.dumps({"ok": False, "error": "invalid JSON"}).encode("utf-8"))
                return
            try:
                result = hub.accept(payload)
            except IngestError as exc:
                with hub._lock:
                    hub.rejected += 1
                self._write(400, json.dumps({"ok": False, "error": str(exc)}).encode("utf-8"))
                return
            self._write(200, json.dumps(result).encode("utf-8"))

    return IngestHandler


class IngestServer:
    """Background ThreadingHTTPServer bound to host:port."""

    def __init__(self, hub: IngestHub, host: str = "127.0.0.1", port: int = 8765):
        self.hub = hub
        self.host = host
        self.port = port
        self._httpd: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> None:
        handler = make_handler(self.hub)
        self._httpd = ThreadingHTTPServer((self.host, self.port), handler)
        # Port 0 is allowed in tests — pick the assigned port.
        self.host, self.port = self._httpd.server_address[:2]
        self._thread = threading.Thread(
            target=self._httpd.serve_forever,
            name="horizon-ingest",
            daemon=True,
        )
        self._thread.start()
        print(f"[Ingest] Listening on {self.url}/ingest")

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        print("[Ingest] Stopped")
