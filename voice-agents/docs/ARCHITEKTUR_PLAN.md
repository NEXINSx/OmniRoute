# OmniRoute Personal-AI Architekturplan

**Stand:** 2026-08-11 · **Ziel:** Eine "Life OS"-Oberfläche nativ für Windows + Android,
getrieben vom lokalen OmniRoute-Kern, ohne Abhängigkeit von LifeOS/Semantica-Software.

---

## 1. Ausgangslage (Ist-Zustand)

Das Gehirn existiert bereits und läuft stabil. Alles Weitere ist Fassade + Kanalanbindung.

| Baustein           | Status   | Details                                                                                            |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| **OmniRoute-API**  | ✅ läuft | `http://localhost:20128/v1`, OpenAI-kompatibel, lokale Modelle                                     |
| **LiveKit**        | ✅ läuft | `ws://192.168.178.22:7880` (LAN-Zugriff)                                                           |
| **STT**            | ✅       | Moonshine lokal (16 kHz Mono)                                                                      |
| **TTS**            | ✅       | Kokoro lokal (`:8880`/`:8881`), WAV via Kokoro-DE                                                  |
| **LLM**            | ✅       | `auto/best-chat` über OmniRoute, plus Gemini Vision (Video/Frame-Img)                              |
| **Discord-Bot**    | ✅       | `Lexi_Bot#4666` — Text, DSL, Voice (DAVE-limitiert), `/join /leave /ask`, Attachment-Transkription |
| **Telegram-Bot**   | ✅       | `agents/telegram_bot.py` — Text + Voice via LiveKit-Flow                                           |
| **Agents**         | ✅       | 15 Stück in `voice-agents/agents/` (Restaurant, Outbound-Call, Vision, PTT, Transcriber, MCP …)    |
| **Orchestrierung** | ✅       | LiveKit AgentSessions + diskrete Bots                                                              |

**Definition of done dieser Analyse:** LifeOS/Semantica als _Software_ integrieren = verworfen.
Ihre _Muster_ (Current→Ideal State, Skills, Ledger, Notifications) fließen als Prinzipien ein.

**Erweiterung 2026-08-23:** Für das persönliche AI OS ist die bestehende Kanalarchitektur um eine Device Plane zu ergänzen. Details stehen in `docs/AI_OS_MASTERPLAN.md`: PC Device Gateway, native Android-Companion-App, Presence-Modi, Capability-Allowlist, Audit-Events, Coach-Loop und Money-Maker-Value-Stream.

---

## 2. Zielbild (Soll-Zustand)

```
Android (PWA, installierbar)          Windows Desktop (Dashboard/Elektron)
        │   fetch /  push (ntfy.sh)          │  fetch / SSE
        ▼                                  ▼
┌───────────────── OmniRoute-API :20128 ─────────────────┐
│  /v1/chat  /v1/audio/speech   /v1/embeddings  /v1/...   │
│  + NEU: /capture/*  /jobs  /ledger  /ui/*  /agents  /orca│
└───────────────┬────────────────────▲───────────────────┘
                │                    │
        Discord-Bot               Telegram-Bot
        (Text/Image/DSL)          (Text/Voice/Image)
```

**Kernprinzipien:**

1. **Ein Gehirn, viele Eingänge.** OmniRoute-API ist die einzige Quelle der Wahrheit.
2. **Kanal-Agnostik.** Jede Aufgabe wird als "Intent + Content" definiert; Discord, Telegram,
   PWA und Desktop sind reine Frontends.
3. **Capture-First.** Bilder/Videos/Sprachmemos aus jedem Kanal landen in einem
   einheitlichen Inbox-Ordner → Pipelines verarbeiten sie.
4. **Alles auditierbar.** Ein `ledger/`-Log (JSONL) zeichnet Jobs, Einnahmen, Agent-Aktionen.
5. **Datenschutz lokal.** Kein externer Dienst (außer optional ntfy.sh-Kanal).

---

## 3. Komponenten-Design

### 3.1 PWA/Fassade → NEW `ui/` (FastAPI, ein Prozess)

Kleiner **FastAPI-Server** (Python, im venv-Reich von voice-agents) auf Port `20129`:

- **Mobile Web-App (Android via Browser→"Zum Startbildschirm"):**
  - Capture: Foto/Video über Kamera-Upload, Sprachmemo per `<audio>`, Text-Input.
  - Chat mit dem Orchester (SSE-Streaming wie vorhandene Agents).
  - Status: was läuft gerade, letzte Jobs, Geld-Input.
- **Desktop-Dashboard (Windows):** gleiche Web-App, im Browser/`electron/`-Shell, plus:
  - Ledger-Tabelle, Job-Queue, Agent-Health, Ticker für Einnahmen.
- **Push:** ntfy.sh-Topic als optionaler Webhook (`/notify`), Android-App "ntfy".
- **Auth:** einfacher Token (`UI_ACCESS_TOKEN`) + optional LAN-only-Bind an `0.0.0.0`.

