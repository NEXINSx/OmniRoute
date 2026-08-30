# YouTube-Upload aktivieren — Schritt-für-Schritt (Google Cloud Console)

Ziel: `orca/youtube.py` kann lokale Shorts als YouTube-Video hochladen (Scope `youtube.upload`).
Die Pipeline ist fertig (`orca/youtube.py`, Skill `skills/youtube-upload.md`); es fehlen nur die
OAuth-Credentials aus der Google Cloud Console. Danach übernimmt `scripts/youtube_oauth_setup.py`
den einmaligen Consent-Flow automatisch.

## Schritt 1 — Google Cloud Projekt

1. Öffne https://console.cloud.google.com/ (mit dem Google-Konto, dessen Kanal die Videos bekommen soll).
2. Oben in der Projekt-Leiste → **Neues Projekt** → Name z.B. `omniroute-youtube` → **Erstellen**.
3. Warte, bis das Projekt oben in der Leiste ausgewählt ist.

## Schritt 2 — YouTube Data API v3 aktivieren

1. Menü → **APIs & Dienste → Bibliothek** (Library).
2. Suche **„YouTube Data API v3"** → öffnen → **Aktivieren**.

## Schritt 3 — OAuth-Zustimmungsbildschirm (Consent Screen)

1. Menü → **APIs & Dienste → OAuth-Zustimmungsbildschirm**.
2. User Type: **Extern** → **Erstellen**.
3. Ausfüllen: App-Name (z.B. `OmniRoute Uploader`), E-Mail-Adresse deines Kontos → **Speichern und fortfahren**.
4. Scopes: nichts hinzufügen nötig (der Scope wird im Consent-Flow automatisch angefordert) → weiter bis „Testbenutzer".
5. ⚠️ **Testbenutzer: deine eigene Google-Adresse hinzufügen** (App bleibt im „Testmodus", sonst kommt `access_denied`). Du kannst die App später auf „Produktion" stellen, wenn alles läuft.

## Schritt 4 — OAuth-Client erstellen (Desktop-App)

1. Menü → **APIs & Dienste → Anmeldedaten** (Credentials).
2. **Anmeldedaten erstellen → OAuth-Client-ID**.
3. Anwendungstyp: **Desktop-App** (wichtig! Redirect läuft über `http://localhost`).
4. Name: z.B. `omniroute-desktop` → **Erstellen**.
5. Es erscheinen **Client-ID** und **Client Secret** — klicke **JSON herunterladen** (Datei heißt `client_secret_*.json`).

## Schritt 5 — Werte eintragen

Option A (einfach): Die heruntergeladene JSON **ersetzt** `C:\OmniRoute\voice-agents\client_secrets.json`
(Spalte „installed" mit `client_id`, `client_secret`, `redirect_uris: ["http://localhost"]`).

Option B: Nur die zwei Werte in die bestehende `client_secrets.json` kopieren
(`client_id` und `client_secret` — die `HIER_...`-Platzhalter ersetzen).

## Schritt 6 — Consent-Flow (einmalig)

Sag dem Agenten Bescheid („Credentials sind drin") — er startet:

```bash
python scripts/youtube_oauth_setup.py
```

- Der Standardbrowser öffnet die Google-Anmeldung.
- Du loggst dich ein, klickst bei den Berechtigungen **„Weiter"** (Scope `youtube.upload`).
- Der Redirect auf `http://localhost` wird automatisch abgefangen → `YOUTUBE_CLIENT_ID`,
  `YOUTUBE_CLIENT_SECRET` und `YOUTUBE_REFRESH_TOKEN` werden in `.env` geschrieben.

## Schritt 7 — Verifikation

```bash
python -m orca.youtube --dry-run          # → DRY-RUN OK (Credentials funktionieren)
python -m orca.youtube "data\media\<hash>\tiktok.mp4" "Test-Titel" --privacy unlisted
```

Ergebnis: `videoId` + `https://youtu.be/<id>` → in YouTube Studio unter „Videos" (Unlisted) prüfen.

## Troubleshooting

- `access_denied` beim Consent: Google-Adresse unter **OAuth-Zustimmungsbildschirm → Testbenutzer** hinzufügen.
- `invalid_client`: Client-ID/Secret falsch kopiert oder aus anderem Projekt.
- `redirect_uri_mismatch`: Es muss ein **Desktop-App**-Client sein (Redirect `http://localhost` mit freiem Port ist bei Desktop-Clients erlaubt).
- Kanal fehlt: Das Google-Konto braucht einen YouTube-Kanal (einmalig auf youtube.com anlegen/aktivieren).
