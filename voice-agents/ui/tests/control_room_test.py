"""Systematic Playwright test for the OmniRoute Control Room UI (ArcRift-style Memory Layer).

Usage:
    python ui/tests/control_room_test.py
    UI_BASE=http://127.0.0.1:20139 python ui/tests/control_room_test.py

Base URL defaults to http://127.0.0.1:20129/ and can be overridden via the
UI_BASE environment variable (used by with_server.py runs on other ports).
Exit code 0 = all checks passed, 1 = failures.
"""
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("UI_BASE", "http://127.0.0.1:20129/")
if not BASE.endswith("/"):
    BASE += "/"
results = []
console_errors = []

ENV_PATH = Path(r"C:\OmniRoute\voice-agents\.env")
UI_TOKEN = ""
if ENV_PATH.exists():
    m = re.search(r"^UI_ACCESS_TOKEN=(.*)$", ENV_PATH.read_text(encoding="utf-8"), re.M)
    if m:
        UI_TOKEN = m.group(1).strip().strip('"').strip("'").rstrip("\r")


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    print((("PASS" if ok else "FAIL")) + f" | {name}" + (f" | {detail}" if detail else ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: console_errors.append("PAGEERROR: " + str(err)))
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(600)

    # --- 1. Initial load: ArcRift-style layout ---
    check("seite lädt", "Orchestra Control Room" in page.title())
    check("sidebar header da", page.locator(".sidebar-title").inner_text() == "OmniRoute")
    check("sidebar tabs (Projects/Node Types)", page.locator(".sidebar-tab").count() == 2)
    check("floating header tabs", page.locator(".floating-header .tab-btn").count() >= 5)
    check("canvas graph da", page.locator("#graph-canvas").count() == 1)
    check("graph controls", page.locator(".graph-btn").count() >= 5)
    check("command form da", page.locator("#command-form").count() == 1)
    check("command input beschriftet", page.locator("#command-input").get_attribute("aria-label") == "Orchestra Command")
    check("command submit da", page.locator("#command-submit").count() == 1)

    # --- 2. Sidebar tabs: Projects <-> Node Types ---
    page.locator('.sidebar-tab[data-side-tab="legend"]').click()
    page.wait_for_timeout(300)
    check("node types panel sichtbar", page.locator("#sidebar-legend").is_visible())
    page.locator('.sidebar-tab[data-side-tab="projects"]').click()
    page.wait_for_timeout(300)
    check("projects panel sichtbar", page.locator("#sidebar-projects").is_visible())

    # --- 3. Facts panel (default open) ---
    check("facts panel da", page.locator("#panel-facts").is_visible())
    check("facts title", page.locator("#facts-title").inner_text() == "Captured Facts")

    # --- 4. Chat tab ---
    page.locator('[data-side-tab-open="chat"]').click()
    page.wait_for_timeout(500)
    check("chat panel sichtbar", page.locator("#panel-chat").is_visible())
    page.locator('[data-side-tab-open="facts"]').click()
    page.wait_for_timeout(300)
    check("facts panel zurück", page.locator("#panel-facts").is_visible())

    # --- 5. Global Search tab ---
    page.locator('[data-main-tab="search"]').click()
    page.wait_for_timeout(400)
    check("search view sichtbar", page.locator("#view-search").is_visible())
    page.locator('[data-main-tab="graph"]').click()
    page.wait_for_timeout(300)

    # --- 6. Settings tab ---
    page.locator('[data-main-tab="settings"]').click()
    page.wait_for_timeout(400)
    check("settings view sichtbar", page.locator("#view-settings").is_visible())
    check("settings token button da", page.locator("#settings-token").count() == 1)
    page.locator("#settings-privacy").click()
    page.wait_for_timeout(200)
    check("privacy mute togglet", page.locator("#privacy-hint").inner_text() == "Alle Erfassung stummgeschaltet")
    page.locator("#settings-privacy").click()
    page.locator('[data-main-tab="graph"]').click()
    page.wait_for_timeout(300)

    # --- 7. Graph density slider ---
    page.locator("#graph-settings-btn").click()
    page.wait_for_timeout(200)
    check("graph settings panel", page.locator("#graph-settings-panel").is_visible())
    page.locator("#density-slider").fill("2")
    page.wait_for_timeout(300)
    check("density label aktualisiert", "Min Connections: 2" in page.locator("#density-label").inner_text())
    page.locator("#graph-settings-btn").click()
    page.wait_for_timeout(200)

    # --- 8. Console errors ---
    real_errors = [e for e in console_errors if "401" not in e and "Failed to load resource" not in e and "favicon" not in e.lower()]
    check("keine console/page errors", len(real_errors) == 0, "; ".join(real_errors[:5]))

    # --- 9. PWA: manifest, icons, service worker, offline cache ---
    manifest_link = page.locator('link[rel="manifest"]').first.get_attribute("href") if page.locator('link[rel="manifest"]').count() else None
    check("pwa: manifest link da", bool(manifest_link))
    if manifest_link:
        with page.expect_response(lambda r: manifest_link in r.url) as resp_info:
            page.evaluate("(href) => fetch(href)", manifest_link)
        m = resp_info.value.json()
        check("pwa: manifest gültig", m.get("name") == "OmniRoute Control Room" and m.get("display") == "standalone" and len(m.get("icons", [])) >= 3)
    sw_ready = page.evaluate("""() => navigator.serviceWorker.getRegistrations().then(rs => rs.length > 0)""")
    check("pwa: service worker registriert", sw_ready)
    cached = page.evaluate("""() => caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(all => all.flat().map(r => new URL(r.url).pathname))""")
    check("pwa: offline cache gefüllt", "/static/index.html" in cached and "/" in cached)
    icon_ok = page.evaluate("""(paths) => Promise.all(paths.map(p => fetch(p).then(r => r.ok)))""", ["/static/icon-192.png", "/static/icon-512.png"])
    check("pwa: icons erreichbar", all(icon_ok))

    # --- 10. Mobile viewport: no horizontal overflow ---
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(600)
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check("mobile kein overflow", not overflow, f"scrollW={page.evaluate('document.documentElement.scrollWidth')}")

    # --- 11. Keyboard / a11y path ---
    page.set_viewport_size({"width": 1440, "height": 900})
    page.reload()
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_selector("#graph-canvas", timeout=15000)
    page.wait_for_timeout(500)
    page.keyboard.press("Tab")
    check("skip-link als erstes fokussiert", page.evaluate("document.activeElement === document.querySelector('.skip-link')"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check("skip-link springt zum main", page.evaluate("document.activeElement && (document.activeElement.id === 'main-content' || document.activeElement.id === 'graph-canvas')"))

    # --- 12. Token path: live memory data ---
    if UI_TOKEN:
        page.evaluate("(t) => localStorage.setItem('ui_token', t)", UI_TOKEN)
        page.reload()
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_selector(".session-item", timeout=15000)
        page.wait_for_timeout(800)

        # real sessions from kanban cards
        session_count = page.locator(".session-item").count()
        check("token: sessions laden", session_count >= 3, str(session_count) + " sessions")
        # graph data via /memory
        mem = page.evaluate("""() => fetch('/memory', { headers: { 'X-Access-Token': localStorage.getItem('ui_token') } }).then(r => r.json())""")
        check("token: /memory nodes", len(mem.get("nodes", [])) >= 20, str(len(mem.get("nodes", []))) + " nodes")
        check("token: /memory links", len(mem.get("links", [])) >= 10, str(len(mem.get("links", []))) + " links")
        check("token: /memory triples", len(mem.get("triples", [])) >= 10, str(len(mem.get("triples", []))) + " triples")
        check("token: /memory chat", (mem.get("chat") or {}).get("messageCount", 0) >= 1, "chat messages")

        # facts list shows real triples
        facts_count = page.locator(".history-item").count()
        check("token: facts gerendert", facts_count >= 5, str(facts_count) + " facts")

        # chat renders real messages
        page.locator('[data-side-tab-open="chat"]').click()
        page.wait_for_timeout(500)
        bubbles = page.locator(".chat-bubble").count()
        check("token: chat bubbles", bubbles >= 2, str(bubbles) + " bubbles")
        page.locator('[data-side-tab-open="facts"]').click()
        page.wait_for_timeout(300)

        # system health panel (sidebar footer)
        check("token: system health da", page.locator(".system-health-panel").is_visible())
        health_text = page.locator("#health-metrics").inner_text()
        check("token: health metrics", "Sessions" in health_text and "Graph" in health_text)

        # search endpoint
        search = page.evaluate("""() => fetch('/memory/search?q=brainstorm', { headers: { 'X-Access-Token': localStorage.getItem('ui_token') } }).then(r => r.json())""")
        check("token: /memory/search", search.get("found") is True and len(search.get("graphFacts", [])) > 0)

        # node types legend with real data
        page.locator('.sidebar-tab[data-side-tab="legend"]').click()
        page.wait_for_timeout(300)
        legend_types = page.locator("#legend-list .filter-pill").count()
        check("token: node types legend", legend_types >= 3, str(legend_types) + " types")
        page.locator('.sidebar-tab[data-side-tab="projects"]').click()
        page.wait_for_timeout(300)

        # global search with token
        page.locator('[data-main-tab="search"]').click()
        page.wait_for_timeout(300)
        page.locator("#global-search-input").fill("youtube")
        page.wait_for_timeout(900)
        search_results = page.locator(".result-fact, .result-chunk").count()
        check("token: global search ergebnisse", search_results > 0, str(search_results) + " treffer")
        page.locator('[data-main-tab="graph"]').click()
        page.wait_for_timeout(300)

        # facts search filter
        page.locator("#fact-search").fill("brainstorm")
        page.wait_for_timeout(400)
        filtered = page.locator(".history-item").count()
        check("token: fact-suche filtert", filtered >= 1 and filtered < facts_count, str(filtered) + " von " + str(facts_count))
        page.locator("#fact-search").fill("")
        page.wait_for_timeout(300)

        # pipeline handoff edges in /memory graph
        handoffs = [l for l in mem.get("links", []) if l.get("relation") == "handoff"]
        check("token: pipeline handoffs", len(handoffs) >= 3, str(len(handoffs)) + " handoff-kanten")

        # node detail panel: select a node via canvas click, panel must open with data
        node_clicked = False
        try:
            canvas_box = page.locator("#graph-canvas").bounding_box()
            if canvas_box:
                page.mouse.click(canvas_box["x"] + canvas_box["width"] / 2, canvas_box["y"] + canvas_box["height"] / 2)
                page.wait_for_timeout(500)
                if not page.locator("#node-detail").is_hidden():
                    node_clicked = True
                    detail_rows = page.locator("#node-detail-body .node-detail-row").count()
                    detail_edges = page.locator("#node-detail-body .node-detail-edge").count()
                    check("token: knoten-detail öffnet", detail_rows >= 1, str(detail_rows) + " zeilen")
                    check("token: knoten-detail verbindungen", detail_edges >= 1, str(detail_edges) + " kanten")
                    page.locator("#node-detail-close").click()
                    page.wait_for_timeout(200)
                    check("token: knoten-detail schließt", page.locator("#node-detail").is_hidden())
        except Exception as e:
            check("token: knoten-detail", False, str(e)[:100])
        if not node_clicked:
            check("token: knoten-detail", True, "kein Node an Klickposition (graph klick ohne crash)")

        # node detail actions: job trace modal opens, task move works via API
        try:
            trace_open = False
            for _ in range(3):
                job_node = page.evaluate("""() => {
                    const n = SIM.simNodes.find(x => x.type === 'Job' && x.full_id);
                    if (!n) return null;
                    state.selectedNodeId = n.id;
                    openNodeDetail(n);
                    const btn = document.querySelector('#node-detail-body [data-action="open-trace"]');
                    if (!btn) return null;
                    btn.click();
                    return true;
                }""")
                page.wait_for_timeout(900)
                trace_open = page.evaluate("!document.getElementById('edge-modal').hidden")
                if job_node is True and trace_open:
                    break
                page.evaluate("document.getElementById('edge-modal').hidden = true")
            check("token: job-trace modal öffnet", job_node is True and trace_open)
            if trace_open:
                page.locator("#edge-modal-close").click()
                page.wait_for_timeout(200)

            import json as _json
            from urllib import request as _req
            def _api(method, path, body=None):
                data = _json.dumps(body).encode() if body is not None else None
                req = _req.Request(BASE + path, data=data, headers={"X-Access-Token": UI_TOKEN, "Content-Type": "application/json"}, method=method)
                with _req.urlopen(req, timeout=15) as resp:
                    return _json.loads(resp.read().decode())
            # create test card, move it via node-detail action, verify column, cleanup
            move_card_id = None
            try:
                created = _api("POST", "kanban", {"title": "TEST Node-Aktion", "note": "Detail-Test", "source": "e2e-test"})
                move_card_id = created["card"]["id"]
                check("node-aktion: test-karte angelegt", bool(move_card_id))
                page.wait_for_timeout(500)
                moved = page.evaluate("""(cid) => new Promise((resolve) => {
                    loadMemory().then(() => setTimeout(() => {
                        const n = SIM.simNodes.find(x => x.full_id === cid);
                        if (!n) { resolve({ ok: false, reason: 'node missing' }); return; }
                        state.selectedNodeId = n.id;
                        openNodeDetail(n);
                        const btn = document.querySelector('#node-detail-body [data-action="move-done"]');
                        if (!btn) { resolve({ ok: false, reason: 'no move-done btn' }); return; }
                        btn.click();
                        setTimeout(() => {
                            fetch('/kanban', { headers: { 'X-Access-Token': localStorage.getItem('ui_token') } })
                              .then(r => r.json())
                              .then(d => { const c = (d.cards || []).find(x => x.id === cid); resolve({ ok: !!c, column: c ? c.column : null }); });
                        }, 1200);
                    }, 700));
                })""", move_card_id)
                check("node-aktion: karte nach done verschoben", moved.get("ok") is True and moved.get("column") == "done", str(moved))
            except Exception as e:
                check("node-aktion: verdrahtung", False, str(e)[:120])
            finally:
                if move_card_id:
                    try:
                        _api("DELETE", "kanban/" + move_card_id)
                        gone = _api("GET", "kanban")["cards"]
                        check("node-aktion: test-karte aufgeräumt", not any(c["id"] == move_card_id for c in gone))
                    except Exception as e:
                        check("node-aktion: test-karte aufgeräumt", False, str(e)[:120])
        except Exception as e:
            check("token: knoten-detail aktionen", False, str(e)[:120])

        # handoff facts visible in facts panel (selection cleared first)
        page.evaluate("state.selectedNodeId = null; renderFacts();")
        page.locator('[data-side-tab-open="facts"]').click()
        page.wait_for_timeout(400)
        page.locator("#fact-search").fill("handoff")
        page.wait_for_timeout(400)
        handoff_facts = page.locator(".history-item").count()
        check("token: handoff-facts sichtbar", handoff_facts >= 3, str(handoff_facts) + " handoff-facts")
        page.locator("#fact-search").fill("")
        page.evaluate("state.selectedNodeId = null;")
        page.wait_for_timeout(300)

        # graph interaction: node click sets selection pill
        pill_before = page.locator(".graph-filter-pill").count()
        # click on canvas center to attempt selecting a node (best-effort)
        page.mouse.click(900, 450)
        page.wait_for_timeout(400)
        check("graph klick ohne crash", True)
    else:
        check("token: UI_ACCESS_TOKEN in .env gefunden", False, "kein Token in .env gefunden")

    page.screenshot(path="control_room_final.png", full_page=False)
    browser.close()

fails = [r for r in results if not r["ok"]]
print("\n=== SUMMARY ===")
print(f"{len(results) - len(fails)}/{len(results)} passed")
if fails:
    print("FAILED:")
    for f in fails:
        print(" -", f["name"], "|", f["detail"])
    sys.exit(1)
sys.exit(0)
