import asyncio
import json
import logging


from orca import queue as q
from orca import skills as sk


_notifier = None
logger = logging.getLogger(__name__)


def _safe_event(job_id, event_type, **fields):
    try:
        return q.append_event(job_id, event_type, **fields)
    except Exception:
        logger.exception("job event persistence failed for %s", job_id)
        return None


def _notifier_singleton():
    global _notifier
    if _notifier is None:
        from orca.notify import Notifier

        _notifier = Notifier()
    return _notifier


def _summary(result) -> str:
    parts = []
    if isinstance(result, dict):
        if result.get("response"):
            parts.append(result["response"][:200])
        if result.get("video"):
            parts.append(f"Video: {result['video']}")
        if result.get("images"):
            parts.append(f"Bilder: {len(result['images'])}")
        if result.get("voice"):
            parts.append(f"Voice: {result['voice']}")
    return "\n".join(parts) if parts else str(result)[:200]


def process_one(job: dict, base_url: str, api_key: str, model: str, claimed: bool = False) -> None:
    job_id = job["id"]
    if not claimed:
        q.set_status(job_id, "running")
        _safe_event(job_id, "job.started", status="running", message="Worker started")
    title = f"Job {job['skill']} ({job_id})"

    def progress(event):
        phase = event.get("phase")
        event_type = "job.step.started" if phase == "started" else "job.step.completed"
        _safe_event(job_id, event_type, status="running", step=event.get("step"), step_index=event.get("step_index"), step_total=event.get("step_total"), message=event.get("message", ""))

    try:
        skill_def = sk.load_skill(job["skill"])
        if not skill_def:
            q.set_status(job_id, "failed", error="skill not found")
            _safe_event(job_id, "job.failed", status="failed", message="skill not found")
            _notifier_singleton().send(f"{title}: FEHLER", "Skill nicht gefunden")
            return
        input_data = json.loads(job["input"]) if job.get("input") else {}
        result = sk.run_skill(skill_def, input_data, base_url, api_key, model, progress_callback=progress)
        q.set_status(job_id, "done", result=result)
        _safe_event(job_id, "job.completed", status="done", message="Job complete", payload={"result": result})
        _notifier_singleton().send(f"{title}: FERTIG", _summary(result))
    except Exception as e:
        q.set_status(job_id, "failed", error=str(e))
        _safe_event(job_id, "job.failed", status="failed", message=str(e)[:500])
        _notifier_singleton().send(f"{title}: FEHLER", str(e)[:300])


async def worker_loop(base_url: str, api_key: str, model: str, poll_seconds: float = 1.0) -> None:
    loop = asyncio.get_event_loop()
    while True:
        job = q.claim_next_queued()
        if job:
            await loop.run_in_executor(None, process_one, job, base_url, api_key, model, True)
        await asyncio.sleep(poll_seconds)