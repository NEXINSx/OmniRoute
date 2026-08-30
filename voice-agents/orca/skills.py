import re
from pathlib import Path

import httpx
import yaml

PROJECT_DIR = Path(__file__).resolve().parent.parent
SKILLS_DIR = PROJECT_DIR / "skills"
REGISTRY_FILE = SKILLS_DIR / "_registry.md"


def registry_context() -> str:
    if REGISTRY_FILE.exists():
        raw = REGISTRY_FILE.read_text(encoding="utf-8")
        fm_end = raw.find("\n---\n")
        if fm_end != -1:
            raw = raw[fm_end + 5 :]
        return raw.strip()
    return ""


def _parse_frontmatter(content: str) -> tuple[str, dict, str]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", content, re.DOTALL)
    if not m:
        return "", {}, content.strip()
    meta = yaml.safe_load(m.group(1)) or {}
    body = m.group(2).strip()
    return m.group(1), meta, body


def list_skills() -> dict[str, dict]:
    result = {}
    for p in sorted(SKILLS_DIR.glob("*.md")):
        if p.stem.startswith("_"):
            continue
        raw = p.read_text(encoding="utf-8")
        _, meta, _ = _parse_frontmatter(raw)
        meta.setdefault("file", p.name)
        result[p.stem] = meta
    return result


def load_skill(name: str) -> dict | None:
    p = SKILLS_DIR / f"{name}.md"
    if not p.exists():
        return None
    raw = p.read_text(encoding="utf-8")
    _, meta, body = _parse_frontmatter(raw)
    meta["body"] = body
    meta["name"] = meta.get("name", name)
    return meta


def run_skill(skill: dict, input_data: dict, llm_endpoint: str, api_key: str, model: str, progress_callback=None) -> dict:
    pipeline = skill.get("pipeline", [])
    body = skill.get("body", "")
    input_text = str(input_data.get("text", ""))
    result = {}
    cap_ctx = registry_context()
    workdir = _work_dir()

    for index, step in enumerate(pipeline, start=1):
        stype = step.get("type", "llm")
        _report_progress(progress_callback, {"phase": "started", "step": stype, "step_index": index, "step_total": len(pipeline), "message": step_message(stype, "started")})
        if stype == "llm":
            prompt = step.get("prompt", "")
            if "{input}" in prompt:
                prompt = prompt.replace("{input}", input_text)
            if "{body}" in prompt:
                prompt = prompt.replace("{body}", body)
            sys = step.get("system", body)
            if cap_ctx:
                sys += "\n\n=== LOKALE SYSTEM-CAPABILITIES (diese Tools BEVORZUGEN, real vorhanden) ===\n" + cap_ctx
            result["response"] = _llm_call(llm_endpoint, api_key, model, sys, prompt)
        elif stype == "command":
            import subprocess

            cmd = step.get("cmd", "")
            if "{text}" in cmd:
                cmd = cmd.replace("{text}", input_text[:200])
            r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=step.get("timeout", 60), check=False)
            result["command"] = {"cmd": cmd, "returncode": r.returncode, "stdout": r.stdout[-2000:], "stderr": r.stderr[-2000:]}
        elif stype in ("media-image", "media-voice", "media-video"):
            result.update(_run_media_step(step, result, input_text, workdir))
        elif stype in ("html", "screenshot", "gcs-upload"):
            result.update(_run_website_step(step, result, input_text, workdir))
        elif stype == "kanban":
            result.update(_run_kanban_step(step, result, input_text))
        elif stype == "youtube-upload":
            result.update(_run_youtube_step(step, result, input_text))
        elif stype == "poster":
            result.update(_run_poster_step(step, result, input_text))
        elif stype == "map":
            result.update(_run_map_step(step, result, input_text, workdir))
        _report_progress(progress_callback, {"phase": "completed", "step": stype, "step_index": index, "step_total": len(pipeline), "message": step_message(stype, "completed")})
    return result


def step_message(stype: str, phase: str) -> str:
    names = {"llm": "LLM", "command": "Befehl", "media-image": "ComfyUI-Bilder", "media-voice": "Voicebox-Audio", "media-video": "Video", "youtube-upload": "YouTube-Upload"}
    return f"{names.get(stype, stype)} {'gestartet' if phase == 'started' else 'fertig'}"


def _report_progress(callback, event: dict) -> None:
    if callback is None:
        return
    callback(event)


def _website_dir() -> Path:
    import uuid

    from orca import website

    d = website.SITES_DIR / uuid.uuid4().hex[:10]
    d.mkdir(parents=True, exist_ok=True)
    return d


