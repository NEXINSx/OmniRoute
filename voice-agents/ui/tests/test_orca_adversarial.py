import asyncio
import json
import re
import threading
from pathlib import Path

from orca import queue
from ui import main


def setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr(queue, "DB_PATH", tmp_path / "jobs.db")
    queue.init()


def test_concurrent_claim_returns_a_job_to_only_one_worker(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("research", {"text": "race"})
    barrier = threading.Barrier(2)
    claimed = []

    def claim():
        barrier.wait()
        claimed.append(queue.claim_next_queued())

    threads = [threading.Thread(target=claim) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert [item["id"] if item else None for item in claimed].count(job["id"]) == 1
    assert sum(item is None for item in claimed) == 1
    assert queue.job_by_id(job["id"])["status"] == "running"


def test_empty_success_result_survives_status_persistence(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("research", {"text": "empty-result"})

    queue.set_status(job["id"], "done", result={})

    stored = queue.job_by_id(job["id"])
    assert json.loads(stored["result"]) == {}


def test_claim_persists_started_event_with_running_state(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("research", {"text": "atomic"})

    claimed = queue.claim_next_queued()
    events = queue.events_since(job["id"])

    assert claimed["status"] == "running"
    assert [event["event_type"] for event in events] == ["job.created", "job.started"]
    assert events[-1]["status"] == "running"
    assert events[-1]["created_at"] == claimed["started_at"]


def test_health_reports_queued_jobs_as_pending(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    queue.create_job("research", {"text": "queued"})

    body = asyncio.run(main.health()).body.decode("utf-8")

    assert json.loads(body)["jobQueue"]["pending"] == 1


def test_ui_sse_parser_splits_real_newlines():
    html = Path(main.STATIC_DIR / "index.html").read_text(encoding="utf-8")
    frames_line = next(line for line in html.splitlines() if "const frames = buffer.split" in line)
    lines_line = next(line for line in html.splitlines() if "const lines = frame.split" in line)

    assert re.search(r"split\(/\\r\?\\n\\r\?\\n/\)", frames_line)
    assert re.search(r"split\(/\\r\?\\n/\)", lines_line)


def test_status_exposes_pending_count_for_ui_state_sync(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    monkeypatch.setattr(main, "UI_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr(main, "ALLOWED_NETS", [])
    queue.create_job("research", {"text": "waiting"})

    from fastapi.testclient import TestClient

    response = TestClient(main.app).get("/orca/status", headers={"X-Access-Token": "test-token"})

    assert response.status_code == 200
    assert response.json()["queue"]["pending"] == 1


def test_sse_client_reconnects_with_bounded_backoff():
    html = Path(main.STATIC_DIR / "index.html").read_text(encoding="utf-8")

    assert "const maxRetries = 3" in html
    assert "Last-Event-ID" in html
    assert "setTimeout(resolve, 500 * (2 ** (retries - 1)))" in html


def test_ui_runner_uses_windows_timeout_binary():
    runner = Path(main.PROJECT_DIR / "ui" / "tests" / "run_ui_test.cmd").read_text(encoding="utf-8")

    assert '"%SystemRoot%\\System32\\timeout.exe" /t 1 /nobreak >nul' in runner


def test_job_status_and_detail_require_authentication(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    monkeypatch.setattr(main, "UI_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr(main, "ALLOWED_NETS", [])
    job = queue.create_job("research", {"text": "private"})

    from fastapi.testclient import TestClient

    client = TestClient(main.app)
    for path in ("/orca/status", f"/orca/jobs/{job['id']}"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers={"X-Access-Token": "test-token"}).status_code == 200
