# Orchestra Control Room v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Control Room a reliable production operator that starts the local AI stack, routes natural-language commands to real skills, persists job events, and streams live progress into the UI.

**Architecture:** Extend the existing SQLite-backed Orca queue with an append-only `job_events` timeline. Add a deterministic Smart Route module and authenticated FastAPI command/SSE endpoints, then connect the existing vanilla JavaScript Control Room to the job-specific event stream. Replace the current port-only Windows launcher with a health-aware Python orchestrator behind the existing `start-stack.cmd` entrypoint.

**Tech Stack:** Python 3.13, FastAPI, SQLite, httpx, pytest, Playwright, vanilla JavaScript, SSE over `fetch()`/`ReadableStream`, Windows CMD/PowerShell.

**Spec:** `docs/superpowers/specs/2026-08-25-orchestra-control-room-v1-design.md`

## Global Constraints

- Use the existing `C:\OmniRoute\voice-agents\.venv\Scripts\python.exe` for Python checks and tests.
- Keep `/orca/jobs` compatible with its current form-based API.
- Store job events in the existing `data/jobs.db`; do not add a second queue or event database.
- Authenticate `/orca/commands` and `/orca/events` with the existing `UI_ACCESS_TOKEN` and network policy.
- Never put access tokens in URLs, logs, persisted event payloads, or UI-visible event data.
- Keep Smart Route deterministic in v1; do not add an LLM routing round trip.
- Keep YouTube publication `unlisted` by default; no automatic public upload is allowed.
- Do not kill a service that already passes its health probe.
- Core service failures must be reported after all probes finish; companion service failures are warnings.
- Production code is written only after its corresponding failing test exists and has been observed failing.
- Existing ArcRift visual language, node graph, approval behavior, and mobile layout remain intact.

---

## Task 1: Add the Persistent Job Event Journal

**Files:**

- Modify: `orca/queue.py`
- Create: `ui/tests/test_orca_queue_events.py`

**Interfaces:**

- Consumes: existing `queue.create_job`, `queue.set_status`, `queue.job_by_id`, and `queue.DB_PATH`.
- Produces:
  - `append_event(job_id, event_type, *, status, message, step=None, step_index=None, step_total=None, payload=None, created_at=None) -> dict`
  - `events_since(job_id=None, after_id=0, limit=100) -> list[dict]`
  - `delete_job(job_id) -> bool` for isolated test cleanup only.
  - `create_job` writes a `job.created` event in the same SQLite transaction as the job row.

### Step 1: Write the failing queue-event tests

Add tests that use `monkeypatch` to replace `queue.DB_PATH` with a temporary SQLite path and call `queue.init()` before each scenario:

```python

def test_create_job_writes_job_created_event(tmp_path, monkeypatch):
    db = tmp_path / "jobs.db"
    monkeypatch.setattr(queue, "DB_PATH", db)
    queue.init()

    job = queue.create_job("daily-brainstorm", {"text": "test"}, trigger="command-bar")
    events = queue.events_since(job["id"])

    assert len(events) == 1
    assert events[0]["job_id"] == job["id"]
    assert events[0]["event_type"] == "job.created"
    assert events[0]["status"] == "queued"
    assert events[0]["message"] == "Job queued"


def test_events_since_replays_only_events_after_id(tmp_path, monkeypatch):
    db = tmp_path / "jobs.db"
    monkeypatch.setattr(queue, "DB_PATH", db)
    queue.init()
    job = queue.create_job("research", {"text": "test"})

    first = queue.append_event(job["id"], "job.started", status="running", message="Worker started")
    second = queue.append_event(job["id"], "job.completed", status="done", message="Job complete")

    assert [e["id"] for e in queue.events_since(job["id"], after_id=first["id"])] == [second["id"]]


def test_events_since_job_filter_never_leaks_another_job(tmp_path, monkeypatch):
    db = tmp_path / "jobs.db"
    monkeypatch.setattr(queue, "DB_PATH", db)
    queue.init()
    first = queue.create_job("research", {"text": "one"})
    second = queue.create_job("research", {"text": "two"})

    queue.append_event(second["id"], "job.started", status="running", message="second")

    assert all(event["job_id"] == first["id"] for event in queue.events_since(first["id"]))


def test_delete_job_removes_job_and_events(tmp_path, monkeypatch):
    db = tmp_path / "jobs.db"
    monkeypatch.setattr(queue, "DB_PATH", db)
    queue.init()
    job = queue.create_job("research", {"text": "cleanup"})
    queue.append_event(job["id"], "job.started", status="running", message="started")

    assert queue.delete_job(job["id"]) is True
    assert queue.job_by_id(job["id"]) is None
    assert queue.events_since(job["id"]) == []
```

