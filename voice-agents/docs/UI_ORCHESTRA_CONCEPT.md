# OmniRoute Agent Orchestra UI Concept

Stand: 2026-08-23

## Zielbild

OmniRoute wird als lokales Agent Operating System wahrgenommen: Sebastian sieht auf einem Bildschirm, was das Orchester gerade versteht, plant, ausführt, delegiert und auf seine Freigabe wartet. Die Oberfläche ist voice-first, aber jede wichtige Aktion bleibt sichtbar, nachvollziehbar und kontrollierbar.

Das Primärprodukt ist nicht ein Chatfenster. Das Primärprodukt ist der **Orchestra Control Room** mit einem zentralen Orchestrator, aktiven Agenten, laufenden Workflows, Artefakten, Memory und Freigabe-Gates.

## Aus den Videos übernommen

- Jarvis/Javis-Kommunikation: Wake-Word, natürliche Stimme, kurze Statusmeldungen und Antworten ohne Tippen.
- Lokaler Agent mit Memory: private Daten, Obsidian-/Notiz-Kontext, lokale Ausführung und sichtbares Wissen.
- Modularer Node-Workflow: Agenten und Tools als verschiebbare, verbundene Nodes; Positionen und Rollen bleiben anpassbar.
- Cloudflare-Computer-Motiv: persistenter Workspace mit Dateien, Code, Browser-/Container-Ausführung und wiederaufnehmbaren Jobs.
- Medien-/Content-Automatisierung: Script → Bild → Video → Voice → Export als nachvollziehbare Pipeline mit Artefakten.
- Live-Übersetzer-Overlay: kleine, nicht störende Live-Kommunikationsschicht für Transkript, Übersetzung und Systemzustand.
- Kimi/K3-Scroll-Erlebnis: nur als optionale Projekt-/Showcase-Ansicht für generierte Medien; nicht als Hauptnavigation oder Daueranimation.
- Trading-/Quant-/MCP-Videos: externe Datenquellen, Connectoren, Metriken und sensible Aktionen brauchen klare Zustände und Freigaben.
- Unreal-/Code-Workflows: Agenten sollen Code, Dateien und Projekte wirklich bearbeiten können; der Verlauf muss als Trace einsehbar sein.

## Kernaufbau: 3 Ebenen

### 1. Control Room

Die Startseite zeigt ohne Navigation:

- **Topbar:** Systemgesundheit, Mikrofon-/Wake-Word-Zustand, lokale/cloud LLM-Auswahl, aktueller Workspace, Benachrichtigungen.
- **Linke Rail:** Orchestra, Jobs, Agents, Projects, Memory, Artifacts, Ledger, Settings.
- **Mitte:** Live-Orchestra-Stream. Der Orchestrator schreibt kurze Ereignisse: verstanden, geplant, delegiert, wartet auf Freigabe, ausgeführt, Ergebnis.
- **Rechte Spalte:** Agenten-Flotte mit Status, aktueller Aufgabe, letzter Heartbeat, Modell/Endpoint und Auslastung.
- **Untere Command Bar:** Sprache als Standard; Text bleibt verfügbar. Eingabe versteht Aufgaben, Fragen und Befehle.

Die visuelle Hierarchie muss „Was passiert jetzt?“ vor „Was kann das System?“ priorisieren.

### 2. Orchestration Canvas

Eine separate, zoom-/pan-fähige Ansicht zeigt den konkreten Workflow:

- Orchestrator als zentraler Knoten.
- Agent Nodes für Research, Memory, Code, Voice, Media, Finance und Publishing.
- Tool-Nodes für Browser, Filesystem, ComfyUI, Ollama, Kokoro, Voicebox, ffmpeg, Discord und spätere Uploads.
- Kanten zeigen Übergaben und Datenrichtung.
- Jeder Node hat Zustand: idle, thinking, running, waiting, success, blocked, error.
- Klick auf einen Node öffnet Details, Input/Output, Tools, Modell und Trace.
- Workflows können aus Vorlagen entstehen; die visuelle Bearbeitung kommt nach der stabilen Laufzeitansicht.

