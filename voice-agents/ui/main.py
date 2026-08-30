import base64
import ipaddress
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from orca import queue, routing, skills, worker as orca_worker
from orca.scheduler import run_scheduled_jobs

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
INBOX_DIR = PROJECT_DIR / "data" / "inbox"
LEDGER_DIR = PROJECT_DIR / "data" / "ledger"
STATIC_DIR = BASE_DIR / "static"
STATUS_FILE = PROJECT_DIR / "data" / "status.json"

load_dotenv(PROJECT_DIR / ".env")

UI_ACCESS_TOKEN = os.getenv("UI_ACCESS_TOKEN", "")
CONTINUUM_ARTIFACTS = os.getenv("CONTINUUM_ARTIFACTS_REGISTRY", r"C:\OmniRoute\repos\continuum\data\artifacts\registry.json")
OMNIROUTE_BASE_URL = os.getenv("OMNIROUTE_BASE_URL", "http://localhost:20128/v1")
OMNIROUTE_API_KEY = os.getenv("OMNIROUTE_API_KEY", "")
OMNIROUTE_MODEL = os.getenv("OMNIROUTE_MODEL", "auto/best-chat")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")

ALLOWED_NETS_RAW = os.getenv("ALLOWED_NETS", "")
try:
    ALLOWED_NETS = [ipaddress.ip_network(n.strip()) for n in ALLOWED_NETS_RAW.split(",") if n.strip()]
except ValueError:
    ALLOWED_NETS = []


def no_cache(data: dict) -> JSONResponse:
    """JSON-Antwort ohne HTTP-Caching (Live-Daten wie Graph/Kanban/Jobs)."""
    resp = JSONResponse(data)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp


def ip_allowed(ip_str: str | None) -> bool:
    if not ALLOWED_NETS:
        return True
    if not ip_str:
        return False
    try:
        host = ipaddress.ip_address(ip_str.split(":")[0])
    except ValueError:
        return False
    return any(host in net for net in ALLOWED_NETS)

app = FastAPI(title="OmniRoute PWA UI", version="0.1.0")


@app.on_event("startup")
async def _start_bg_tasks():
    import asyncio

    asyncio.create_task(orca_worker.worker_loop(OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY, OMNIROUTE_MODEL))
    asyncio.create_task(run_scheduled_jobs(interval_seconds=60))

for d in (INBOX_DIR, LEDGER_DIR, STATUS_FILE.parent):
    d.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_token(request: Request) -> str:
    if not ip_allowed(request.client.host if request.client else None):
        raise HTTPException(status_code=403, detail="access denied for this network")
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        token = request.headers.get("X-Access-Token", "").strip()
    if not token:
        token = request.query_params.get("access_token", "")
    if UI_ACCESS_TOKEN and token != UI_ACCESS_TOKEN:
        raise HTTPException(status_code=401, detail="invalid access token")
    return token


def ledger_read() -> list[dict]:
    """Liest alle Ledger-Einträge aus data/ledger/<datum>.jsonl (neueste zuerst)."""
    entries: list[dict] = []
    for path in sorted(LEDGER_DIR.glob("*.jsonl"), reverse=True):
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def ledger_income_add(payload: dict) -> None:
    record = {
        "ts": now_iso(),
        "type": "income",
        "kind": "manual",
        "amount": float(payload.get("amount", 0)),
        "currency": payload.get("currency", "EUR"),
        "note": str(payload.get("note", "")).strip(),
        "category": str(payload.get("category", "income")).strip() or "income",
    }
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = LEDGER_DIR / f"{day}.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def ledger(entry_type: str, payload: dict) -> None:
    record = {
        "ts": now_iso(),
        "type": entry_type,
        "kind": "ui",
        **payload,
    }
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = LEDGER_DIR / f"{day}.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


