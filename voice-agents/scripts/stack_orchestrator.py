import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from orca.service_health import probe_service, service_specs


def resolve_path(value: str | None, root: Path) -> Path:
    if not value:
        return root
    path = Path(value)
    return path if path.is_absolute() else root / path


def run(mode: str, as_json: bool = False) -> int:
    root = Path(os.environ.get("OMNIROUTE_ROOT", Path(__file__).resolve().parents[2]))
    results = []
    for spec in service_specs():
        result = probe_service(spec)
        if result["status"] != "healthy" and mode == "start" and spec.start_command:
            command = spec.start_command
            cwd = resolve_path(spec.cwd, root)
            subprocess.Popen(command, cwd=str(cwd), shell=True, creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + min(spec.timeout_seconds * 10, 30)
            while time.monotonic() < deadline:
                time.sleep(0.5)
                result = probe_service(spec)
                if result["status"] == "healthy":
                    result["status"] = "started"
                    break
        results.append(result)
    if as_json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for result in results:
            marker = "OK" if result["status"] in {"healthy", "started"} else ("WARN" if result["companion"] else "ERROR")
            print(f"[{marker}] {result['name']}: {result['status']} ({result['detail']})")
    return 0 if all(r["status"] in {"healthy", "started"} or r["companion"] for r in results) else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--status", action="store_true")
    group.add_argument("--start", action="store_true")
    group.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        specs = [{"name": s.name, "endpoint": s.endpoint, "start_command": s.start_command, "cwd": s.cwd, "required": s.required, "companion": s.companion} for s in service_specs()]
        print(json.dumps(specs, ensure_ascii=False, indent=2) if args.json else "\n".join(f"{s['name']}: {s['start_command'] or 'probe only'}" for s in specs))
        return 0
    return run("start" if args.start else "status", args.json)


if __name__ == "__main__":
    raise SystemExit(main())
