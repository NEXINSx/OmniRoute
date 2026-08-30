# OmniRoute AI OS Masterplan

Stand: 2026-08-23

## 1. Zielbild

OmniRoute wird ein persönliches, lokales AI Operating System für Windows und Android. Der Orchestrator ist dauerhaft erreichbar, versteht Sprache und Kontext, koordiniert Spezialagenten und unterstützt Sebastian im Tagesgeschäft sowie beim Aufbau der Money-Maker-/Content-Production-Projekte.

Das System besteht aus einem gemeinsamen Gehirn und mehreren kontrollierten Endpunkten:

```text
PC-Mikrofone / Kameras / Bildschirm / Dateien / Apps
                         │
Android-Mikrofon / Kamera / Benachrichtigungen / Sensoren
                         │
                Device Plane + Policies
                         │
      Voice + Context + Event Bus + Memory + Ledger
                         │
             OmniRoute Orchestrator
                         │
 Agents: Coach · Research · Code · Media · Voice · Finance · Publishing
```

Ziel ist eine durchgehend nutzbare Assistenz, nicht eine permanent alles aufzeichnende Überwachung. Rohdaten werden nur bei aktivierter Funktion verarbeitet; die Oberfläche zeigt immer, welche Quelle gerade aktiv ist.

## 2. Systemschichten

### 2.1 Control Plane

Der bestehende FastAPI-/Orca-Kern bleibt die zentrale Quelle der Wahrheit. Er verwaltet:

- Sessions und Geräteidentitäten
- Agenten, Fähigkeiten und Heartbeats
- Jobs, Events und Traces
- Freigaben und Policy-Entscheidungen
- Memory, Projekte, Artefakte und Ledger
- Zeitpläne, Routinen und Benachrichtigungen

Die aktuelle JSON-/JSONL-Struktur reicht für den Prototyp. Für die dauerhafte Architektur wird ein lokales SQLite-Journal mit append-only Events empfohlen; JSON bleibt Export-/Debug-Format.

### 2.2 Device Plane

Jedes Gerät verbindet sich als eigener Knoten und meldet:

- `device_id`, Name, Plattform, Version, online/offline
- verfügbare Fähigkeiten
- aktive Sensoren und Berechtigungen
- aktuelle Session und last_seen
- lokales Modell bzw. Endpoint
- Batterie, Netzwerk und Ressourcenstatus

Eine Fähigkeit ist nicht gleichbedeutend mit Vollzugriff. Beispiele:

- `pc.mic.capture`
- `pc.camera.snapshot`
- `pc.screen.snapshot`
- `pc.files.read` / `pc.files.write`
- `pc.browser.open`
- `pc.app.launch`
- `pc.input.approve`
- `android.mic.stream`
- `android.camera.capture`
- `android.screen.share`
- `android.notification.read`
- `android.notification.reply`
- `android.accessibility.execute`
- `android.location.read`
- `android.health.read`

Jede Fähigkeit besitzt Scope, Ablaufzeit, erlaubte Agenten, Auslöser und ein Audit-Event.

### 2.3 PC Companion

Der PC braucht zwei getrennte Teile:

1. **Control-Room-UI:** bestehende Web-PWA in einer Desktop-Shell oder später Tauri/Electron.
2. **Windows Device Gateway:** lokaler Dienst für Mikrofone, Kameras, Bildschirm, Fenster-/App-Status, Dateien, Browser und freigegebene Eingaben.

Der Gateway-Prozess arbeitet mit einem lokalen IPC/API-Kanal und einer Capability-Allowlist. Riskante Aktionen laufen in einem separaten Broker-Prozess mit zusätzlicher Bestätigung. Ein Agent bekommt keine beliebige Shell, sondern benannte Tools mit Eingabeschema.

### 2.4 Native Android Companion

Für die Android-Seite ist eine native Kotlin-/Jetpack-Compose-App sinnvoll. Sie bleibt Companion und Kontrollpunkt, nicht bloß ein Browser-Tab.

Kernfunktionen:

- persistent erreichbare Voice-Session über LiveKit/WebSocket
- Push-to-talk, Wake-Word optional, TTS-Ausgabe und Bluetooth-Headsets
- Kameraaufnahme oder Live-Stream nur mit sichtbarem Aktivstatus
- Android-Notifications mit Approve/Deny/Reply-Aktionen
- Quick Settings Tile, Widget und Share Target für schnelle Capture-Aktionen
- Geräte-/Batterie-/Netzwerk-/Standortstatus nach Opt-in
- MediaProjection für eine vom Nutzer gestartete Bildschirmfreigabe
- AccessibilityService nur als klar beschriebene optionale Assistenzfunktion für UI-Inspektion und Gesten
- Offline-Inbox mit späterer Synchronisation zum PC