async def ask_llm(prompt: str, context: str = "") -> str:
    messages = [{"role": "system", "content": "Du bist der persönliche Assistent von Sebastian. Antworte auf Deutsch, präzise und hilfreich."}]
    if context:
        messages.append({"role": "user", "content": context})
    messages.append({"role": "user", "content": prompt})
    payload = {
        "model": OMNIROUTE_MODEL,
        "messages": messages,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {OMNIROUTE_API_KEY}"}
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{OMNIROUTE_BASE_URL}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def describe_image(path: Path, user_text: str = "") -> str | None:
    img = path.read_bytes()
    if len(img) > 20 * 1024 * 1024:
        return None
    prompt = "Beschreibe den Inhalt dieses Bildes auf Deutsch, kurz und praezise. Maximal 4 Saetze."
    if user_text.strip():
        prompt = f"Kontext des Nutzers: {user_text.strip()}." + prompt

    headers = {"Authorization": f"Bearer {OMNIROUTE_API_KEY}"}

    if GOOGLE_API_KEY:
        try:
            gemini_payload = {
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png", "data": base64.b64encode(img).decode()}},
                    ]
                }]
            }
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
                    params={"key": GOOGLE_API_KEY},
                    json=gemini_payload,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    return text.strip()
        except Exception:
            pass

    kind = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{kind};base64," + base64.b64encode(img).decode()}},
        ],
    }]
    payload = {"model": OMNIROUTE_MODEL, "messages": messages, "stream": False}
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{OMNIROUTE_BASE_URL}/chat/completions", json=payload, headers=headers)
            if resp.status_code != 200:
                return None
            return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return None


@app.get("/health")
async def health():
    from orca import kanban, queue
    try:
        cards = kanban.list_cards()
    except Exception:
        cards = []
    counts = queue.counts()
    return no_cache({
        "status": "ok",
        "service": "omniroute-ui",
        "ts": now_iso(),
        "storageMode": "files",
        "sessionCount": len(cards),
        "graphBackend": "omniroute-local",
        "jobQueue": {
            "pending": counts.get("queued", 0),
            "processing": counts.get("running", 0),
            "failed": counts.get("failed", 0),
            "deadLettered": 0,
        },
        "ollama": {"reachable": False, "model": ""},
    })


