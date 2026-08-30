from dataclasses import dataclass
import socket
import urllib.error
import urllib.request


@dataclass(frozen=True)
class ServiceSpec:
    name: str
    endpoint: str | None
    required: bool
    companion: bool
    start_command: str | None
    cwd: str | None
    timeout_seconds: float = 3.0


def _probe(spec: ServiceSpec, timeout: float) -> tuple[str, str]:
    if not spec.endpoint:
        return "failed", "no endpoint"
    if spec.endpoint.startswith("tcp://"):
        host_port = spec.endpoint.removeprefix("tcp://").split("/", 1)[0]
        host, port = host_port.rsplit(":", 1)
        try:
            with socket.create_connection((host, int(port)), timeout=timeout):
                return "healthy", "TCP reachable"
        except socket.timeout:
            return "timeout", "TCP timeout"
        except OSError as exc:
            return "failed", type(exc).__name__
    try:
        with urllib.request.urlopen(spec.endpoint, timeout=timeout) as response:
            if response.status < 500:
                return "healthy", f"HTTP {response.status}"
            return "failed", f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        return ("healthy", f"HTTP {exc.code}") if exc.code < 500 else ("failed", f"HTTP {exc.code}")
    except TimeoutError:
        return "timeout", "HTTP timeout"
    except OSError as exc:
        return "failed", type(exc).__name__


def probe_service(spec: ServiceSpec, timeout: float | None = None) -> dict:
    status, detail = _probe(spec, timeout or spec.timeout_seconds)
    return {"name": spec.name, "status": status, "required": spec.required, "companion": spec.companion, "endpoint": spec.endpoint, "detail": detail}


def service_specs() -> list[ServiceSpec]:
    return [
        ServiceSpec("omniroute", "http://127.0.0.1:20128/v1/models", True, False, r"start.cmd", "."),
        ServiceSpec("control-room", "http://127.0.0.1:20129/health", True, False, r"ui\run-ui.cmd", r"voice-agents"),
        ServiceSpec("livekit", "tcp://127.0.0.1:7880", True, False, "docker compose up -d", r"voice-agents\docker"),
        ServiceSpec("redis", "tcp://127.0.0.1:6379", True, False, "docker compose up -d", r"voice-agents\docker"),
        ServiceSpec("agent-worker", "tcp://127.0.0.1:8081", True, False, r".venv\Scripts\python.exe agents\starter_agent.py start", r"voice-agents"),
        ServiceSpec("kokoro", "tcp://127.0.0.1:8880", True, False, r"docker compose up -d kokoro-tts", r"voice-agents\docker"),
        ServiceSpec("kokoro-de", "tcp://127.0.0.1:8881", True, False, r"docker compose up -d --build kokoro-onnx", r"repos\kokoro-german"),
        ServiceSpec("voicebox", "tcp://127.0.0.1:17493", True, False, r"ui\run-voicebox.cmd", r"voice-agents"),
        ServiceSpec("ollama", "http://127.0.0.1:11434/api/tags", True, False, "ollama serve", None),
        ServiceSpec("comfyui", "http://127.0.0.1:8188/system_stats", True, False, r"ui\run-comfyui.cmd", r"voice-agents"),
        ServiceSpec("agents-playground", "tcp://127.0.0.1:3000", False, True, "npm.cmd run dev -- -p 3000", r"voice-agents\agents-playground"),
        ServiceSpec("opencode-web", "tcp://127.0.0.1:4096", False, True, "opencode web --port 4096 --hostname 0.0.0.0", None),
    ]