def _run_website_step(step: dict, result: dict, input_text: str, workdir: Path) -> dict:
    from orca import website

    stype = step.get("type")
    if stype == "html":
        content = step.get("content", "").replace("{input}", input_text[:1000])
        if "{response}" in str(content):
            content = content.replace("{response}", str(result.get("response", "")))
        structure = website.parse_structure(content)
        if not structure:
            return {"html": "", "note": "LLM-Struktur nicht lesbar"}
        out = website.build_and_save(structure, _website_dir(), name=step.get("name", "index"))
        return {"html": str(out)}
    if stype == "screenshot":
        html = Path(result.get("html", "")) if result.get("html") else workdir / "index.html"
        if html.exists():
            png = website.screenshot_html(html, html.parent, name=step.get("name", "screenshot"))
            return {"screenshot": str(png)} if png else {}
    if stype == "gcs-upload":
        from orca import gcs

        site_dir = None
        if result.get("html"):
            site_dir = Path(result["html"]).parent
        elif result.get("screenshot"):
            site_dir = Path(result["screenshot"]).parent
        else:
            src = step.get("content") or ""
            src = src.replace("{input}", input_text[:200]).strip()
            p = Path(src) if src else None
            site_dir = p if p and p.is_dir() else (p.parent if p and p.is_file() else workdir)
        info = gcs.upload_site(site_dir, bucket=step.get("bucket") or None, slug=step.get("slug") or None)
        return {"site_url": info["url"], "gcs": info}
    return {}


def _run_kanban_step(step: dict, result: dict, input_text: str) -> dict:
    from orca import kanban

    def sub(s: str) -> str:
        s = s.replace("{input}", input_text[:500])
        if "{response}" in s:
            s = s.replace("{response}", str(result.get("response", ""))[:800])
        return s.strip()

    action = step.get("action", "add")
    if action == "add":
        raw = sub(step.get("title", "")) or str(result.get("response", ""))[:800]
        split = step.get("split", "line")
        titles = [raw] if split != "line" else [ln.strip(" -•\t") for ln in raw.splitlines() if ln.strip(" -•\t")]
        cards = []
        for t in titles[:20]:
            card = kanban.add_card(
                t[:200],
                note=sub(step.get("note", "")),
                column=step.get("column", "todo"),
                source=step.get("source", "skill"),
            )
            cards.append(card)
        return {"kanban": cards, "kanban_summary": kanban.summary()}
    if action == "clear":
        for c in kanban.list_cards():
            kanban.delete_card(c["id"])
        return {"kanban_cleared": True, "kanban_summary": kanban.summary()}
    return {}


def _run_youtube_step(step: dict, result: dict, input_text: str) -> dict:
    from orca import youtube

    response = str(result.get("response", ""))

    def sub(s: str) -> str:
        s = (s or "").replace("{input}", input_text.strip())
        s = s.replace("{response}", response)
        return s.strip()

    src = sub(step.get("content", ""))
    video_path = None
    if src:
        p = Path(src)
        if p.is_file():
            video_path = p
    if not video_path:
        for key in ("video", "local"):
            v = result.get(key)
            if v and Path(v).is_file():
                video_path = Path(v)
                break
    if not video_path:
        video_path = youtube.latest_tiktok()
    if not video_path:
        return {
            "youtube": {
                "error": "Kein Video gefunden: weder content noch media-Video-Ergebnis "
                "noch data/media/<hash>/tiktok.mp4 vorhanden."
            }
        }

    meta = youtube.parse_meta(response)
    info = youtube.upload_short(
        video_path,
        title=sub(step.get("title", "")) or meta.get("title") or video_path.stem,
        description=sub(step.get("description", "")) or meta.get("description") or "",
        tags=step.get("tags") or meta.get("tags") or [],
        privacy=sub(step.get("privacy", "unlisted")) or "unlisted",
    )
    return {"youtube": info, "youtube_url": info.get("url", "")}


def _run_poster_step(step: dict, result: dict, input_text: str) -> dict:
    from orca import poster

    response = str(result.get("response", ""))

    def sub(s: str) -> str:
        s = (s or "").replace("{input}", input_text.strip())
        s = s.replace("{response}", response)
        return s.strip()

    def extract_title(text: str) -> str:
        for line in text.splitlines():
            low = line.strip().lower()
            for key in ("titel", "title"):
                if low.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
        return ""

    action = step.get("action", "status")
    if action == "plan":
        video = sub(step.get("video", "")) or None
        when = sub(step.get("when", "now")) or "now"
        privacy = sub(step.get("privacy", "public")) or "public"
        title = sub(step.get("title", "")) or extract_title(response)
        try:
            entry = poster.schedule_post(video_path=video, title=title, when=when, privacy=privacy)
            return {"poster": {"action": "plan", "entry": entry}}
        except (FileNotFoundError, ValueError) as e:
            return {"poster": {"action": "plan", "error": str(e)}}
    if action == "run":
        return {"poster": {"action": "run", **poster.run_due()}}
    if action == "status":
        return {"poster": {"action": "status", **poster.list_posts()}}
    return {}