### Step 2: Run the new tests and verify the expected failure

Run:

```bat
cd /d C:\OmniRoute\voice-agents
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_queue_events.py -q
```

Expected result: collection succeeds, then tests fail because `job_events`, `append_event`, `events_since`, and `delete_job` do not exist yet.

### Step 3: Implement the event schema and queue functions

In `queue.init()`, create the table and index in the same connection as `jobs`:

```sql
CREATE TABLE IF NOT EXISTS job_events (
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
);
CREATE INDEX IF NOT EXISTS idx_job_events_job_id_id
    ON job_events(job_id, id);
```

Update `create_job` so the job row and `job.created` row are inserted before one `commit()`. Return the same job dictionary shape currently returned.

Implement `append_event` with a single insert/commit and JSON-encode `payload`. Return the inserted event as a dictionary including its integer `id`.

Implement `events_since` with:

```sql
SELECT * FROM job_events
WHERE id > ? AND (? IS NULL OR job_id = ?)
ORDER BY id ASC
LIMIT ?
```

Decode `payload` back to a dictionary. Implement `delete_job` by deleting event rows and the job row in one transaction. Do not add an HTTP delete route in this task.

### Step 4: Run the tests and verify green

Run the same pytest command. Expected result: all four tests pass.

Then run the existing Python checks:

```bat
.venv\Scripts\python.exe -m py_compile orca\queue.py
```

### Step 5: Commit the isolated queue change

Suggested future commit:

```bat
git add orca/queue.py ui/tests/test_orca_queue_events.py
git commit -m "feat(orca): persist replayable job events"
```

---

## Task 2: Add Deterministic Smart Route Matching

**Files:**

- Create: `orca/routing.py`
- Create: `ui/tests/test_orca_routing.py`

**Interfaces:**

- Consumes: `skills.list_skills()` metadata dictionaries.
- Produces:
  - `RoutingDecision` frozen dataclass with `skill: str`, `confidence: float`, `reason: str`, and `matched_terms: tuple[str, ...]`.
  - `route_command(text: str, skill_defs: Mapping[str, Mapping[str, object]] | None = None) -> RoutingDecision`.

### Step 1: Write the failing routing tests

Use a small in-test skill mapping so routing tests never depend on the real filesystem:

```python
SKILLS = {
    "daily-brainstorm": {"description": "Tagesinspiration und Ideen"},
    "research": {"description": "Recherche, Quellen und Wettbewerber"},
    "tiktok-concept": {"description": "Kanal, Nische, Reichweite und Konzept"},
    "tiktok-video-producer": {"description": "TikTok Short Video produzieren mit Bildern und Voice"},
    "youtube-upload": {"description": "YouTube Short hochladen und veröffentlichen"},
}


def test_routes_video_command_to_video_producer():
    decision = route_command("Erstelle einen TikTok Short über den Hamburger Hafen mit Stimme", SKILLS)
    assert decision.skill == "tiktok-video-producer"
    assert decision.confidence >= 0.5
    assert "video" in decision.reason.lower() or "short" in decision.reason.lower()


def test_routes_research_command_to_research():
    decision = route_command("Recherchiere Quellen und Wettbewerber zum Thema", SKILLS)
    assert decision.skill == "research"
    assert decision.confidence >= 0.5


def test_routes_youtube_command_to_upload():
    decision = route_command("Lade den fertigen Short bei YouTube hoch", SKILLS)
    assert decision.skill == "youtube-upload"


def test_unknown_command_falls_back_to_daily_brainstorm():
    decision = route_command("Erzähl mir etwas völlig Unklares", SKILLS)
    assert decision.skill == "daily-brainstorm"
    assert decision.confidence == 0.0
    assert "fallback" in decision.reason.lower()


def test_empty_command_raises_value_error():
    with pytest.raises(ValueError, match="command text required"):
        route_command("   ", SKILLS)
```

### Step 2: Run the routing tests and verify red

