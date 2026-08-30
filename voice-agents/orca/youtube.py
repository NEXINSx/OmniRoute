"""YouTube Shorts-Publishing: lokales TikTok-MP4 (data/media/<hash>/tiktok.mp4) via YouTube Data API v3 hochladen.

Resumable Upload (Videos.insert, part=snippet,status), OAuth2-Token via Refresh-Token aus .env.
"""

import json
import os
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

PROJECT_DIR = Path(__file__).resolve().parent.parent
MEDIA_DIR = PROJECT_DIR / "data" / "media"

API_URL = "https://www.googleapis.com/youtube/v3"
TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"

DEFAULT_CATEGORY_ID = "22"  # People & Blogs

MAX_TITLE_LEN = 100
MAX_DESC_LEN = 5000
MAX_TAGS = 15


def _cfg() -> dict:
    """Eingabe-Config: .env + client_secrets.json (Google-Format) als Fallback."""
    env = dict(os.environ)
    env.update({k: v for k, v in dotenv_values(PROJECT_DIR / ".env").items() if v})
    secrets = PROJECT_DIR / "client_secrets.json"
    if secrets.exists():
        try:
            data = json.loads(secrets.read_text(encoding="utf-8"))
            inst = data.get("installed") or data.get("web") or {}
            if not env.get("YOUTUBE_CLIENT_ID") and inst.get("client_id"):
                env["YOUTUBE_CLIENT_ID"] = inst["client_id"]
            if not env.get("YOUTUBE_CLIENT_SECRET") and inst.get("client_secret"):
                env["YOUTUBE_CLIENT_SECRET"] = inst["client_secret"]
        except (OSError, json.JSONDecodeError):
            pass
    return env


def _access_token(cfg: dict) -> str:
    direct = (cfg.get("YOUTUBE_ACCESS_TOKEN") or "").strip()
    if direct:
        return direct
    client_id = (cfg.get("YOUTUBE_CLIENT_ID") or "").strip()
    client_secret = (cfg.get("YOUTUBE_CLIENT_SECRET") or "").strip()
    refresh_token = (cfg.get("YOUTUBE_REFRESH_TOKEN") or "").strip()
    if client_id and client_secret and refresh_token:
        r = httpx.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
            },
            timeout=30,
        )
        if r.status_code >= 400:
            raise RuntimeError(
                f"YouTube-Token-Refresh fehlgeschlagen ({r.status_code}): {r.text[:300]}"
            )
        return r.json()["access_token"]
    raise RuntimeError(
        "Keine YouTube-OAuth-Credentials in .env. Benoetigt: YOUTUBE_CLIENT_ID, "
        "YOUTUBE_CLIENT_SECRET und YOUTUBE_REFRESH_TOKEN (oder direkt YOUTUBE_ACCESS_TOKEN). "
        "Einmalige Freigabe per Browser-OAuth-Flow, siehe skills/youtube-upload.md."
    )


def token_headers(cfg: dict | None = None) -> dict:
    """Liefert Authorization-Header mit frischem OAuth2-Access-Token (Scope youtube.upload)."""
    cfg = cfg or _cfg()
    return {"Authorization": f"Bearer {_access_token(cfg)}"}