def _run_map_step(step: dict, result: dict, input_text: str, workdir: Path) -> dict:
    """Erzeugt eine prettymaps-Karte (OSM) über das Python-3.12-venv (.venv-maps).

    Step-Parameter: query (Ort, sonst {input}), radius, preset, background,
    output-Name. Ergebnis: {map: <pfad>, map_dir: <dir>}.
    """
    query = step.get("query", "").replace("{input}", input_text[:120]).strip() or input_text.strip()
    if not query:
        return {"map_error": "Kein Ort angegeben (query oder {input})"}
    out_dir = workdir / "maps"
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = step.get("format", "png")
    out = out_dir / f"{step.get('name', 'map')}.{suffix}"

    maps_py = PROJECT_DIR / ".venv-maps" / "Scripts" / "python.exe"
    if not maps_py.exists():
        return {
            "map_error": (
                f"{maps_py} fehlt. prettymaps braucht Python 3.12: "
                "py -3.12 -m venv .venv-maps && .venv-maps/Scripts/pip install "
                "git+https://github.com/marceloprates/prettymaps.git@main"
            )
        }
    cmd = [
        str(maps_py), "-m", "orca.mapgen",
        query, str(out),
        "--radius", str(step.get("radius", 500)),
        "--preset", step.get("preset", "default"),
        "--background", step.get("background", "#F2F4CB"),
    ]
    env = dict(__import__("os").environ)
    env["PYTHONPATH"] = str(PROJECT_DIR)
    r = __import__("subprocess").run(cmd, capture_output=True, text=True, timeout=step.get("timeout", 600), env=env)
    if r.returncode != 0:
        return {"map_error": r.stderr[-2000:] or r.stdout[-2000:]}
    if not out.exists():
        return {"map_error": f"prettymaps erzeugte keine Datei: {out}"}
    return {"map": str(out), "map_dir": str(out_dir)}


def _work_dir() -> Path:
    import uuid

    d = PROJECT_DIR / "data" / "media" / uuid.uuid4().hex[:10]
    d.mkdir(parents=True, exist_ok=True)
    return d


def _run_media_step(step: dict, result: dict, input_text: str, workdir: Path) -> dict:
    from orca import media

    stype = step.get("type")
    if stype == "media-image":
        prompts = step.get("prompts") or []
        if isinstance(prompts, str):
            prompts = [p.strip() for p in prompts.split("---") if p.strip()]
        prompts = [p.replace("{input}", input_text[:200]) for p in prompts]
        images = media.comfyui_generate(prompts, workdir, prefix=step.get("prefix", "scene"))
        return {"images": [str(p) for p in images], "media_dir": str(workdir)}
    if stype == "media-voice":
        text = step.get("text", "").replace("{input}", input_text[:1000])
        if "{response}" in str(text):
            text = text.replace("{response}", str(result.get("response", "")))
        engine = step.get("engine", "voicebox")
        if engine == "voicebox":
            profile = step.get("profile")
            wav = media.voicebox_speak(text, workdir, profile=profile)
        else:
            wav = media.kokoro_speak(text, workdir, voice=step.get("voice", "martin"))
        return {"voice": str(wav)} if wav else {}
    if stype == "media-video":
        images = [Path(p) for p in (result.get("images") or [])]
        audio = Path(result.get("voice", "")) if result.get("voice") else None
        srt = None
        if step.get("subtitles") and audio is not None:
            from orca import subtitles

            srt = subtitles.srt_from_audio(audio, workdir, language=step.get("lang", "de"))
        mp4 = media.ffmpeg_tiktok(
            images, audio, workdir, name=step.get("name", "tiktok"), subtitle=srt
        )
        ready = media.publish_ready(mp4)
        out = {"video": str(ready), "local": str(mp4)}
        if srt is not None:
            out["subtitles"] = str(srt)
        return out
    return {}


def _llm_call(base_url: str, api_key: str, model: str, system: str, prompt: str) -> str:
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        "stream": False,
    }
    r = httpx.post(
        f"{base_url}/chat/completions",
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=240,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]