Android-Beschränkungen werden als Produktzustand sichtbar gemacht: Kamera und Mikrofon im Hintergrund benötigen Foreground-Service-Typen und Nutzerberechtigungen; Bildschirmfreigabe muss pro Session bestätigt werden. Die App darf nicht so gestaltet werden, als könne sie unsichtbar das gesamte Telefon kontrollieren.

## 3. Voice- und Präsenzsystem

### Voice-Kette

```text
Mikrofon → lokale VAD/Wake-Word → STT → Orchestrator → Agent/Tool → Kokoro/Voicebox → Lautsprecher
```

- Primär: lokale STT/TTS-Pipeline auf dem PC.
- Android: LiveKit-Audio-Session oder Push-to-talk, je nach Energie- und Datenschutzmodus.
- Das System spricht nur relevante Übergänge; technische Details stehen im Trace.
- Unterbrechung, Barge-in, Echo-Cancellation und Headset-Wechsel sind Kernanforderungen.

### Präsenzmodi

1. **Privat:** keine Sensoraufnahme, nur direkte Eingabe.
2. **Bereit:** Wake-Word/VAD und Heartbeats aktiv, kein Roh-Recording.
3. **Arbeitsfokus:** ausgewählte App-/Job-Kontexte und Zeitfenster aktiv.
4. **Beobachten:** explizit aktivierte Kamera-/Screen-/Audioquelle mit sichtbarem Indicator.
5. **Abwesend:** nur geplante Routinen, sichere Notifications und Health-Checks.

Jeder Modus hat eine sichtbare Start-/Stopp-Aktion und eine globale Hardware-Mute-Funktion.

## 4. Coach- und Trainingssystem

Der Coach ist kein Diagnosesystem. Er arbeitet mit beobachtbaren Ereignissen und vorgeschlagenen Experimenten.

### Loop

```text
Beobachtung → Musterhypothese → kurze Rückfrage → Intervention → Ergebnis messen → lernen
```

Beispiele:

- wiederholtes Wechseln zwischen Apps → Fokusblock vorschlagen
- lange Warte-/Fehlerzeiten → Automatisierung oder Tool-Fix vorschlagen
- Content-Produktion stockt an einem bestimmten Schritt → Pipeline vereinfachen
- Aufgaben werden begonnen, aber nicht abgeschlossen → WIP-Limit und nächster kleinster Schritt
- wiederkehrende manuelle Abläufe → Skill-/Routine-Kandidat erstellen

### Lean-Prinzipien

- Wertstrom statt Aktivitätsillusion
- WIP begrenzen
- Verschwendung sichtbar machen: Warten, Suchen, Nacharbeit, Kontextwechsel
- tägliche kurze Review statt dauernder Unterbrechung
- jede Empfehlung mit Evidenz, Konfidenz und „ignorieren“
- der Nutzer entscheidet, welche Muster dauerhaft gespeichert werden

Rohvideo und vollständige Audioaufnahmen sind nicht der Standard. Bevorzugt werden lokale, kurzlebige Merkmale und aggregierte Ereignisse wie Dauer, Wechsel, Status, Fehler und bestätigte Ergebnisse.

## 5. Money-Maker- und Content-OS

Der geschäftliche Teil wird kein separater Chat, sondern ein Portfolio aus Projekten, Pipelines und Experimenten.

### Agentenrollen

- **Orchestrator:** Ziel klären, priorisieren, delegieren, Freigaben einholen.
- **Scout/Research:** Trends, Nischen, Quellen und Wettbewerber.
- **Strategist:** Angebot, Zielgruppe, Hook, Distribution und Testdesign.
- **Script Agent:** deutsche Skripte, Varianten und CTA.
- **Visual Agent:** ComfyUI, Referenzbilder, Video-Prompts, 360°-Motion.
- **Voice Agent:** Kokoro/Voicebox, Sprecherprofil, Timing.
- **Editor Agent:** ffmpeg, SRT, Formate, Qualitätscheck.
- **Publisher:** YouTube/TikTok/Website; externe Veröffentlichung immer mit Gate.
- **Analytics Agent:** Views, Watchtime, Conversion, Einnahmen und nächste Experimente.
- **Finance/Ledger Agent:** Einnahmen, Kosten, Quoten und ROI.
- **Coach:** Produktionsverhalten, Engpässe und Lean-Verbesserungen.

### Einheitlicher Produktions-Trace

```text
Idee → Research → Konzept → Script → Visuals → Voice → Edit → QA → Freigabe → Publish → Analytics → Learn
```

Der bereits funktionierende Money-Printer-Trace wird dabei ein konkreter Workflow im Orchestra Control Room. Jedes Ergebnis wird als Artefakt registriert und mit Job, Projekt, Prompt, Modell, Kosten, Dauer und Veröffentlichung verknüpft.

„Passives Einkommen“ wird als messbare Experimentserie behandelt: Hypothese, Aufwand, Output, Distribution, Ergebnis, Lernschritt. Das System verspricht keinen Ertrag, sondern verbessert systematisch Durchsatz und Entscheidungsqualität.

