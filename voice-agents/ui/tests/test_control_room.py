"""pytest wrapper around the Playwright Control Room UI test.

Skips automatically when the UI server is not reachable, so the suite stays
green in environments without a running server. Run explicitly with:

    python -m pytest ui/tests/test_control_room.py -v -m ui

The UI_BASE env var selects the target (default 127.0.0.1:20129).
"""
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

import pytest

BASE = os.environ.get("UI_BASE", "http://127.0.0.1:20129/")
SCRIPT = Path(__file__).resolve().parent / "control_room_test.py"
VENV_PY = Path(r"C:\OmniRoute\voice-agents\.venv\Scripts\python.exe")


def server_reachable() -> bool:
    try:
        with urllib.request.urlopen(BASE + "health", timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


@pytest.mark.ui
@pytest.mark.skipif(not server_reachable(), reason="UI-Server auf " + BASE + " nicht erreichbar")
def test_control_room_ui():
    env = dict(os.environ)
    env["UI_BASE"] = BASE
    python = str(VENV_PY) if VENV_PY.exists() else sys.executable
    result = subprocess.run([python, str(SCRIPT)], env=env, capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr[-2000:])
    assert result.returncode == 0, "Control-Room-UI-Test fehlgeschlagen (Exit " + str(result.returncode) + ")"
