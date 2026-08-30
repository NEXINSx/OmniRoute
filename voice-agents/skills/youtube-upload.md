---
name: youtube-upload
description: "Laedt das zuletzt produzierte lokale TikTok-Video (data/media/<hash>/tiktok.mp4, 1080x1920, ~30s) als YouTube Short hoch - via YouTube Data API v3 (resumable upload, OAuth Scope youtube.upload, Kategorie 22 'People & Blogs')."
model: auto/best-chat
pipeline:
  - type: llm
    prompt: "Erzeuge Titel, Beschreibung und Tags fuer dieses TikTok-Video (YouTube Short, deutsch):\n\n{input}\n\nAntworte NUR in diesem Format, keine Erklaerungen:\nTitel: <max 60 Zeichen, deutsch, neugierig machend, YouTube-Style, KEINE Hashtags>\nBeschreibung: <1-3 Saetze deutsch, am Ende 3-5 passende Hashtags>\nTags: <5-8 Stichworte, kommagetrennt, deutsch>\n"
  - type: youtube-upload
    content: "{input}"
    privacy: unlisted
---

Du laedst das zuletzt produzierte lokale TikTok-Video (`data/media/<hash>/tiktok.mp4`) als YouTube Short hoch.
`{input}` = Pfad zum Video. Der LLM-Schritt erzeugt Titel/Beschreibung/Tags, der `youtube-upload`-Schritt
liest sie aus der LLM-Antwort (Zeilen `Titel:`, `Beschreibung:`, `Tags:`) und laedt die MP4 via resumable
upload hoch (ora/orca/youtube.py). Ergebnis: videoId + `https://youtu.be/<id>`.

## Benoetigte .env-Variablen (C:\OmniRoute\voice-agents\.env)

- `YOUTUBE_CLIENT_ID=<oauth-client-id>` — OAuth-Client-ID (Desktop-App, Redirect `http://localhost`)
- `YOUTUBE_CLIENT_SECRET=<oauth-client-secret>` — Client-Secret aus der Google Cloud Console
- `YOUTUBE_REFRESH_TOKEN=<refresh-token>` — Refresh-Token (einmalig erzeugt, siehe unten)
- Optional: `YOUTUBE_ACCESS_TOKEN=<kurzlebiger-access-token>` — Alternative ohne Refresh-Token (direkt)
- Optional: `YOUTUBE_CATEGORY_ID=22` — Kategorie (Default 22 = People & Blogs)

## Einmalige Erst-Freigabe (OAuth-Flow)

1. Google Cloud Console → Projekt anlegen → APIs & Services → OAuth-Consent-Screen konfigurieren.
   OAuth-Client (Desktop) mit Redirect `http://localhost` erstellen; Scope `https://www.googleapis.com/auth/youtube.upload`.
2. Im Browser oeffnen:
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=<ID>&redirect_uri=http://localhost&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload&access_type=offline`
3. Google-Konto zustimmen → Browser wird auf `http://localhost/?code=<CODE>` weitergeleitet.
4. Code gegen Refresh-Token tauschen (einmalig, z.B. curl oder in Python):
   `POST https://oauth2.googleapis.com/token` mit `grant_type=authorization_code`, `client_id`,
   `client_secret`, `code=<CODE>`, `redirect_uri=http://localhost` → Antwort enthaelt `refresh_token`
   → in `.env` als `YOUTUBE_REFRESH_TOKEN` eintragen.

## Ohne Credentials

Fehlt alles, schlaegt der `youtube-upload`-Schritt mit verstaendlichem Fehler fehl:
`Keine YouTube-OAuth-Credentials in .env. Benoetigt: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET und YOUTUBE_REFRESH_TOKEN ...`
Das lokale Video bleibt unveraendert erhalten.

## Testpfad (OHNE echten Upload)

```python
from orca import youtube
youtube.latest_tiktok()   # findet das zuletzt produzierte data/media/<hash>/tiktok.mp4
youtube.parse_meta("Titel: X\nBeschreibung: Y\nTags: a, b")  # Metadaten-Extraktion aus LLM-Antwort
# Echter Upload erst, wenn Credentials in .env stehen:
# youtube.upload_short(youtube.latest_tiktok(), "Titel", privacy="unlisted")
```

## CLI (manueller Test)

    .venv\Scripts\python.exe -m orca.youtube --dry-run
    .venv\Scripts\python.exe -m orca.youtube "data\media\<hash>\tiktok.mp4" "Titel" --privacy unlisted