## 6. Sicherheits- und Berechtigungsmodell

### Grundregeln

- deny by default
- capability statt blanket access
- minimale Rechte und Ablaufzeiten
- lokale Verarbeitung vor Cloud
- sichtbare Sensorindikatoren
- jede mutierende Aktion auditierbar
- globale Not-Aus-/Privacy-Taste auf PC und Android

### Freigabestufen

| Stufe | Beispiel                                             | Standard                                        |
| ----- | ---------------------------------------------------- | ----------------------------------------------- |
| L0    | Status lesen, lokale Zusammenfassung                 | automatisch                                     |
| L1    | Dateien lesen, Entwürfe erzeugen, interne Jobs       | automatisch nach Capability-Gate                |
| L2    | Dateien ändern, Apps öffnen, Nachrichten vorbereiten | Bestätigung bei Erstnutzung oder Policy-Wechsel |
| L3    | Nachricht senden, Upload, Veröffentlichung, Löschen  | jedes Mal bestätigen                            |
| L4    | Geld, Accounts, Systemrechte, Gerätefernsteuerung    | explizite, frische Bestätigung + Audit          |

Agenten dürfen nie selbst ihre Berechtigungen erweitern. Policies werden nur von Sebastian oder einer ausdrücklich autorisierten Admin-Aktion geändert.

## 7. UI des erweiterten Control Rooms

### Startansicht

- **Presence Strip:** PC, Android, Kamera 1/2, Mikrofon 1/2, Netzwerk, Privacy-Modus.
- **Now Panel:** Was versteht der Orchestrator gerade und welcher Agent arbeitet?
- **Orchestra Feed:** Delegation, Tool-Calls, Fortschritt, Blocker, Artefakte.
- **Agent Fleet:** Rollen, Jobs, Heartbeats, Fähigkeiten, Kosten und Zustand.
- **Coach Panel:** maximal eine oder zwei konkrete Beobachtungen, niemals ein Feed voller Ratschläge.
- **Business Cockpit:** aktive Money-Maker-Projekte, Produktionspipeline, offene Freigaben, Output und Einnahmen.
- **Command Bar:** Voice, Text, Kamera-Capture und „zeige mir warum“.

### Detailansichten

- Device/Permission Center
- Agent Trace Drawer
- Coach Review
- Project Value Stream
- Artifact Library
- Approval Inbox
- Memory Inspector
- Automation/Routine Builder

## 8. Umsetzungsphasen

### Phase 0: Vertrauensfundament

- Capability-Schema, Geräteidentität, Audit-Events und Privacy-Modi.
- Keine Kamera-/Screen-Daueraufnahme.
- Dashboard zeigt simulierte und reale Device States getrennt.

### Phase 1: PC Voice Companion

- lokaler Windows-Gateway für Mikrofon, Kamera-Snapshot, Screen-Snapshot und ausgewählte Apps
- LiveKit-/Kokoro-Voice-Session
- zentrale Command Bar und Control Room
- Hard-Mute, Session-Start/Stop und Trace

### Phase 2: Android Companion

- native Kotlin-/Compose-App
- LiveKit-Voice, Push-to-talk, Notifications, Quick Tile, Share Target
- Kamera-Capture, Akku-/Netzwerkstatus und Offline-Inbox
- Berechtigungs- und Geräteansicht im Control Room

### Phase 3: Orchestrator + Coach

- Ereignisjournal und persistente Jobs
- Coach Loop mit bestätigten Experimenten
- Fokus-, Review- und Routine-Modi
- keine Diagnose, keine verdeckte Dauerbeobachtung

### Phase 4: Money-Maker-OS

- Content-Pipeline als sichtbarer Value Stream
- QA- und Publisher-Gates
- Analytics/ROI-Ledger
- automatisierte, aber kontrollierte Routinen

### Phase 5: Fortgeschrittene Geräteaktionen

- MediaProjection-Screen-Session
- Accessibility-Assistenz nur nach expliziter Android-Aktivierung
- Windows UI Automation und freigegebene Eingabebroker
- riskante Aktionen mit L3/L4-Gates

## 9. Definition of Done für die erste echte Version

- Sebastian kann am PC oder Android sprechen und erhält eine unterbrechbare Antwort.
- Ein Job kann auf PC oder Android gestartet, verfolgt, pausiert und fortgesetzt werden.
- Kamera/Mikrofon/Screen-Zustand ist jederzeit sichtbar.
- Der Orchestrator zeigt Agentenübergaben und Tool-Calls verständlich.
- Ein Money-Maker-Workflow läuft vom Skript bis zum Artefakt durch und erscheint im Trace.
- Der Coach liefert höchstens begründete, bestätigbare Vorschläge.
- Externe und irreversible Aktionen blockieren bis zur Freigabe.
- Nach Neustart bleiben Jobs, Memory, Geräte und Audit-Trail erhalten.