@app.get("/memory")
async def memory_graph(request: Request):
    """ArcRift-kompatibler Memory-Layer: Sessions, Wissensgraph (Nodes/Links), Facts (Triples), Chat."""
    require_token(request)
    from orca import kanban, skills as skills_mod

    try:
        cards = kanban.list_cards()
    except Exception:
        cards = []
    try:
        job_list = queue.list_jobs(60)
    except Exception:
        job_list = []
    try:
        skill_defs = skills_mod.list_skills()
    except Exception:
        skill_defs = {}
    try:
        artifacts = json.loads(Path(CONTINUUM_ARTIFACTS).read_text(encoding="utf-8")) if Path(CONTINUUM_ARTIFACTS).exists() else []
    except Exception:
        artifacts = []
    try:
        agent_file = json.loads(STATUS_FILE.read_text(encoding="utf-8")) if STATUS_FILE.exists() else {}
    except Exception:
        agent_file = {}

    nodes: list[dict] = []
    links: list[dict] = []
    triples: list[dict] = []
    node_ids: set[str] = set()

    def add_node(nid: str, ntype: str, meta: dict | None = None) -> None:
        if nid in node_ids:
            return
        node_ids.add(nid)
        node = {"id": nid, "type": ntype, **(meta or {})}
        nodes.append(node)

    def add_link(source: str, target: str, relation: str, timestamp: str = "") -> None:
        if source == target or source not in node_ids or target not in node_ids:
            return
        links.append({"source": source, "target": target, "relation": relation, "timestamp": timestamp})

    def add_triple(subject: str, subject_type: str, relation: str, obj: str, object_type: str, timestamp: str = "") -> None:
        triples.append({"subject": subject, "subjectType": subject_type, "relation": relation, "object": obj, "objectType": object_type, "timestamp": timestamp})

    now = now_iso()
    add_node("Sebastian", "Person", {"firstSeen": now})
    add_node("Windows workstation", "Device", {"firstSeen": now})
    add_node("Android / redmi-note-14", "Device", {"firstSeen": now})
    add_link("Sebastian", "Windows workstation", "operates")
    add_link("Sebastian", "Android / redmi-note-14", "carries")

    for agent_name, info in agent_file.items():
        add_node(agent_name, "Agent", {
            "firstSeen": info.get("last_seen", ""),
            "status": "stale" if info.get("stale") else "ok",
            "last_seen": info.get("last_seen", ""),
            "detail": info.get("detail", ""),
        })
        add_link("Sebastian", agent_name, "delegates")
        add_triple(agent_name, "Agent", "status", "stale" if info.get("stale") else "ok", "Status", info.get("last_seen", ""))

    for skill_name, skill in skill_defs.items():
        add_node(skill_name, "Skill", {
            "firstSeen": now,
            "description": skill.get("description", ""),
            "model": skill.get("model", ""),
            "pipeline": len(skill.get("pipeline", []) or []),
        })
        add_link("Sebastian", skill_name, "uses")
        if skill.get("description"):
            add_triple(skill_name, "Skill", "beschreibt", skill["description"][:120], "Note", now)

    # Money-Maker-Pipeline: Handoff-Kanten zwischen den verfügbaren Skills
    pipeline_handoffs = [
        ("research", "tiktok-concept", "research → concept"),
        ("tiktok-concept", "tiktok-video-producer", "concept → produzieren"),
        ("tiktok-video-producer", "youtube-upload", "produzieren → publizieren"),
    ]
    for src, tgt, rel in pipeline_handoffs:
        if src in node_ids and tgt in node_ids:
            add_link(src, tgt, "handoff")
            add_triple(src, "Skill", "handoff", tgt, "Skill", now)

    for job in job_list:
        jid = job.get("id", "")[:12]
        skill = job.get("skill", "")
        result_preview = ""
        if job.get("result"):
            try:
                parsed = json.loads(job["result"])
                result_preview = str(parsed.get("response", ""))[:200]
            except (json.JSONDecodeError, AttributeError):
                result_preview = str(job.get("result", ""))[:200]
        add_node(jid, "Job", {
            "firstSeen": job.get("created_at", ""),
            "full_id": job.get("id", ""),
            "skill": skill,
            "status": job.get("status", ""),
            "trigger": job.get("trigger", ""),
            "created_at": job.get("created_at", ""),
            "finished_at": job.get("finished_at", ""),
            "result": result_preview,
        })
        add_node(skill, "Skill") if skill else None
        add_link(jid, skill, "ran") if skill else None
        add_triple(jid, "Job", "skill", skill, "Skill", job.get("created_at", ""))
        add_triple(jid, "Job", "status", job.get("status", ""), "Status", job.get("finished_at", job.get("created_at", "")))
        add_link("Sebastian", jid, "ordered") if job.get("trigger") == "pwa" else None

    for artifact in artifacts:
        aid = artifact.get("artifactId", "")[:12]
        atype = artifact.get("type", "file")
        add_node(aid, "Artifact", {
            "firstSeen": artifact.get("createdAt", ""),
            "artifact_type": atype,
            "source": artifact.get("source", ""),
            "tags": artifact.get("tags", []),
            "createdAt": artifact.get("createdAt", ""),
        })
        add_triple(aid, "Artifact", "typ", atype, "Type", artifact.get("createdAt", ""))
        for tag in artifact.get("tags", [])[:3]:
            add_node(tag, "Tag", {"firstSeen": now})
            add_link(aid, tag, "tagged")

    for card in cards:
        cid = card.get("id", "")[:12]
        column = card.get("column", "todo")
        add_node(cid, "Task", {
            "firstSeen": card.get("created", ""),
            "full_id": card.get("id", ""),
            "title": card.get("title", ""),
            "column": column,
            "source": card.get("source", ""),
            "note": card.get("note", ""),
            "created": card.get("created", ""),
            "updated": card.get("updated", ""),
        })
        add_node(column, "Status", {"firstSeen": now})
        add_link(cid, column, "status")
        add_triple(card.get("title", cid)[:80], "Task", "status", column, "Status", card.get("updated", ""))
        source = card.get("source", "")
        if source:
            add_node(source, "Platform", {"firstSeen": now})
            add_link(cid, source, "source")

    sessions = [{"_id": "omniroute", "projectName": "OmniRoute Memory", "platform": "local", "tripleCount": len(triples), "updatedAt": now}]
    for card in cards:
        sessions.append({
            "_id": card.get("id", "")[:12],
            "projectName": card.get("title", "Karte")[:60],
            "platform": card.get("source", "kanban"),
            "tripleCount": 1,
            "updatedAt": card.get("updated", now),
        })

    chat_parts: list[str] = []
    for job in job_list[:30]:
        try:
            inp = json.loads(job.get("input", "{}"))
            user_text = inp.get("text", "").strip()
        except Exception:
            user_text = ""
        if user_text:
            chat_parts.append(f"[User]: {user_text}")
        try:
            res = json.loads(job.get("result", "{}"))
            resp_text = res.get("response", "").strip()
        except Exception:
            resp_text = ""
        if resp_text:
            chat_parts.append(f"[Assistant]: {resp_text}")

    return no_cache({
        "sessions": sessions,
        "nodes": nodes,
        "links": links,
        "triples": triples,
        "chat": {"rawText": "\n\n".join(chat_parts), "messageCount": len(chat_parts), "createdAt": now},
    })


