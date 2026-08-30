"""Setzt UI_BASE (argv[1]) und führt das Playwright-Control-Room-Testskript aus.

Wird von run_ui_test.cmd aufgerufen, um mit_server.py einen einfachen,
quote-freien Befehl zu geben:  python run_test_with_base.py http://127.0.0.1:20139/
"""
import os
import runpy
import sys
from pathlib import Path

if len(sys.argv) > 1:
    os.environ["UI_BASE"] = sys.argv[1]
else:
    os.environ["UI_BASE"] = os.environ.get("UI_BASE", "http://127.0.0.1:20129/")

script = Path(__file__).resolve().parent / "control_room_test.py"
runpy.run_path(str(script), run_name="__main__")
