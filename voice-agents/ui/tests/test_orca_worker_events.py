from orca import queue, worker


class FakeNotifier:
    def send(self, *args, **kwargs):
        return None


def setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr(queue, "DB_PATH", tmp_path / "jobs.db")
    queue.init()


def test_process_one_emits_started_step_and_completed_events(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("fake-skill", {"text": "hello"})
    monkeypatch.setattr(worker.sk, "load_skill", lambda name: {"name": name, "pipeline": [{"type": "llm"}, {"type": "command"}]})

    def fake_run(*args, **kwargs):
        callback = kwargs["progress_callback"]
        callback({"phase": "started", "step": "llm", "step_index": 1, "step_total": 2, "message": "LLM started"})
        callback({"phase": "completed", "step": "llm", "step_index": 1, "step_total": 2, "message": "LLM complete"})
        return {"response": "ok"}

    monkeypatch.setattr(worker.sk, "run_skill", fake_run)
    monkeypatch.setattr(worker, "_notifier_singleton", lambda: FakeNotifier())
    worker.process_one(job, "http://llm", "key", "model")
    events = queue.events_since(job["id"])
    event_types = [event["event_type"] for event in events]
    assert event_types[0] == "job.created"
    assert "job.started" in event_types
    assert "job.step.started" in event_types
    assert "job.step.completed" in event_types
    assert "job.completed" in event_types
    assert queue.job_by_id(job["id"])["status"] == "done"


def test_process_one_emits_failed_terminal_event(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    job = queue.create_job("fake-skill", {"text": "hello"})
    monkeypatch.setattr(worker.sk, "load_skill", lambda name: {"name": name, "pipeline": []})
    monkeypatch.setattr(worker.sk, "run_skill", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(worker, "_notifier_singleton", lambda: FakeNotifier())
    worker.process_one(job, "http://llm", "key", "model")
    events = queue.events_since(job["id"])
    assert events[-1]["event_type"] == "job.failed"
    assert events[-1]["status"] == "failed"
    assert "boom" in events[-1]["message"]