### 3.2 Capture-Pipeline → NEU `capture/`-Modul

- Theoretisch definieren wir **eine Inbox**: `data/inbox/`.
- **Eingänge:** PWA-Upload, Discord-Anhang, Telegram-Photo/Video/Voice, lokaler Drag&Drop.
- **Pipeline:** (schon heute einzeln vorhanden, nur verdrahten)
  `Inbox → Klassifizierung (LLM) → Router →{STT für Voice, Gemini für Bild/Video, LLM für Text} → Ergebnis + Aktion + Ledger-Eintrag`.
- **Content-Automation:** Templates ("Idee→Website-Entwurf", "Bild→LinkedIn-Post")
  als Skill-Markdowns unter `skills/` (LifeOS-Muster, aber eigene Dateien).

### 3.3 Orchester → NEU `orca/` (Orchestrator)

Leichtgewichtiger Task-Coordinator:

- **Queues:** eine `jobs`-Tabelle (JSONL oder SQLite) mit Statusen `queued → running → done/failed`.
- **Trigger:** Cron (interval), Kanal-Intent (Discord/Telegram/PWA), Webhook (ntfy/Telegram).
- **Routen:** jedes Job "Skill" → Agent / LLM / Pipeline.
- **Status:** `GET /orca/status` = Live-Ansicht (UI, puplic).

### 3.4 Ledger → NEU `ledger/` (Geld & Aktivität)

- **Einnahmen:** manuell erfassen (`POST /ledger/income`) oder aus Channel-Verknüpfung importieren.
- **Kategorien:** `income · expense · task · system`.
- **Aggregate:** Tages/Wochen/Monat-Übersicht für's Dashboard, Export CSV.

### 3.5 Agent-Health → NEU `/agents`-Status-Endpoint

- Jeder Bot/Agent meldet Heartbeat (`:20128/beacon`) → `data/status.json`.
- Dashboard zeigt grün/gelb/rot (Pattern aus LifeOS "Doctor").

---

## 4. Phasenplan

### Phase 1 — "Fundament" (Woche 1)

- FastAPI-Server `ui/` aufsetzen, Token-Auth, `/health`.
- `/inbox` POST (PWA-Upload) + `/orca/status` (minimal).
- Android-PWA: Capture + Chat, lokal im LAN testen.
- **Definition of done:** Foto vom Handy landet in `data/inbox/`, SSH-Stack speichert
  Medien und LLM-Textantwort kommt zurück.

### Phase 2 — "Orchester & Kubernetes-Eigenbau" (Woche 2–3)

- `jobs`-Queue + Cron + Skill-Router (Markdown-Skills unter `skills/`).
- Telegram-Bot + Discord-Bot auf `/inbox` und `/orca` umstellen (einheitliche Capture).
- `ledger/` mit Einnahmen + Dashboard-Tabelle.
- **Definition of done:** Idee via Discord → automatisch Website-Entwurfs-Pipeline
  (Prompt → HTML → Screenshot) → Resultat als Nachricht. Einnahme eintragbar + sichtbar.

### Phase 3 — "Desktop & Push" (Woche 4+)

- Windows-Dashboard im Browser-IShell festigen (`electron/` optional).
- ntfy-Push für "Job fertig / Fehler / neuer Geld-Eingang".
- Agent-Heartbeats + Health-Panel.
- Website-Entwurfs- / Content-Templates als ausgewählte Skills.

---

## 5. Risiken & Trade-offs

| Risiko                                  | Maßnahme                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **DAVE blockiert Live-Voice** (Discord) | → Bot bleibt nutzbar via Text/GSL/Reall; Voice-Problem ist Discord-seitig, nicht unser Bug           |
| **LAN-Exposure**                        | Auth-Token Pflicht, Bind default `127.0.0.1`, LAN nur wenn gewollt                                   |
| **Scope-Inflation**                     | Je Phase klare "Definition of done", kein halbes LifeOS                                              |
| **LifeOS-Vendor-Lock**                  | bewusst vermieden (CLI/harness-gebunden, kein Windows)                                               |
| **Cloud-Vendor-Lock (Semantica)**       | Enterprise-OH-Stack passt nicht für Personal-Desktop; Graph-Muster später optional als eigene Module |

---

## 6. Wiedererkennbare LifeOS-Muster (übernommen als Prinzipien, nicht als Code)

1. **Current → Ideal State (ISA-Idee):** Jede Skill-Pipeline schließt `goal → done-claims → verify → learn`.
2. **Ledger/Change-Tracking:** alles protokolliert, verschiebbar zurückgebaut.
3. **Notification-Routing:** Ereignisklassen (task, longTask, error, security) → Kanal-Mapping.
4. **Doctor/Health:** Determinische Check-Skripts mit Circuit-Breaker statt "AI entscheidet alles".
5. **Sentinel-Pattern:** `NO_ACTION` verhindert Notification-Flood.
