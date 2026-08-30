from pathlib import Path

from orca.service_health import service_specs
from scripts.stack_orchestrator import resolve_path


def test_core_services_have_start_commands():
    specs = {spec.name: spec for spec in service_specs()}
    for name in ("agent-worker", "kokoro", "kokoro-de", "voicebox", "ollama", "comfyui"):
        assert specs[name].start_command, name


def test_relative_service_paths_follow_runtime_root(tmp_path):
    spec = next(spec for spec in service_specs() if spec.name == "control-room")
    assert resolve_path(spec.cwd, tmp_path) == tmp_path / "voice-agents"
