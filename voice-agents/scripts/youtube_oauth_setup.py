"""Einmaliger OAuth-Flow fuer YouTube-Upload (Scope youtube.upload).

Liest die Client-Credentials aus `client_secrets.json` (Google-Format) oder
aus --client-id/--client-secret, oeffnet den Consent-Screen im Browser,
faengt den Redirect-Code auf localhost ab, tauscht ihn gegen einen
Refresh-Token und schreibt YOUTUBE_CLIENT_ID/_SECRET/_REFRESH_TOKEN in die
Projekt-`.env`.

Nutzung:
    python scripts/youtube_oauth_setup.py
    python scripts/youtube_oauth_setup.py --client-id XXX --client-secret YYY
"""

import argparse
import json
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

PROJECT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_DIR / ".env"
SECRETS_PATH = PROJECT_DIR / "client_secrets.json"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPE = "https://www.googleapis.com/auth/youtube.upload"

_captured: dict = {}


class RedirectHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        qs = parse_qs(urlparse(self.path).query)
        if "code" in qs:
            _captured["code"] = qs["code"][0]
            _captured["state"] = (qs.get("state") or [""])[0]
            body = b"<h2 style='font-family:sans-serif'>Anmeldung erfolgreich - dieses Fenster kann geschlossen werden.</h2>"
        else:
            error = (qs.get("error") or ["unbekannt"])[0]
            body = f"<h2 style='font-family:sans-serif'>Fehler: {error} - Fenster schliessen.</h2>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # stille Logs
        pass


def _load_client() -> tuple[str, str]:
    if SECRETS_PATH.exists():
        try:
            data = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))
            inst = data.get("installed") or data.get("web") or {}
            cid = (inst.get("client_id") or "").strip()
            secret = (inst.get("client_secret") or "").strip()
            if cid and secret and "HIER_" not in cid and "HIER_" not in secret:
                return cid, secret
        except (OSError, json.JSONDecodeError):
            pass
    raise SystemExit(
        "Keine gueltigen Credentials gefunden.\n"
        f"1. Trage in {SECRETS_PATH} die echten Werte aus der Google Cloud Console ein\n"
        "   (APIs & Services -> Credentials -> OAuth-Client 'Desktop' -> JSON herunterladen),\n"
        "2. oder uebergib --client-id und --client-secret."
    )


def _write_env(client_id: str, client_secret: str, refresh_token: str) -> None:
    lines = []
    if ENV_PATH.exists():
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    keys = {"YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"}
    kept = [ln for ln in lines if not any(ln.startswith(k + "=") for k in keys)]
    kept.append(f"YOUTUBE_CLIENT_ID={client_id}")
    kept.append(f"YOUTUBE_CLIENT_SECRET={client_secret}")
    kept.append(f"YOUTUBE_REFRESH_TOKEN={refresh_token}")
    ENV_PATH.write_text("\n".join(kept) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Einmaliger YouTube-OAuth-Flow (Scope youtube.upload).")
    ap.add_argument("--client-id", default="")
    ap.add_argument("--client-secret", default="")
    args = ap.parse_args()

    client_id = args.client_id.strip() or None
    client_secret = args.client_secret.strip() or None
    if client_id and client_secret:
        pass
    else:
        client_id, client_secret = _load_client()

    server = HTTPServer(("127.0.0.1", 0), RedirectHandler)  # freier Loopback-Port
    port = server.server_address[1]
    redirect_uri = f"http://localhost:{port}"
    state = "youtube-upload-setup"

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = (
        f"{AUTH_URL}?client_id={client_id}&redirect_uri={redirect_uri}"
        f"&response_type=code&scope={SCOPE}&access_type=offline&prompt=consent&state={state}"
    )
    print("Oeffne Browser fuer die Google-Anmeldung ...")
    print(f"Redirect-URI: {redirect_uri}  (nur lokal, wird vom Skript abgewartet)")
    webbrowser.open(url)

    for _ in range(600):  # max 300 s warten
        if _captured.get("code"):
            break
        import time

        time.sleep(0.5)
    server.shutdown()

    code = _captured.get("code", "")
    if not code:
        print("Zeitueberschreitung: kein Code empfangen (Anmeldung abgebrochen?).", file=sys.stderr)
        return 1

    r = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        timeout=30,
    )
    if r.status_code >= 400:
        print(f"Token-Tausch fehlgeschlagen ({r.status_code}): {r.text[:300]}", file=sys.stderr)
        return 1
    data = r.json()
    refresh = (data.get("refresh_token") or "").strip()
    if not refresh:
        print("Kein refresh_token in der Antwort:", list(data.keys()), file=sys.stderr)
        return 1

    _write_env(client_id, client_secret, refresh)
    print("FERTIG: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET und YOUTUBE_REFRESH_TOKEN in .env geschrieben.")
    print("Naechster Schritt:  python -m orca.youtube --dry-run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
