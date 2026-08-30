# Orchestra Control Room v1 Design

**Status:** Implemented and verified
**Date:** 2026-08-25
**Scope:** OmniRoute Personal-AI Control Room and its local runtime services

## Goal

Turn the Control Room from a read-only operational view into a reliable production operator: start the local AI stack, submit a natural-language command, route it to a real skill, follow the job live, and recover the trace after reload or network interruption.

## Decisions

- The live transport is Server-Sent Events (SSE).
- Job events are persisted in the existing SQLite queue database.
- The command bar uses deterministic Smart Route matching over registered skill metadata.
- Unknown or ambiguous commands fall back to `daily-brainstorm` and expose the routing reason.
- The productive stack is the default one-click start scope.
- Existing queue, worker, skill, and startup entrypoints remain the source of truth; no second job queue is introduced.
- External publishing remains safe by default: YouTube jobs use `unlisted` unless an explicit later approval gate permits `public`.

## Existing Boundaries

The implementation builds on these current components:

- `orca/queue.py`: SQLite-backed jobs in `data/jobs.db`.
- `orca/worker.py`: asynchronous polling worker that executes one queued job at a time.
- `orca/skills.py`: Markdown skill registry and pipeline runner.
- `ui/main.py`: FastAPI Control Room backend on port 20129.
- `ui/static/index.html`: vanilla JavaScript ArcRift-style graph UI.
- `start-stack.cmd`: Windows stack launcher.
- `status.cmd`: Windows port status display.

The current `/orca/jobs` endpoint remains compatible. The new command endpoint is an additional route.

## Architecture

```text
Natural-language command
        |
        v
POST /orca/commands
        |
        +--> Smart Route over skills/*.md
        |
        +--> SQLite jobs row
        |       |
        |       +--> worker executes skill pipeline
        |               |
        |               +--> SQLite job_events rows
        |
        +--> response: job id + routing metadata
                    |
                    v
       authenticated fetch-based SSE /orca/events
                    |
                    v
       Command status bar, trace, graph, health refresh
```

## Service Lifecycle

`start-stack.cmd` becomes the idempotent productive launcher. It keeps already healthy processes and starts only missing services.

### Productive service scope

| Service           | Default endpoint or check            | Required state               |
| ----------------- | ------------------------------------ | ---------------------------- |
| OmniRoute gateway | `http://127.0.0.1:20128/v1/models`   | Core                         |
| Control Room API  | `http://127.0.0.1:20129/health`      | Core                         |
| LiveKit server    | TCP 7880 and Docker container        | Core for voice               |
| Redis             | Docker compose dependency            | Core for LiveKit             |
| Agent worker      | TCP 8081                             | Core for voice agents        |
| Kokoro TTS        | TCP 8880 plus existing API route     | Core for voice               |
| Kokoro-DE         | TCP 8881 plus existing API route     | Core for German TTS          |
| Voicebox          | TCP 17493 or process health          | Core for Money Printer voice |
| Ollama            | `http://127.0.0.1:11434/api/tags`    | Core for local generation    |
| ComfyUI           | `http://127.0.0.1:8188/system_stats` | Core for visual production   |
| Agents Playground | TCP 3000                             | Companion                    |
| opencode Web      | TCP 4096                             | Companion                    |

The launcher reports one of `healthy`, `started`, `degraded`, `timeout`, or `failed` for each service. Core failures are visible and cause a non-zero launcher exit after all checks finish. Companion failures are warnings and do not prevent the rest of the stack from being reported.

Each service has one explicit start command, a bounded readiness timeout, and a health probe. Port-open alone is not considered healthy. The launcher never kills a process that already passes its health probe.

## Command Routing

### Command endpoint

```http
POST /orca/commands
X-Access-Token: <token>
Content-Type: application/json

{"text":"Erstelle einen deutschen Short über den Hamburger Hafen"}
```

Success response:

```json
{
  "ok": true,
  "job": {
    "id": "abc123",
    "skill": "tiktok-video-producer",
    "status": "queued",
    "trigger": "command-bar"
  },
  "routing": {
    "skill": "tiktok-video-producer",
    "confidence": 0.92,
    "reason": "video, short und produzieren passen zur Skillbeschreibung"
  }
}
```

The endpoint rejects an empty command with HTTP 400 and requires the existing UI token when token authentication is configured.

### Smart Route algorithm

1. Load registered skills through `skills.list_skills()`.
2. Build a matching text for each skill from its name, description, aliases, and pipeline types.
3. Normalize the command and matching text to lowercase tokens; remove punctuation and German stop words.
4. Score exact skill-name tokens, aliases, description terms, and pipeline terms with deterministic weights.
5. Select the highest score only when it is above the minimum threshold and ahead of the second result by the configured margin.
6. Otherwise select `daily-brainstorm`.
7. Return `skill`, `confidence`, and a human-readable `reason`; persist the routing data with the job input/metadata.

The router is deterministic and does not add an LLM round trip. It is safe to test offline and can later be replaced behind the same `route_command(text) -> RoutingDecision` interface.

Minimum routing examples:

- `Short`, `TikTok`, `Video`, `produzieren` -> `tiktok-video-producer`.
- `Kanal`, `Nische`, `Reichweite`, `Konzept` -> `tiktok-concept`.
- `recherchiere`, `Quellen`, `Wettbewerber` -> `research`.
- `hochladen`, `YouTube`, `Short veröffentlichen` -> `youtube-upload`.
- unmatched or ambiguous text -> `daily-brainstorm`.

