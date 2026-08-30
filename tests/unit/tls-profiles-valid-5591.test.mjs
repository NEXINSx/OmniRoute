import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #5591 regression guard: every TLS impersonation profile referenced in
// the source must be a real wreq-js BrowserProfile. PR #5237 set them to
// "chrome_149", which does not exist in wreq-js 2.3.1 (the union tops out at
// chrome_147) — the native layer then produced a degenerate fingerprint and the
// Codex Responses WebSocket upstream rejected the upgrade ("Invalid JSON body").
// This test reads the supported set straight from the installed wreq-js type
// definitions, so it stays correct as the dependency is upgraded.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function supportedProfiles() {
  const dts = fs.readFileSync(
    path.join(ROOT, "node_modules", "wreq-js", "dist", "wreq-js.d.ts"),
    "utf8"
  );
  const union = dts.match(/type BrowserProfile = ([^;]+);/)?.[1] ?? "";
  return new Set([...union.matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

const PROVIDER_PROFILES = {
  "open-sse/services/chatgptTlsClient.ts": ["firefox_148", "macos"],
  "open-sse/services/claudeTlsClient.ts": ["chrome_146", "linux"],
  "open-sse/services/perplexityTlsClient.ts": ["firefox_148", "macos"],
  "open-sse/services/grokTlsClient.ts": ["chrome_146", "linux"],
  "open-sse/services/notionTlsClient.ts": ["chrome_146", "windows"],
  "open-sse/services/lmarenaTlsClient.ts": ["chrome_146", "windows"],
};

// Other source files that hand a browser profile directly to wreq-js.
const SOURCES = [
  "src/app/api/internal/codex-responses-ws/route.ts",
  "scripts/dev/responses-ws-proxy.mjs",
  ...Object.keys(PROVIDER_PROFILES),
];

// Strip comments before scanning — explanatory comments may name the bad
// profile ("chrome_149 absent in 2.3.1") without it ever reaching wreq-js.
function stripComments(line) {
  return line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
}

test("#5591 all configured browser TLS profiles exist in pinned wreq-js", () => {
  const supported = supportedProfiles();
  assert.ok(supported.size > 0, "expected to parse BrowserProfile from wreq-js d.ts");

  for (const rel of SOURCES) {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = stripComments(line);
      for (const m of code.matchAll(/\b(?:chrome|firefox|edge|opera|safari|okhttp)_[\w.]+/g)) {
        const profile = m[0];
        assert.ok(
          supported.has(profile),
          `${rel}:${i + 1} uses ${profile} which is NOT a wreq-js BrowserProfile ` +
            `(supported: ${[...supported].sort().join(", ")})`
        );
      }
    });
  }

  for (const [rel, [profile, os]] of Object.entries(PROVIDER_PROFILES)) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(supported.has(profile), `${rel} expected unsupported ${profile}`);
    if (rel.endsWith("claudeTlsClient.ts")) {
      assert.match(source, /CLAUDE_TLS_BROWSER_MAJOR_VERSION = "146"/);
      assert.match(source, /tlsProfile: `chrome_\$\{CLAUDE_TLS_BROWSER_MAJOR_VERSION\}`/);
    } else {
      assert.match(source, new RegExp(`tlsProfile: ["']${profile}["']`));
    }
    assert.match(source, new RegExp(`emulationOs: ["']${os}["']`));
  }
});
