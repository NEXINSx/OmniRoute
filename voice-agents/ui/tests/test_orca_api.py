import json

import pytest
from fastapi.testclient import TestClient

from ui import main


SKILLS = {
    "daily-brainstorm": {"description": "Tagesinspiration und Ideen", "pipeline": []},
    "tiktok-video-producer": {"description": "TikTok Short Video produzieren mit Bildern und Voice", "pipeline": []},
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "UI_ACCESS_TOKEN", "test-token")
    monkeypatch.setattr(main, "ALLOWED_NETS", [])
    monkeypatch.setattr(main.queue, "DB_PATH", tmp_path / "jobs.db")
    monkeypatch.setattr(main.skills, "list_skills", lambda: SKILLS)
    monkeypatch.setattr(main.skills, "load_skill", lambda name: SKILLS.get(name))
    main.queue.init()
    return TestClient(main.app)


def test_command_endpoint_creates_routed_job(client):
    response = client.post("/orca/commands", headers={"X-Access-Token": "test-token"}, json={"text": "Erstelle einen TikTok Short über den Hafen"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["job"]["trigger"] == "command-bar"
    assert body["job"]["skill"] == "tiktok-video-producer"
    assert body["routing"]["skill"] == "tiktok-video-producer"


def test_command_endpoint_rejects_empty_text(client):
    response = client.post("/orca/commands", headers={"X-Access-Token": "test-token"}, json={"text": "   "})
    assert response.status_code == 400


def test_events_endpoint_replays_sse_and_closes_on_terminal_event(client):
    job = main.queue.create_job("daily-brainstorm", {"text": "test"})
    main.queue.append_event(job["id"], "job.started", status="running", message="started")
    main.queue.append_event(job["id"], "job.completed", status="done", message="complete")
    with client.stream("GET", f"/orca/events?job_id={job['id']}", headers={"X-Access-Token": "test-token", "Last-Event-ID": "0"}) as response:
        body = "".join(response.iter_text())
    assert response.status_code == 200
    assert "event: job.created" in body
    assert "event: job.started" in body
    assert "event: job.completed" in body
    assert '"status": "done"' in body


def test_events_endpoint_rejects_invalid_token(client):
    job = main.queue.create_job("daily-brainstorm", {"text": "test"})
    response = client.get(f"/orca/events?job_id={job['id']}", headers={"X-Access-Token": "wrong"})
    assert response.status_code == 401