Run:

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_routing.py -q
```

Expected result: collection succeeds and fails because `orca.routing` is absent.

### Step 3: Implement the minimal deterministic router

In `orca/routing.py`:

- Normalize Unicode text with `casefold()`.
- Tokenize words using a Unicode-aware regular expression.
- Remove German stop words such as `der`, `die`, `das`, `ein`, `eine`, `und`, `zu`, `für`, `mit`, `den`, `dem`.
- Add explicit aliases in a constant mapping:

```python
ROUTE_ALIASES = {
    "research": ("recherchiere", "quellen", "fakten", "wettbewerber"),
    "tiktok-concept": ("kanal", "nische", "reichweite", "konzept"),
    "tiktok-video-producer": ("short", "tiktok", "video", "produzieren", "voice", "bilder"),
    "youtube-upload": ("youtube", "hochladen", "upload", "veröffentlichen"),
}
```

- Combine skill name tokens, description tokens, optional `aliases`, optional pipeline `type` values, and aliases from `ROUTE_ALIASES`.
- Score command-token matches with weights: exact alias `4`, exact skill-name token `3`, pipeline type `2`, description token `1`.
- Require a positive score and a lead of at least `1` over the second result. Otherwise return `daily-brainstorm` with confidence `0.0`.
- Calculate confidence as `min(1.0, score / 12.0)` and produce a reason listing up to three matched terms.
- If `daily-brainstorm` is absent, raise `LookupError("fallback skill daily-brainstorm not found")` rather than silently selecting a nonexistent skill.

### Step 4: Run routing tests and verify green

Run the same pytest command, then:

```bat
.venv\Scripts\python.exe -m py_compile orca\routing.py
```

### Step 5: Commit the routing change

Suggested future commit:

```bat
git add orca/routing.py ui/tests/test_orca_routing.py
git commit -m "feat(orca): route command-bar goals to skills"
```

---

## Task 3: Emit Worker and Pipeline Step Events

**Files:**

- Modify: `orca/skills.py`
- Modify: `orca/worker.py`
- Modify: `skills/youtube-upload.md`
- Modify: `ui/tests/test_orca_worker_events.py`

**Interfaces:**

- Consumes: `queue.append_event`, `queue.set_status`, and existing skill pipeline definitions.
- Produces: `run_skill(skill, input_data, llm_endpoint, api_key, model, progress_callback=None) -> dict`, preserving compatibility for existing five-argument callers.

### Step 1: Write failing tests for step and terminal events

Use a temporary queue database and monkeypatch `worker.sk.run_skill` so the test does not call an LLM, ComfyUI, TTS, or YouTube:

```python

def test_process_one_emits_started_step_and_completed_events(tmp_path, monkeypatch):
    monkeypatch.setattr(queue, "DB_PATH", tmp_path / "jobs.db")
    queue.init()
    job = queue.create_job("fake-skill", {"text": "hello"})

    monkeypatch.setattr(worker.sk, "load_skill", lambda name: {
        "name": name,
        "pipeline": [{"type": "llm"}, {"type": "command"}],
    })
    monkeypatch.setattr(worker.sk, "run_skill", lambda *args, **kwargs: (
        kwargs["progress_callback"]({"phase": "started", "step": "llm", "step_index": 1, "step_total": 2, "message": "LLM started"}),
        kwargs["progress_callback"]({"phase": "completed", "step": "llm", "step_index": 1, "step_total": 2, "message": "LLM complete"}),
        {"response": "ok"},
    )[-1])
    monkeypatch.setattr(worker, "_notifier_singleton", lambda: FakeNotifier())

    worker.process_one(job, "http://llm", "key", "model")
    events = queue.events_since(job["id"])
    event_types = [event["event_type"] for event in events]

    assert event_types[0] == "job.created"
    assert "job.started" in event_types
    assert "job.completed" in event_types
    assert queue.job_by_id(job["id"])["status"] == "done"