## Persistent Job Events

The existing `jobs` table is extended with an event table in the same SQLite database:

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

Event types:

- `job.created`
- `job.started`
- `job.step.started`
- `job.step.completed`
- `job.completed`
- `job.failed`

`queue.create_job(...)` writes the job row and its initial `job.created` event in one SQLite transaction. `queue.append_event(...)` writes later events atomically with their timestamp. `queue.events_since(job_id, after_id, limit)` returns ordered rows and never exposes another job's events when a job filter is supplied.

The queue emits `job.created` during transactional insertion. The worker emits:

```text
job.started          before skill execution
job.step.started     before each pipeline step
job.step.completed   after a pipeline step returns
job.completed        after the final result is stored
job.failed           after an exception or missing skill
```

`step_index` is one-based and `step_total` is the pipeline length. A step that cannot provide measurable sub-progress still emits start/completed events; the UI must not invent fake percentages.

The queue keeps the current job columns (`status`, `started_at`, `finished_at`, `result`, `error`) as the authoritative summary. Events are the append-only timeline and replay source.

## Worker Progress Contract

`skills.run_skill` accepts an optional progress callback. The callback receives a dictionary with:

```python
{
    "step": "media-image",
    "step_index": 3,
    "step_total": 5,
    "message": "ComfyUI erzeugt 3 Szenen"
}
```

The callback is optional so scheduled jobs and existing callers stay compatible. `worker.process_one` supplies a callback that writes `job.step.started` before a step and `job.step.completed` after it. The callback must not allow a progress-write failure to erase the actual job result; event errors are logged in the worker and the job continues.

## SSE Contract

```http
GET /orca/events?job_id=abc123
X-Access-Token: <token>
Accept: text/event-stream
Last-Event-ID: 17
```

Each response event uses standard SSE framing:

```text
id: 18
event: job.step.completed
data: {"job_id":"abc123","status":"running","step":"media-voice","step_index":2,"step_total":5,"message":"Voicebox fertig","timestamp":"..."}

```

The endpoint:

- validates the same UI token as other job endpoints;
- accepts an optional `job_id` filter;
- replays rows after `Last-Event-ID`;
- polls SQLite at a bounded interval while the connection is open;
- sends a comment heartbeat when no event is available;
- closes after the matching job reaches `done` or `failed` and its terminal event has been sent;
- never places the token in a URL or event payload.

The browser uses `fetch()` and `ReadableStream` because native `EventSource` cannot send the required `X-Access-Token` header. The client parses `id`, `event`, and `data` frames, stores the last event id per active job, and reconnects after transient errors with a bounded backoff.

## Control Room UX

A command form is visible in the main Control Room header and remains usable on mobile:

```text
[ Command input ................................ ] [Run]
```

Submitting it:

1. disables duplicate submission while the request is pending;
2. calls `POST /orca/commands`;
3. displays the selected skill, confidence, and reason;
4. opens the job-specific SSE stream;
5. updates the status bar with real step information;
6. refreshes `/orca/jobs/{id}`, `/memory`, and `/health` after terminal completion;
7. keeps a failed job's error available in the trace and error banner.

The status bar shows the skill, current status, step position, message, and job id. It is hidden only when no tracked job is active. The graph may reload after completion, but the visual graph remains read-only; job execution is driven by the command form and API.

## Error and Recovery Rules

- Empty command: HTTP 400 and inline validation.
- Missing routed skill: safe fallback to `daily-brainstorm` if available; otherwise HTTP 503.
- Worker exception: persist `failed`, terminal event, and error text capped for the UI.
- SSE disconnect: reconnect with the latest received event id.
- Browser reload: fetch current job detail and replay stored events.
- Core service timeout: report failure after all service probes complete.
- Companion service timeout: report warning and continue.
- Token failure: show authenticated error without retry loops.
- Event persistence failure: retain job execution outcome and expose a backend log message; do not mark a successful job failed solely because an event write failed.

## Security and Side Effects

- Existing token and network checks apply to `/orca/commands` and `/orca/events`.
- Command text is stored as job input and is not executed as shell text by the router.
- Smart Route never grants permissions and never bypasses approval gates.
- The first version must not default YouTube publication to `public`; `unlisted` remains the safe default.
- Logs and SSE payloads must not contain access tokens or credential values.

## Testing

Backend tests cover:

- event table creation and ordered replay;
- job creation emitting `job.created`;
- worker terminal events for success and failure;
- step callback events and step counts;
- deterministic routing examples and fallback;
- authenticated command creation;
- SSE replay from `Last-Event-ID`;
- SSE terminal close behavior.

Browser tests cover:

- command form is visible and accessible;
- submitting a command creates a real queue job;
- routing metadata and job id appear;
- live status text changes from queued/running to done or failed;
- no duplicate submission occurs;
- reload can recover the active job trace;
- mobile viewport has no horizontal overflow;
- no page or console errors.

The service launcher is tested in dry-run/health-report mode and against the currently available local endpoints without stopping healthy services.

## Out of Scope for v1

- Native Android implementation.
- Wake-word and continuous microphone capture.
- Bidirectional WebSocket voice protocol.
- Automatic public publication without approval.
- Replacing the SQLite queue with another database.
- LLM-based routing as the default path.
- Full Coach/Lean analytics.
