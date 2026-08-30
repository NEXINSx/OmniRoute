import json
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_DIR / "data" / "jobs.db"


def now_ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init() -> None:
    c = conn()
    c.execute(
        """CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            skill TEXT NOT NULL,
            input TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            trigger TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            result TEXT,
            error TEXT
        )"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS schedule_runs (
            skill TEXT PRIMARY KEY,
            last_run TEXT
        )"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS job_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            status TEXT NOT NULL,
            step TEXT,
            step_index INTEGER,
            step_total INTEGER,
            message TEXT NOT NULL,
            payload TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        )"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_job_events_job_id_id ON job_events(job_id, id)")
    c.commit()
    c.close()


def create_job(skill: str, input_data: dict, trigger: str = "manual") -> dict:
    c = conn()
    job_id = uuid.uuid4().hex[:12]
    created_at = now_ts()
    c.execute(
        "INSERT INTO jobs (id, skill, input, status, trigger, created_at) VALUES (?,?,?,?,?,?)",
        (job_id, skill, json.dumps(input_data, ensure_ascii=False), "queued", trigger, created_at),
    )
    c.execute(
        "INSERT INTO job_events (job_id, event_type, status, message, payload, created_at) VALUES (?,?,?,?,?,?)",
        (job_id, "job.created", "queued", "Job queued", "{}", created_at),
    )
    c.commit()
    row = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    c.close()
    return dict(row)


def append_event(job_id: str, event_type: str, *, status: str, message: str, step: str | None = None, step_index: int | None = None, step_total: int | None = None, payload: dict | None = None, created_at: str | None = None) -> dict:
    event_time = created_at or now_ts()
    c = conn()
    cursor = c.execute(
        "INSERT INTO job_events (job_id, event_type, status, step, step_index, step_total, message, payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (job_id, event_type, status, step, step_index, step_total, message, json.dumps(payload or {}, ensure_ascii=False), event_time),
    )
    c.commit()
    row = c.execute("SELECT * FROM job_events WHERE id=?", (cursor.lastrowid,)).fetchone()
    c.close()
    event = dict(row)
    event["payload"] = json.loads(event["payload"] or "{}")
    return event


def events_since(job_id: str | None = None, after_id: int = 0, limit: int = 100) -> list[dict]:
    c = conn()
    if job_id is None:
        rows = c.execute("SELECT * FROM job_events WHERE id > ? ORDER BY id ASC LIMIT ?", (after_id, limit)).fetchall()
    else:
        rows = c.execute("SELECT * FROM job_events WHERE job_id=? AND id > ? ORDER BY id ASC LIMIT ?", (job_id, after_id, limit)).fetchall()
    c.close()
    events = []
    for row in rows:
        event = dict(row)
        event["payload"] = json.loads(event["payload"] or "{}")
        events.append(event)
    return events


def delete_job(job_id: str) -> bool:
    c = conn()
    c.execute("DELETE FROM job_events WHERE job_id=?", (job_id,))
    cursor = c.execute("DELETE FROM jobs WHERE id=?", (job_id,))
    c.commit()
    c.close()
    return cursor.rowcount > 0


def claim_next_queued() -> dict | None:
    """Atomically claim the oldest queued job and record its start event."""
    c = conn()
    try:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute(
            "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at, id LIMIT 1"
        ).fetchone()
        if row is None:
            c.commit()
            return None
        started_at = now_ts()
        cursor = c.execute(
            "UPDATE jobs SET status='running', started_at=? WHERE id=? AND status='queued'",
            (started_at, row["id"]),
        )
        if cursor.rowcount != 1:
            c.rollback()
            return None
        c.execute(
            "INSERT INTO job_events (job_id, event_type, status, message, payload, created_at) VALUES (?,?,?,?,?,?)",
            (row["id"], "job.started", "running", "Worker started", "{}", started_at),
        )
        c.commit()
        claimed = c.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone()
        return dict(claimed)
    finally:
        c.close()


def next_queued() -> dict | None:
    """Compatibility read-only lookup for callers that only inspect the queue."""
    c = conn()
    row = c.execute(
        "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at, id LIMIT 1"
    ).fetchone()
    c.close()
    return dict(row) if row else None


def set_status(job_id: str, status: str, result: dict | None = None, error: str | None = None) -> None:
    c = conn()
    if status == "running":
        c.execute("UPDATE jobs SET status=?, started_at=COALESCE(started_at, ?) WHERE id=?", (status, now_ts(), job_id))
    else:
        c.execute(
            "UPDATE jobs SET status=?, finished_at=?, result=?, error=? WHERE id=?",
            (status, now_ts(), json.dumps(result, ensure_ascii=False) if result is not None else None, error, job_id),
        )
    c.commit()
    c.close()


def list_jobs(limit: int = 50) -> list[dict]:
    c = conn()
    rows = c.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    c.close()
    return [dict(r) for r in rows]


def job_by_id(job_id: str) -> dict | None:
    c = conn()
    row = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    c.close()
    return dict(row) if row else None


def last_run(skill: str) -> str | None:
    c = conn()
    row = c.execute("SELECT last_run FROM schedule_runs WHERE skill=?", (skill,)).fetchone()
    c.close()
    return row["last_run"] if row else None


def set_last_run(skill: str, ts: str) -> None:
    c = conn()
    c.execute(
        "INSERT INTO schedule_runs (skill, last_run) VALUES (?,?) "
        "ON CONFLICT(skill) DO UPDATE SET last_run=excluded.last_run",
        (skill, ts),
    )
    c.commit()
    c.close()


def counts() -> dict:
    c = conn()
    rows = c.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").fetchall()
    c.close()
    return {r["status"]: r["n"] for r in rows}


init()