def latest_tiktok() -> Path | None:
    """Findet das zuletzt produzierte data/media/<hash>/tiktok.mp4 (nach mtime)."""
    candidates = list(MEDIA_DIR.glob("*/tiktok.mp4"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def parse_meta(content: str) -> dict:
    """Extrahiert Titel/Beschreibung/Tags aus einer LLM-Antwort (Zeilen 'Titel:', 'Beschreibung:', 'Tags:')."""
    meta = {"title": "", "description": "", "tags": []}
    if not content:
        return meta
    for line in content.splitlines():
        line = line.strip()
        low = line.lower()
        for key in ("titel", "title", "beschreibung", "description", "tags"):
            if low.startswith(key + ":"):
                val = line.split(":", 1)[1].strip()
                if key in ("titel", "title"):
                    meta["title"] = val
                elif key in ("beschreibung", "description"):
                    meta["description"] = val
                elif key == "tags":
                    meta["tags"] = [t.strip() for t in val.split(",") if t.strip()]
    return meta


def upload_short(
    video_path,
    title: str,
    description: str = "",
    tags: list[str] | None = None,
    privacy: str = "public",
    category_id: str | None = None,
    cfg: dict | None = None,
) -> dict:
    """Lädt eine lokale MP4 als YouTube Short hoch (resumable upload) und liefert videoId + URL."""
    video_path = Path(video_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"Video nicht gefunden: {video_path}")
    cfg = cfg or _cfg()
    headers = token_headers(cfg)

    metadata = {
        "snippet": {
            "title": (title or video_path.stem)[:MAX_TITLE_LEN],
            "description": (description or "")[:MAX_DESC_LEN],
            "categoryId": str(category_id or cfg.get("YOUTUBE_CATEGORY_ID") or DEFAULT_CATEGORY_ID),
        },
        "status": {"privacyStatus": privacy},
    }
    if tags:
        metadata["snippet"]["tags"] = [str(t)[:100] for t in list(tags)[:MAX_TAGS]]

    init = httpx.post(
        f"{UPLOAD_URL}?uploadType=resumable&part=snippet,status",
        headers={**headers, "Content-Type": "application/json; charset=UTF-8"},
        json=metadata,
        timeout=60,
    )
    if init.status_code >= 400:
        raise RuntimeError(
            f"YouTube-Upload-Init fehlgeschlagen ({init.status_code}): {init.text[:300]}"
        )
    upload_url = init.headers.get("Location") or init.headers.get("location")
    if not upload_url:
        raise RuntimeError("Keine Upload-URL (Location-Header) im Init-Response.")

    data = video_path.read_bytes()
    up = httpx.put(
        upload_url,
        content=data,
        headers={"Content-Type": "video/mp4"},
        timeout=900,
    )
    if up.status_code >= 400:
        raise RuntimeError(
            f"YouTube-Video-Upload fehlgeschlagen ({up.status_code}): {up.text[:300]}"
        )
    try:
        resource = up.json()
    except Exception:
        resource = {}
    video_id = resource.get("id") or ""
    status = (resource.get("status") or {}).get("uploadStatus", "")

    if video_id:
        for _ in range(60):
            time.sleep(5)
            r = httpx.get(
                f"{API_URL}/videos?part=status,processingDetails&id={video_id}",
                headers=headers,
                timeout=30,
            )
            if r.status_code >= 400:
                break
            items = (r.json() or {}).get("items") or []
            if items:
                st = items[0].get("status") or {}
                status = st.get("uploadStatus", status)
                if status in ("processed", "uploaded", "failed", "rejected"):
                    break

    return {
        "videoId": video_id,
        "url": f"https://youtu.be/{video_id}" if video_id else "",
        "title": metadata["snippet"]["title"],
        "privacy": privacy,
        "uploadStatus": status,
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Lädt ein lokales TikTok-MP4 als YouTube Short hoch.")
    ap.add_argument("video", nargs="?", default="", help="Pfad zur MP4 (data/media/<hash>/tiktok.mp4)")
    ap.add_argument("title", nargs="?", default="", help="Titel (optional)")
    ap.add_argument("--description", default="")
    ap.add_argument("--privacy", default="public", choices=["public", "unlisted", "private"])
    ap.add_argument("--tags", nargs="*", default=None, help="Tags (als einzelne Argumente)")
    ap.add_argument("--dry-run", action="store_true", help="Prüft nur Credentials, KEIN Upload")
    args = ap.parse_args(argv)

    try:
        cfg = _cfg()
        if args.dry_run:
            token_headers(cfg)
            print("DRY-RUN OK: YouTube-OAuth-Credentials vorhanden, Upload NICHT ausgefuehrt.")
            return 0
        if not args.video:
            print("Fehler: Pfad zur MP4 angeben (oder --dry-run).")
            return 2
        info = upload_short(args.video, args.title, description=args.description, tags=args.tags, privacy=args.privacy)
        print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0
    except (RuntimeError, FileNotFoundError) as e:
        print(f"Fehler: {e}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())