import json

from orca import queue


def setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr(queue, "DB_PATH", tmp_path / "jobs.db")
    queue.init()


def test_create_job_writes_job_created_event(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("daily-brainstorm", {"text": "test"}, trigger="command-bar")
    events = queue.events_since(job["id"])
    assert len(events) == 1
    assert events[0]["job_id"] == job["id"]
    assert events[0]["event_type"] == "job.created"
    assert events[0]["status"] == "queued"
    assert events[0]["message"] == "Job queued"


def test_events_since_replays_only_events_after_id(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("research", {"text": "test"})
    first = queue.append_event(job["id"], "job.started", status="running", message="Worker started")
    second = queue.append_event(job["id"], "job.completed", status="done", message="Job complete")
    assert [e["id"] for e in queue.events_since(job["id"], after_id=first["id"])] == [second["id"]]


def test_events_since_job_filter_never_leaks_another_job(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    first = queue.create_job("research", {"text": "one"})
    second = queue.create_job("research", {"text": "two"})
    queue.append_event(second["id"], "job.started", status="running", message="second")
    assert all(event["job_id"] == first["id"] for event in queue.events_since(first["id"]))


def test_delete_job_removes_job_and_events(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("research", {"text": "cleanup"})
    queue.append_event(job["id"], "job.started", status="running", message="started")
    assert queue.delete_job(job["id"]) is True
    assert queue.job_by_id(job["id"]) is None
    assert queue.events_since(job["id"]) == []
