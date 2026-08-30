import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from orca.service_health import ServiceSpec, probe_service, service_specs


@pytest.fixture
def local_http_server():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
        def log_message(self, format, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/health"
    server.shutdown()
    thread.join(timeout=2)


def test_http_probe_reports_healthy(local_http_server):
    spec = ServiceSpec("test", local_http_server, True, False, None, None, 1)
    result = probe_service(spec)
    assert result["status"] == "healthy"
    assert result["required"] is True


def test_unreachable_probe_reports_failed():
    spec = ServiceSpec("missing", "http://127.0.0.1:1/health", True, False, None, None, 0.1)
    result = probe_service(spec)
    assert result["status"] in {"failed", "timeout"}


def test_service_specs_include_productive_stack():
    names = {spec.name for spec in service_specs()}
    assert {"omniroute", "control-room", "ollama", "comfyui", "voicebox", "livekit"} <= names