Der Canvas ist eine Arbeitsansicht, kein dekorativer Hintergrund. Animation nur bei tatsächlichen Events.

### 3. Detail Drawer

Jeder Job, Agent, Tool-Call und jedes Artefakt öffnet einen rechten Drawer:

- Ziel und aktueller Status
- Timeline der Schritte
- Agent-to-agent handoffs
- LLM- und Tool-Aufrufe
- Dateien und Artefakte
- Kosten-/Dauer-Metriken
- Memory-Kontext, der verwendet wurde
- Buttons: pausieren, fortsetzen, wiederholen, abbrechen, freigeben

## Human-in-the-loop

Freigaben sind ein eigener sichtbarer Zustand. Für riskante Aktionen wie Upload, Nachricht senden, Löschen, Kauf, externe Veröffentlichung oder Änderung produktiver Dateien zeigt die Oberfläche:

- Was will der Agent tun?
- Welches Tool wird aufgerufen?
- Welche Parameter werden verwendet?
- Welche Folgen sind erwartbar?
- Approve, Edit, Deny, Pause

Die Freigabe darf aus der Desktop-App, dem Handy-PWA, Discord oder Telegram kommen. Der Job bleibt dabei persistent und kann nach einem Neustart fortgesetzt werden.

## Voice-first-Verhalten

- Wake Word „Hey Jarvis“/konfigurierbarer Name als schneller Einstieg.
- Während der Verarbeitung: kompakte Live-Anzeige mit Transkript und aktuellem Agent.
- Orchestrator spricht nur wichtige Übergänge, nicht jedes technische Detail.
- Antwort wird visuell als kurze Zusammenfassung plus „Details anzeigen“ dargestellt.
- Push-to-talk und Text bleiben als gleichwertige Fallbacks verfügbar.
- Übersetzung/Transkript erscheint als optionales Overlay, ohne den Control Room zu verdecken.

## Visuelles System

Richtung: **dark graphite control room**, nicht Cyberpunk-Neon.

- Grundflächen: fast schwarzes Graphit und tiefe blaue/graue Ebenen.
- Akzentfarben sind semantisch: Cyan für Aktivität, Grün für Erfolg, Amber für Freigabe/Warnung, Rot für Fehler, Violett nur für kreative Medienzustände.
- Dünne Linien, klare Typografie, geringe Radien, keine dekorativen Glows oder schwebenden Bubbles.
- Status wird immer durch Text/Icon/Farbe zusammen dargestellt, nicht nur durch Farbe.
- Dichte Informationsflächen wie in den gezeigten Operator-, Code- und Trading-Ansichten; ausreichend Weißraum für Prioritäten.
- Bewegung ist funktional: Fortschritt, Übergabe, Audiopegel, Live-Trace. Keine Daueranimation.

## MVP-Schnitt

### Phase A: Control Room

- Responsive Electron/PWA-Shell auf Basis der bestehenden `ui/static/index.html`.
- `/agents`, `/orca/status`, `/orca/jobs`, `/kanban`, `/projects`, `/ledger` in einer gemeinsamen Übersicht.
- Live-Polling zunächst beibehalten; WebSocket/Event-Stream als nächster Backend-Schritt.
- Orchestrator-Feed, Agenten-Flotte, aktuelle Jobs, Freigabe-Inbox und Command Bar.
- Bestehende Upload-, Voice-, Jobs-, Kanban- und Projekte-Funktionen als Views/Drawers weiterverwenden.

### Phase B: Trace und Canvas

- Einheitliches Event-Schema für job_started, delegated, tool_called, approval_required, artifact_created, completed, failed.
- Job-Detail-Timeline.
- Canvas auf Basis der tatsächlich laufenden Jobs, zunächst read-only.
- Persistenter Zustand in `data/` und Wiederaufnahme nach Neustart.

### Phase C: Aktive Orchestrierung

- Freigabe-Gates für externe oder irreversible Tools.
- Agenten können Aufgaben an Spezialisten delegieren.
- Routinen und Zeitpläne als sichtbare Automationskarten.
- Mobile Approval und kompakte Live-Übersetzung.
- Medien-Showcase mit Scroll-/Journey-Erlebnis nur innerhalb einzelner Projekte.