@app.get("/memory/search")
async def memory_search(request: Request, q: str = ""):
    require_token(request)
    from orca import kanban, skills as skills_mod

    query = q.strip().lower()
    if len(query) < 3:
        return no_cache({"found": False, "chunks": [], "graphFacts": []})

    facts: list[dict] = []
    chunks: list[dict] = []
    try:
        cards = kanban.list_cards()
    except Exception:
        cards = []
    for card in cards:
        title = card.get("title", "")
        note = card.get("note", "")
        if query in title.lower() or query in note.lower():
            chunks.append({"projectName": title[:60], "content": note[:300] or title})
            facts.append({"subject": title[:80], "relation": "status", "object": card.get("column", "")})
    try:
        skill_defs = skills_mod.list_skills()
    except Exception:
        skill_defs = {}
    for skill_name, skill in skill_defs.items():
        if query in skill_name.lower() or query in str(skill.get("description", "")).lower():
            chunks.append({"projectName": skill_name, "content": str(skill.get("description", ""))[:300]})
            facts.append({"subject": skill_name, "relation": "beschreibt", "object": str(skill.get("description", ""))[:80]})
    try:
        job_list = queue.list_jobs(80)
    except Exception:
        job_list = []
    for job in job_list:
        skill = job.get("skill", "")
        if query in skill.lower():
            chunks.append({"projectName": job.get("id", "")[:12], "content": f"{skill} · {job.get('status', '')} · {job.get('created_at', '')[:10]}"})
            facts.append({"subject": job.get("id", "")[:12], "relation": "skill", "object": skill})
    try:
        artifacts = json.loads(Path(CONTINUUM_ARTIFACTS).read_text(encoding="utf-8")) if Path(CONTINUUM_ARTIFACTS).exists() else []
    except Exception:
        artifacts = []
    for artifact in artifacts:
        tags = " ".join(artifact.get("tags", []))
        if query in tags.lower():
            chunks.append({"projectName": artifact.get("artifactId", "")[:12], "content": f"{artifact.get('type', '')} · {artifact.get('source', '')}"})
    return no_cache({"found": bool(chunks or facts), "chunks": chunks[:30], "graphFacts": facts[:30]})


@app.post("/inbox")
async def upload_to_inbox(
    request: Request,
    file: UploadFile | None = File(default=None),
    mode: str = Form(default="photo"),
    text: str = Form(default=""),
):
    require_token(request)
    item_id = uuid.uuid4().hex[:12]
    message = None
    if text.strip() and mode == "text":
        content = text.strip()
        ledger("task", {"id": item_id, "mode": "text", "len": len(content)})
        message = await ask_llm(content)
        return {"item_id": item_id, "mode": "text", "ok": True, "message": message}

    if file is None:
        raise HTTPException(status_code=400, detail="no file and no text provided")

    safe_name = os.path.basename(file.filename or f"{item_id}.bin")
    ext = Path(safe_name).suffix.lower() or ".bin"
    target = INBOX_DIR / f"{item_id}{ext}"
    with target.open("wb") as f:
        while chunk := await file.read(1 << 20):
            f.write(chunk)
    size = target.stat().st_size

    message = None
    if mode in ("photo", "video") and ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"):
        message = await describe_image(target, text)
    if not message:
        prompt = f'Ein Nutzer hat eine Datei "{Path(safe_name).stem}" vom Typ "{mode}" hochgeladen (Modus: {mode}). Bitte beschreibe kurz, was das ist, und gib eine nuetzliche Antwort.'
        if text.strip():
            prompt += f" Kontext des Nutzers: {text.strip()}"
        message = await ask_llm(prompt)

    ledger("task", {"id": item_id, "mode": mode, "file": target.name, "bytes": size})
    return {
        "item_id": item_id,
        "mode": mode,
        "file": target.name,
        "bytes": size,
        "ok": True,
        "message": message,
    }


@app.get("/orca/status")
async def orca_status(request: Request):
    require_token(request)
    counts = queue.counts()
    queue_state = {**counts, "pending": counts.get("queued", 0)}
    return no_cache({
        "status": "running",
        "queue": queue_state,
        "running": [j for j in queue.list_jobs(20) if j["status"] == "running"],
        "recent": [j for j in queue.list_jobs(20) if j["status"] != "running"],
    })