def test_process_one_emits_failed_terminal_event(tmp_path, monkeypatch):
    monkeypatch.setattr(queue, "DB_PATH", tmp_path / "jobs.db")
    queue.init()
    job = queue.create_job("fake-skill", {"text": "hello"})
    monkeypatch.setattr(worker.sk, "load_skill", lambda name: {"name": name, "pipeline": []})
    monkeypatch.setattr(worker.sk, "run_skill", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(worker, "_notifier_singleton", lambda: FakeNotifier())

    worker.process_one(job, "http://llm", "key", "model")
    events = queue.events_since(job["id"])

    assert events[-1]["event_type"] == "job.failed"
    assert events[-1]["status"] == "failed"
    assert "boom" in events[-1]["message"]
```

The test helper `FakeNotifier` has a `send(*args, **kwargs)` method and stores nothing; it is test-only.

### Step 2: Run the worker tests and verify red

Run:

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_worker_events.py -q
```

Expected result: failure because `run_skill` has no progress callback and the worker emits no events.

### Step 3: Add the optional progress callback to `run_skill`

Change the signature to:

```python
def run_skill(skill, input_data, llm_endpoint, api_key, model, progress_callback=None):
```

Before each pipeline step call the callback with:

```python
{
    "phase": "started",
    "step": stype,
    "step_index": index,
    "step_total": len(pipeline),
    "message": step_message(step, stype, "started"),
}
```

After the step returns, call it with `phase: "completed"`. Add a small deterministic `step_message` mapping for `llm`, `command`, `media-image`, `media-voice`, `media-video`, `youtube-upload`, and a generic fallback. If the callback raises, catch that exception in the worker callback wrapper; do not catch pipeline exceptions in `run_skill`.

### Step 4: Add event-safe worker status transitions

In `worker.py`, add `_safe_event(job_id, event_type, **fields)` that calls `q.append_event` and logs an exception without changing the job outcome if persistence fails.

Update `process_one` in this order:

```text
set_status(running)
job.started
load skill
for each progress callback:
    job.step.started / job.step.completed
set_status(done, result=result)
job.completed
```

For missing skills or exceptions:

```text
set_status(failed, error=...)
job.failed
notifier.send(...)
```

Pass `progress_callback=callback` to `run_skill`. The callback converts `phase == started` into `job.step.started` and `phase == completed` into `job.step.completed`.

### Step 5: Make YouTube skill privacy safe by default

Change `skills/youtube-upload.md` pipeline privacy from `public` to `unlisted`. Change the code default in `_run_youtube_step` from `step.get("privacy", "public")` to `step.get("privacy", "unlisted")`. Preserve an explicit `public` value for a future approval-gated call.

### Step 6: Run worker tests and verify green

Run:

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_worker_events.py -q
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_queue_events.py ui/tests/test_orca_routing.py ui/tests/test_orca_worker_events.py -q
.venv\Scripts\python.exe -m py_compile orca\queue.py orca\skills.py orca\worker.py
```

### Step 7: Commit the worker event change

Suggested future commit:

```bat
git add orca/skills.py orca/worker.py skills/youtube-upload.md ui/tests/test_orca_worker_events.py
git commit -m "feat(orca): stream worker step progress as job events"
```

---

## Task 4: Add Command Creation and Authenticated SSE Endpoints

**Files:**

- Modify: `ui/main.py`
- Create: `ui/tests/test_orca_api.py`

**Interfaces:**

- Consumes: `routing.route_command`, `queue.create_job`, `queue.events_since`, `queue.job_by_id`, and `require_token`.
- Produces:
  - `POST /orca/commands` accepting `{"text": "..."}` and returning job plus routing metadata.
  - `GET /orca/events?job_id=<id>` returning `text/event-stream` with replay and reconnect support.
  - `format_sse(event: dict) -> str` for standards-compliant event framing.

### Step 1: Write failing FastAPI endpoint tests

Use FastAPI `TestClient` against `ui.main.app`. Patch `main.UI_ACCESS_TOKEN` to a test token, `main.queue.DB_PATH` to a temporary database, and `main.skills.list_skills`/`main.skills.load_skill` with deterministic test skills. The tests must not call a live LLM.

```python

def test_command_endpoint_creates_routed_job(client, monkeypatch):
    response = client.post(
        "/orca/commands",
        headers={"X-Access-Token": "test-token"},
        json={"text": "Erstelle einen TikTok Short über den Hafen"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["job"]["trigger"] == "command-bar"
    assert body["job"]["skill"] == "tiktok-video-producer"
    assert body["routing"]["skill"] == "tiktok-video-producer"


def test_command_endpoint_rejects_empty_text(client):
    response = client.post(
        "/orca/commands",
        headers={"X-Access-Token": "test-token"},
        json={"text": "   "},
    )
    assert response.status_code == 400


def test_events_endpoint_replays_sse_and_closes_on_terminal_event(client, queue_job):
    queue.append_event(queue_job["id"], "job.started", status="running", message="started")
    queue.append_event(queue_job["id"], "job.completed", status="done", message="complete")

    with client.stream(
        "GET",
        f"/orca/events?job_id={queue_job['id']}",
        headers={"X-Access-Token": "test-token", "Last-Event-ID": "0"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: job.created" in body
    assert "event: job.started" in body
    assert "event: job.completed" in body
    assert '"status": "done"' in body


def test_events_endpoint_rejects_invalid_token(client, queue_job):
    response = client.get(
        f"/orca/events?job_id={queue_job['id']}",
        headers={"X-Access-Token": "wrong"},
    )
    assert response.status_code == 401
```

The fixture must set `main.UI_ACCESS_TOKEN = "test-token"` and restore it after each test. The SSE terminal test must use a pre-populated temporary queue so it terminates deterministically.

### Step 2: Run API tests and verify red

Run:

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_api.py -q
```

Expected result: failures because `/orca/commands`, `/orca/events`, and `format_sse` do not exist.

### Step 3: Implement `/orca/commands`

Import `routing` and `JSONResponse`/`StreamingResponse` as needed. Parse JSON with `await request.json()` and reject non-dictionary bodies or empty `text` with HTTP 400.

Call:

```python
decision = routing.route_command(text, skills.list_skills())
if not skills.load_skill(decision.skill):
    raise HTTPException(status_code=503, detail="fallback skill daily-brainstorm not found")
input_data = {
    "text": text,
    "routing": {
        "skill": decision.skill,
        "confidence": decision.confidence,
        "reason": decision.reason,
        "matched_terms": list(decision.matched_terms),
    },
}
job = queue.create_job(decision.skill, input_data, trigger="command-bar")
ledger("task", {"id": job["id"], "skill": decision.skill, "trigger": "command-bar"})
```

Return the exact shape in the approved Spec. Do not include credentials or environment values.

### Step 4: Implement SSE framing and replay

Implement:

```python
def format_sse(event: dict) -> str:
    payload = {
        "id": event["id"],
        "job_id": event["job_id"],
        "status": event["status"],
        "step": event.get("step"),
        "step_index": event.get("step_index"),
        "step_total": event.get("step_total"),
        "message": event["message"],
        "payload": event.get("payload", {}),
        "timestamp": event["created_at"],
    }
    return f"id: {event['id']}\\nevent: {event['event_type']}\\ndata: {json.dumps(payload, ensure_ascii=False)}\\n\\n"
```

Implement `GET /orca/events` as a `StreamingResponse` generator:

- call `require_token(request)` before creating the stream;
- parse `job_id` and `Last-Event-ID` safely;
- return HTTP 404 before streaming if a supplied job id does not exist;
- poll `queue.events_since(job_id, after_id, limit=100)` every 0.5 seconds;
- yield `: heartbeat\\n\\n` after five seconds without data;
- update `after_id` after every yielded event;
- check `await request.is_disconnected()` between polls;
- close after a `job.completed` or `job.failed` event for a filtered job;
- set `media_type="text/event-stream"` and headers `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no`.

Do not use native `EventSource` server semantics that require query-string tokens.

### Step 5: Run API tests and verify green

Run:

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_api.py -q
.venv\Scripts\python.exe -m py_compile ui\main.py
```

### Step 6: Commit the API/SSE change

Suggested future commit:

```bat
git add ui/main.py ui/tests/test_orca_api.py
 git commit -m "feat(ui): expose smart command and replayable SSE jobs"
```

---

## Task 5: Connect the ArcRift Control Room to Real Jobs

**Files:**

- Modify: `ui/static/index.html`
- Modify: `ui/tests/control_room_test.py`

**Interfaces:**

- Consumes: `POST /orca/commands` and `GET /orca/events`.
- Produces: an accessible `#command-form`, `#command-input`, `#command-submit`, routing feedback, and a fetch-based SSE client that updates `#job-status-bar`.

### Step 1: Add failing browser checks

At the initial-load section of `control_room_test.py`, add checks for:

```python
check("command form da", page.locator("#command-form").count() == 1)
check("command input beschriftet", page.locator("#command-input").get_attribute("aria-label") == "Orchestra Command")
check("command submit da", page.locator("#command-submit").count() == 1)
```

In the token path, add a command-bar scenario that submits a short research/brainstorm command, waits for routing metadata, and asserts a real job id:

```python
page.locator("#command-input").fill("Gib mir eine kurze Tagesinspiration für mein AI-System")
page.locator("#command-submit").click()
page.wait_for_selector("#command-routing:not([hidden])", timeout=15000)
check("command: routing sichtbar", page.locator("#command-routing").inner_text().strip() != "")
check("command: job id sichtbar", page.locator("#job-status-meta").inner_text().contains("Job"))
```

The test must clean its created job directly through the temporary test database helper after the browser closes. Do not add a public destructive API solely for test cleanup.

Also assert no horizontal overflow at the existing mobile viewport step and include the new controls in the console-error check.

### Step 2: Run the browser test and verify red

Start the existing test server workflow first:

```bat
cd /d C:\OmniRoute\voice-agents\ui\tests
cmd /c run_ui_test.cmd 20139
```

Then run the browser script against the server in a separate terminal:

```bat
set UI_BASE=http://127.0.0.1:20139/
C:\OmniRoute\voice-agents\.venv\Scripts\python.exe C:\OmniRoute\voice-agents\ui\tests\control_room_test.py
```

Expected result: the new command-form checks fail because the elements and handlers do not exist.

### Step 3: Add the command bar markup and styles

Insert the form into the existing `.floating-header` without changing the ArcRift graph/sidebar structure:

```html
<form id="command-form" class="command-form" aria-label="Orchestra Command">
  <label class="visually-hidden" for="command-input">Orchestra Command</label>
  <input
    id="command-input"
    name="command"
    autocomplete="off"
    placeholder="Tell the orchestra what to do..."
    aria-label="Orchestra Command"
    required
  />
  <button id="command-submit" class="primary-btn" type="submit">Run</button>
</form>
<div id="command-routing" class="command-routing" aria-live="polite" hidden></div>
```

Add responsive styles that preserve the current desktop header and collapse to a full-width row on narrow screens. Keep the existing color tokens, focus outlines, reduced-motion behavior, and minimum touch target sizes.

### Step 4: Implement the fetch-based SSE client

Add state fields:

```javascript
activeJobId: null,
activeJobController: null,
lastEventId: 0,
```

Implement `submitCommand(event)`:

1. prevent default and reject empty text;
2. disable the submit button and set status text to `Routing command...`;
3. call `postJson('/orca/commands', { text })`;
4. render skill, confidence, and reason in `#command-routing` using `textContent` or escaped HTML;
5. set the active job id and call `connectJobEvents(job.id)`;
6. re-enable the form after terminal event or error.

Implement `connectJobEvents(jobId)` with `fetch()` and a `ReadableStream` parser:

- send `X-Access-Token` and `Accept: text/event-stream` headers;
- send `Last-Event-ID` after the first connection;
- parse CRLF/LF-delimited SSE frames into `id`, `event`, and `data` fields;
- call `applyJobEvent(eventName, parsedData)` for each complete frame;
- reconnect with delays of 500ms, 1000ms, and 2000ms after transient disconnects;
- stop reconnecting after `job.completed`, `job.failed`, a 401, or a 404;
- abort any previous job stream before tracking a new job.

Implement `applyJobEvent` so the status bar shows:

```text
<skill> · <status>
Step <step_index>/<step_total> · <message>
Job <job_id>
```

For `job.completed`, show the result for at least three seconds, call `loadMemory()` and `loadHealth()`, then allow a new command. For `job.failed`, show the error message and retain the job id for trace inspection.

### Step 5: Run browser tests and verify green

Run the same server and browser commands. Expected result: all new command-form, routing, job-id, responsive, and no-error checks pass along with the existing suite.

Then run the full wrapper:

```bat
cd /d C:\OmniRoute\voice-agents
.venv\Scripts\python.exe -m pytest ui/tests/test_control_room.py -m ui -v
```

### Step 6: Commit the Control Room integration

Suggested future commit:

```bat
git add ui/static/index.html ui/tests/control_room_test.py
 git commit -m "feat(ui): connect orchestra command bar to live jobs"
```

---

## Task 6: Build the Health-Aware Productive Stack Launcher

**Files:**

- Create: `orca/service_health.py`
- Create: `scripts/stack_orchestrator.py`
- Modify: `start-stack.cmd`
- Modify: `status.cmd`
- Create: `ui/tests/test_service_health.py`

**Interfaces:**

- Consumes: existing service paths, ports, Docker compose files, `start.cmd`, `run-ui.cmd`, `run-voicebox.cmd`, and `run-comfyui.cmd`.
- Produces:
  - `ServiceSpec` with `name`, `endpoint`, `required`, `companion`, `start_command`, `cwd`, and `timeout_seconds`.
  - `probe_service(spec, timeout=None) -> dict`.
  - `probe_all(timeout=None) -> list[dict]`.
  - `scripts/stack_orchestrator.py --status [--json]`.
  - `scripts/stack_orchestrator.py --start [--json]`.
  - `scripts/stack_orchestrator.py --dry-run [--json]`.

### Step 1: Write failing service-health tests

Use a local `http.server` fixture for healthy HTTP probes and an unused local port for failed probes:

```python

def test_http_probe_reports_healthy(local_http_server):
    spec = ServiceSpec(
        name="test",
        endpoint=local_http_server,
        required=True,
        companion=False,
        start_command=None,
        cwd=None,
        timeout_seconds=1,
    )
    result = probe_service(spec)
    assert result["status"] == "healthy"
    assert result["required"] is True


def test_unreachable_probe_reports_failed():
    spec = ServiceSpec(
        name="missing",
        endpoint="http://127.0.0.1:1/health",
        required=True,
        companion=False,
        start_command=None,
        cwd=None,
        timeout_seconds=0.1,
    )
    result = probe_service(spec)
    assert result["status"] in {"failed", "timeout"}


def test_service_specs_include_productive_stack():
    names = {spec.name for spec in service_specs()}
    assert {"omniroute", "control-room", "ollama", "comfyui", "voicebox", "livekit"} <= names
```

### Step 2: Run service-health tests and verify red

Run:

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_service_health.py -q
```

Expected result: failure because the service-health module and orchestrator do not exist.

### Step 3: Implement the shared service specification and probes

In `orca/service_health.py`:

- Use a frozen dataclass for `ServiceSpec`.
- Use `urllib.request` or `httpx` with a bounded timeout for HTTP endpoints.
- Treat HTTP status `< 500` as reachable for services whose root endpoint returns 404, but use the defined health route wherever available.
- Use a TCP socket probe only for LiveKit/Agent-Worker where no stable HTTP health route is guaranteed.
- Never include API keys or response bodies in the result.
- Return dictionaries shaped as:

```json
{
  "name": "comfyui",
  "status": "healthy",
  "required": true,
  "companion": false,
  "endpoint": "http://127.0.0.1:8188/system_stats",
  "detail": "HTTP 200"
}
```

Define the product scope exactly as the Spec: OmniRoute, Control Room, LiveKit, Redis, Agent worker, Kokoro, Kokoro-DE, Voicebox, Ollama, ComfyUI, Agents Playground, and opencode Web. Mark Playground and opencode Web as companions.

### Step 4: Implement idempotent start orchestration

In `scripts/stack_orchestrator.py`:

- Resolve `C:\OmniRoute` and `C:\OmniRoute\voice-agents` from the script location, with an environment override `OMNIROUTE_ROOT`.
- For each service, probe first.
- If healthy, report `healthy` and do not start it.
- If missing and a start command exists, spawn it detached with its configured working directory, then poll until healthy or timeout.
- Use the existing start commands and paths:
  - gateway: `C:\OmniRoute\start.cmd`
  - Control Room: `ui\run-ui.cmd`
  - Docker services: `docker compose up -d` in `voice-agents\docker`
  - Kokoro-DE: `docker compose up -d --build kokoro-onnx` in `repos\kokoro-german`
  - Agent worker: `.venv\Scripts\python.exe agents\starter_agent.py start`
  - Voicebox: `ui\run-voicebox.cmd`
  - Ollama: `ollama serve`
  - ComfyUI: `ui\run-comfyui.cmd`
  - Playground: `npm.cmd run dev -- -p 3000` in `agents-playground`
  - opencode Web: existing `C:\scripts\run_opencode_web.cmd` if present, otherwise the documented `opencode web --port 4096 --hostname 0.0.0.0` command.
- On Windows, use detached process flags and separate log files under `voice-agents\logs\stack`.
- Continue checking every service after a timeout. Exit nonzero only if at least one required service is not healthy; companion failures print warnings and do not change the exit code.
- `--dry-run` prints the intended actions without spawning anything.

### Step 5: Make the CMD wrappers use the orchestrator

Replace the duplicated port-only body of `start-stack.cmd` with a UTF-8/CRLF-safe wrapper:

```bat
@echo off
setlocal
cd /d C:\OmniRoute\voice-agents
C:\OmniRoute\voice-agents\.venv\Scripts\python.exe scripts\stack_orchestrator.py --start
set EXITCODE=%ERRORLEVEL%
echo.
echo  Detailed status: status.cmd
endlocal & exit /b %EXITCODE%
```

Update `status.cmd` to call `scripts\stack_orchestrator.py --status --json` through a readable PowerShell formatter, while preserving the existing human-readable service list and Tailscale URLs.

### Step 6: Run service tests and launcher dry-run

Run:

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_service_health.py -q
.venv\Scripts\python.exe scripts\stack_orchestrator.py --dry-run --json
cmd /c start-stack.cmd
cmd /c status.cmd
```

Confirm that healthy existing processes remain running, missing services receive start attempts, and the final report distinguishes core failures from companion warnings.

### Step 7: Commit the launcher change

Suggested future commit:

```bat
git add orca/service_health.py scripts/stack_orchestrator.py start-stack.cmd status.cmd ui/tests/test_service_health.py
git commit -m "feat(runtime): make stack startup health-aware"
```

---

## Task 7: Full Verification, Browser Audit, and Documentation

**Files:**

- Modify: `docs/superpowers/specs/2026-08-25-orchestra-control-room-v1-design.md` status line if implementation is complete.
- Modify: `memory/status.md`
- Modify: `ui/tests/control_room_test.py` only for final regression fixes discovered by the test run.

**Interfaces:**

- Consumes: all implementation outputs from Tasks 1–6.
- Produces: green backend tests, green Control Room browser suite, health-aware stack report, and updated durable project memory.

### Step 1: Run all focused backend tests

```bat
cd /d C:\OmniRoute\voice-agents
.venv\Scripts\python.exe -m pytest ui/tests/test_orca_queue_events.py ui/tests/test_orca_routing.py ui/tests/test_orca_worker_events.py ui/tests/test_orca_api.py ui/tests/test_service_health.py -q
```

Expected result: all focused tests pass with no unhandled warnings.

### Step 2: Run static Python checks

```bat
.venv\Scripts\python.exe -m py_compile orca\queue.py orca\routing.py orca\skills.py orca\worker.py orca\service_health.py ui\main.py scripts\stack_orchestrator.py
```

### Step 3: Run the isolated Control Room browser suite

Use the existing orphan-safe runner:

```bat
cmd /c ui\tests\run_ui_test.cmd 20139
set UI_BASE=http://127.0.0.1:20139/
.venv\Scripts\python.exe ui\tests\control_room_test.py
```

Expected result: all previous graph, approval, handoff, PWA, mobile, keyboard, and token-path checks pass, plus command-bar routing and live job-status checks. Ensure test jobs are removed from the temporary test database and the production board remains unchanged.

### Step 4: Run the pytest wrapper

```bat
.venv\Scripts\python.exe -m pytest ui/tests/test_control_room.py -m ui -v
```

### Step 5: Use agent-browser for live visual and accessibility verification

Use an isolated named session and the current CLI workflow:

```bash
export AGENT_BROWSER_SESSION="$(npx --yes agent-browser session id --scope worktree --prefix orchestra-v1)"
npx --yes agent-browser --session "$AGENT_BROWSER_SESSION" --restore open http://127.0.0.1:20129/
npx --yes agent-browser --session "$AGENT_BROWSER_SESSION" snapshot -i
npx --yes agent-browser --session "$AGENT_BROWSER_SESSION" screenshot control-room-v1.png
npx --yes agent-browser --session "$AGENT_BROWSER_SESSION" a11y --tags wcag2a,wcag2aa --json
```

Verify from the snapshot and screenshot:

- command input and Run button are visible;
- routing feedback appears after a command submission;
- status bar displays the actual skill, step, and job id;
- the ArcRift graph/sidebar remain visually intact;
- mobile layout remains usable;
- no new accessibility violations are introduced.

Close the isolated browser session after verification:

```bash
npx --yes agent-browser --session "$AGENT_BROWSER_SESSION" close
```

### Step 6: Update durable memory

Add a dated status entry to `memory/status.md` containing:

- the implementation plan path;
- final endpoint names `/orca/commands` and `/orca/events`;
- event persistence in `data/jobs.db`;
- final backend/browser test counts;
- stack launcher behavior and any services that remain unavailable;
- whether SSE replay was verified.

Never write tokens, OAuth secrets, or raw credentials into memory.

### Step 7: Final implementation review

Check:

```bat
git -C C:\OmniRoute\voice-agents diff --check
git -C C:\OmniRoute\voice-agents status --short
```

Review only files belonging to this feature. Keep generated media, virtual environments, logs, cache directories, screenshots, and credentials out of the source commit.

Suggested future final commit:

```bat
git add orca/queue.py orca/routing.py orca/skills.py orca/worker.py orca/service_health.py scripts/stack_orchestrator.py start-stack.cmd status.cmd ui/main.py ui/static/index.html ui/tests docs/superpowers/specs/2026-08-25-orchestra-control-room-v1-design.md docs/superpowers/plans/2026-08-25-orchestra-control-room-v1.md memory/status.md
 git commit -m "feat(orchestra): connect command routing to live job operations"
```

---

## Self-Review Checklist

- [x] Every approved Spec section maps to at least one implementation task.
- [x] Queue event creation, replay, filtering, and cleanup have concrete tests.
- [x] Routing has exact deterministic examples and fallback behavior.
- [x] Worker progress and terminal event ordering are explicit.
- [x] SSE authentication, replay, heartbeat, reconnect, and terminal close are explicit.
- [x] UI selectors, event parser behavior, and browser assertions are explicit.
- [x] Service scope, health states, start commands, and exit semantics are explicit.
- [x] Test commands use the repository's existing Windows venv and test runner.
- [x] No production implementation is requested before a failing test.
- [x] No credentials are included.
- [x] No placeholder tasks or vague error-handling instructions remain.
- [x] The plan keeps Android, voice wake-word, public publishing, and LLM routing out of v1.