## Technische Leitplanken

- Bestehende FastAPI-Endpunkte und Orca-Queue weiterverwenden; keine parallele zweite Agentenlogik in der UI.
- `data/status.json`, Queue und Ledger bleiben die erste Datenquelle; später Event-Log ergänzen.
- Keine Zugangsdaten im Frontend oder in Logs.
- UI muss offline/lokal sinnvoll bleiben und Netzwerk-/LLM-Ausfälle explizit anzeigen.
- Agentenstatus braucht last_seen, current_job, capability, model, endpoint und stale-Zustand.
- Jede mutierende Aktion benötigt einen nachvollziehbaren Event-/Ledger-Eintrag.
- Tests für Status-Mapping, Polling-Fehler, Freigabezustände und responsive Kernlayouts.

## Priorisierte erste Umsetzung

1. Bestehende mobile PWA in eine responsive Control-Room-Shell mit Rail, Orchestrator-Feed und Agenten-Flotte umbauen.
2. Backend-Response für `/orca/status` und `/agents` um ein einheitliches Dashboard-Modell erweitern.
3. Job-Detail-Drawer mit Live-Status und Ergebnis/Artefakten einführen.
4. Command Bar für Text und Voice als zentrale Eingabe etablieren.
5. Erst danach den read-only Canvas auf echte Jobdaten setzen.

## Erweiterung: Persönliches AI Operating System

Der Control Room bekommt eine zusätzliche **Presence-/Device-Schicht**. PC und Android sind keine getrennten Apps, sondern Geräte-Knoten des gleichen Orchestrators. Kameras, Mikrofone, Bildschirm, Dateien, Apps und Benachrichtigungen werden als einzelne Capabilities angezeigt, mit Status, Berechtigung, Ablaufzeit und letztem Zugriff.

### Neue Startseitenbereiche

- **Presence Strip:** PC, Android, Kameras, Mikrofone, Netzwerk und Privacy-Modus.
- **Now:** Was hat Sebastian gesagt, was versteht der Orchestrator, welcher Agent arbeitet?
- **Coach:** höchstens ein oder zwei begründete Lean-/Fokus-Vorschläge statt permanenter Ratschläge.
- **Business Cockpit:** Money-Maker-Projekte, Content-Value-Stream, offene Freigaben und Einnahmen.
- **Permission Center:** Sensor- und Gerätezugriff mit globalem Privacy-Mute.

### Plattformmodell

- PC: Control-Room-Shell plus separater Windows Device Gateway für lokale Geräte- und App-Fähigkeiten.
- Android: native Kotlin-/Compose-Companion-App für LiveKit-Voice, Push-to-talk, Notifications, Quick Actions, Kamera-Capture und Offline-Inbox.
- Gemeinsamer Control Plane: FastAPI/Orca, Event-Journal, Memory, Ledger und Artefakte.

### Coaching-Modell

`Beobachtung → Musterhypothese → Rückfrage → Experiment → Ergebnis → Lernen`.

Der Coach analysiert nur freigegebene, beobachtbare Signale wie Wartezeit, Kontextwechsel, Fehler, WIP und abgeschlossene Ergebnisse. Rohvideo und Daueraufzeichnung sind nicht der Standard. Empfehlungen müssen Evidenz, Konfidenz, Ziel und eine Ignore-/Stop-Option zeigen.

### Zugriffspolitik

Der Agent erhält keinen blanket access. Capabilities wie `pc.camera.snapshot`, `pc.screen.snapshot`, `pc.files.write`, `android.notification.reply` oder `android.accessibility.execute` werden einzeln vergeben. L0/L1-Aktionen können automatisiert werden; externe Veröffentlichung, Löschen, Nachrichten, Geld und Systemrechte brauchen L3/L4-Freigaben. Jede Aktion landet im Trace und Audit-Ledger.

Die technische Erweiterung ist im Masterplan `docs/AI_OS_MASTERPLAN.md` beschrieben.