@app.get("/orca/jobs")
async def orca_jobs(request: Request, limit: int = 50):
    require_token(request)
    return no_cache({"jobs": queue.list_jobs(limit)})


@app.post("/orca/commands")
async def orca_command(request: Request):
    require_token(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    if not isinstance(body, dict) or not str(body.get("text", "")).strip():
        raise HTTPException(status_code=400, detail="command text required")
    text = str(body["text"]).strip()
    decision = routing.route_command(text, skills.list_skills())
    if not skills.load_skill(decision.skill):
        raise HTTPException(status_code=503, detail="fallback skill daily-brainstorm not found")
    job = queue.create_job(decision.skill, {"text": text, "routing": {"skill": decision.skill, "confidence": decision.confidence, "reason": decision.reason, "matched_terms": list(decision.matched_terms)}}, trigger="command-bar")
    ledger("task", {"id": job["id"], "skill": decision.skill, "trigger": "command-bar"})
    return {"ok": True, "job": job, "routing": {"skill": decision.skill, "confidence": decision.confidence, "reason": decision.reason, "matched_terms": list(decision.matched_terms)}}


def format_sse(event: dict) -> str:
    payload = {"id": event["id"], "job_id": event["job_id"], "status": event["status"], "step": event.get("step"), "step_index": event.get("step_index"), "step_total": event.get("step_total"), "message": event["message"], "payload": event.get("payload", {}), "timestamp": event["created_at"]}
    return f"id: {event['id']}\nevent: {event['event_type']}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.get("/orca/events")
async def orca_events(request: Request, job_id: str | None = None):
    require_token(request)
    if job_id and not queue.job_by_id(job_id):
        raise HTTPException(status_code=404, detail="job not found")
    try:
        after_id = max(0, int(request.headers.get("Last-Event-ID", "0")))
    except ValueError:
        after_id = 0

    async def stream():
        import asyncio
        last_data = asyncio.get_event_loop().time()
        cursor = after_id
        while True:
            if await request.is_disconnected():
                break
            events = queue.events_since(job_id, after_id=cursor, limit=100)
            if events:
                for event in events:
                    cursor = event["id"]
                    yield format_sse(event)
                    if job_id and event["event_type"] in {"job.completed", "job.failed"}:
                        return
                last_data = asyncio.get_event_loop().time()
            elif asyncio.get_event_loop().time() - last_data >= 5:
                yield ": heartbeat\n\n"
                last_data = asyncio.get_event_loop().time()
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@app.post("/orca/jobs")
async def orca_create_job(request: Request, skill: str = Form(...), text: str = Form(default="")):
    require_token(request)
    if not skills.load_skill(skill):
        raise HTTPException(status_code=404, detail=f"skill '{skill}' not found")
    job = queue.create_job(skill, {"text": text}, trigger="pwa")
    ledger("task", {"id": job["id"], "skill": skill, "trigger": "pwa"})
    return {"job": job, "ok": True}


@app.get("/orca/jobs/{job_id}")
async def orca_job_detail(job_id: str, request: Request):
    require_token(request)
    job = queue.job_by_id(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return no_cache({"job": job})


@app.post("/beacon")
async def beacon(request: Request):
    require_token(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    agent = str(body.get("agent", "")).strip()
    if not agent:
        raise HTTPException(status_code=400, detail="agent required")
    status = str(body.get("status", "ok"))[:10]
    detail = str(body.get("detail", ""))[:200]
    now = now_iso()
    data = {}
    if STATUS_FILE.exists():
        try:
            data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
    data[agent] = {"status": status, "detail": detail, "last_seen": now}
    STATUS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "agent": agent, "ts": now}


@app.get("/agents")
async def agents_status():
    if not STATUS_FILE.exists():
        return no_cache({"agents": {}})
    try:
        data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}
    now_ms = datetime.now(timezone.utc).timestamp()
    for agent, info in data.items():
        try:
            seen = datetime.fromisoformat(info["last_seen"]).timestamp()
            stale = (now_ms - seen) > 90
        except (KeyError, ValueError):
            stale = True
        info["stale"] = stale
    return no_cache({"agents": data})


@app.get("/skills")
async def list_skill_defs():
    return no_cache({"skills": skills.list_skills()})


@app.post("/ledger/income")
async def ledger_income(request: Request, amount: float = Form(...), note: str = Form(default=""), currency: str = Form(default="EUR"), category: str = Form(default="income")):
    require_token(request)
    ledger_income_add({"amount": amount, "note": note, "currency": currency, "category": category})
    return {"ok": True, "ts": now_iso()}


@app.get("/ledger/summary")
async def ledger_summary(request: Request):
    require_token(request)
    entries = ledger_read()
    income = [e for e in entries if e.get("type") == "income"]
    days: dict[str, float] = {}
    weeks: dict[str, float] = {}
    for e in income:
        day = (e.get("ts") or "")[:10]
        if day:
            days[day] = days.get(day, 0) + float(e.get("amount", 0))
        try:
            week = datetime.fromisoformat(e["ts"]).strftime("%Y-W%W")
        except (KeyError, ValueError):
            week = day
        weeks[week] = weeks.get(week, 0) + float(e.get("amount", 0))
    return no_cache({
        "total_income": round(sum(e.get("amount", 0) for e in income), 2),
        "by_day": {k: round(v, 2) for k, v in sorted(days.items(), reverse=True)},
        "by_week": {k: round(v, 2) for k, v in sorted(weeks.items(), reverse=True)},
        "count": len(income),
    })


@app.get("/ledger")
async def ledger_list(request: Request, limit: int = 100):
    require_token(request)
    return no_cache({"entries": ledger_read()[:limit]})


@app.get("/kanban")
async def kanban_list(request: Request, column: str | None = None):
    require_token(request)
    from orca import kanban
    return no_cache({"cards": kanban.list_cards(column), "columns": kanban.COLUMNS, "summary": kanban.summary()})


@app.post("/kanban")
async def kanban_add(request: Request):
    require_token(request)
    from orca import kanban
    body = await request.json()
    title = str(body.get("title", "")).strip()
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    card = kanban.add_card(
        title,
        note=str(body.get("note", "")),
        column=str(body.get("column", "todo")),
        source=str(body.get("source", "api")),
    )
    return {"ok": True, "card": card,"summary": kanban.summary()}


@app.post("/kanban/{card_id}/move")
async def kanban_move(card_id: str, request: Request):
    require_token(request)
    from orca import kanban
    body = await request.json()
    column = str(body.get("column", "")).strip()
    if column not in kanban.COLUMNS:
        raise HTTPException(status_code=400, detail="invalid column")
    card = kanban.move_card(card_id, column)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    return {"ok": True, "card": card, "summary": kanban.summary()}


@app.delete("/kanban/{card_id}")
async def kanban_delete(card_id: str, request: Request):
    require_token(request)
    from orca import kanban
    if not kanban.delete_card(card_id):
        raise HTTPException(status_code=404, detail="card not found")
    return {"ok": True, "summary": kanban.summary()}


@app.get("/projects")
async def projects_list(request: Request, kind: str | None = None, status: str | None = None):
    require_token(request)
    from orca import projects
    return no_cache({"projects": projects.list_projects(kind=kind, status=status), "statuses": projects.STATUSES, "kinds": projects.KINDS, "summary": projects.summary()})


@app.post("/projects")
async def projects_add(request: Request):
    require_token(request)
    from orca import projects
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    project = projects.add_project(
        name,
        kind=str(body.get("kind", "kunde")),
        status=str(body.get("status", "offen")),
        url=str(body.get("url", "")),
        note=str(body.get("note", "")),
    )
    return {"ok": True, "project": project, "summary": projects.summary()}


@app.post("/projects/{project_id}/update")
async def projects_update(project_id: str, request: Request):
    require_token(request)
    from orca import projects
    body = await request.json()
    fields = {k: body[k] for k in ("name", "kind", "status", "url", "note", "stats") if k in body}
    project = projects.update_project(project_id, **fields)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True, "project": project, "summary": projects.summary()}


@app.delete("/projects/{project_id}")
async def projects_delete(project_id: str, request: Request):
    require_token(request)
    from orca import projects
    if not projects.delete_project(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    return {"ok": True, "summary": projects.summary()}


@app.get("/projects/summary")
async def projects_summary(request: Request):
    require_token(request)
    from orca import projects
    return no_cache(projects.summary())


@app.get("/artifacts")
async def artifacts_list(request: Request, limit: int = 50):
    require_token(request)
    path = Path(CONTINUUM_ARTIFACTS)
    if not path.exists():
        return no_cache({"artifacts": []})
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return no_cache({"artifacts": []})
    if not isinstance(data, list):
        return no_cache({"artifacts": []})
    return no_cache({"artifacts": data[:limit]})


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=20129)