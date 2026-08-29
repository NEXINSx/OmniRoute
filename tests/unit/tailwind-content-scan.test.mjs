import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const globalsCss = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** Lines that add a source root: `@source "<glob>"` without the `not` keyword. */
function positiveSources(css) {
  return css
    .split("\n")
    .map((line) => line.match(/^\s*@source\s+(?!not\s)"([^"]+)"\s*;/))
    .filter(Boolean)
    .map((match) => match[1]);
}

test("globals.css disables Tailwind v4 automatic content detection", () => {
  // Tailwind v4's auto-detection walks the whole repository root from
  // src/app/globals.css — tests/ (~5k files), docs/, CHANGELOG.md (~2.4 MB) and
  // everything else — costing ~13.5s per cold process. The Turbopack build
  // delegates this postcss transform to a pool of short-lived node workers, so
  // every worker respawn re-paid the full scan (44 respawns observed in 11 min).
  assert.match(
    globalsCss,
    /@import\s+"tailwindcss"\s+source\(none\)\s*;/,
    "globals.css must import tailwindcss with source(none) so the content scan is bounded by the explicit @source directives below"
  );
});

test("globals.css declares an explicit source root covering the app tree", () => {
  // source(none) with no positive @source emits ZERO utilities — an unstyled
  // dashboard with no build error. src/app/globals.css lives at src/app/, so
  // "../" resolves to src/, which is where every production className lives
  // (verified by repo-wide grep). Route groups with parentheses cannot be
  // globbed, hence the separate @source "../app/(dashboard)" entry.
  const sources = positiveSources(globalsCss);
  assert.ok(
    sources.length > 0,
    "source(none) requires at least one explicit @source directive or no utilities are generated"
  );
  assert.ok(
    sources.includes("../"),
    `expected @source "../" (the whole src/ tree) among the source roots: ${sources.join(", ")}`
  );
  assert.ok(
    sources.includes("../app/(dashboard)"),
    `expected @source "../app/(dashboard)" — Tailwind cannot glob parenthesised route groups: ${sources.join(", ")}`
  );
});

test("globals.css keeps the fumadocs and sqlite/.claude scan exclusions", () => {
  // The fumadocs sources supply the docs theme utilities; the `not` entries keep
  // the scan off database files and the local agent directory. Dropping either
  // changes the emitted stylesheet or re-introduces junk scanning.
  const sources = positiveSources(globalsCss);
  assert.ok(
    sources.some((s) => s.includes("fumadocs-ui")),
    `expected a fumadocs-ui source root: ${sources.join(", ")}`
  );
  assert.match(globalsCss, /@source\s+not\s+"\.\.\/\.\.\/\*\.sqlite\*"\s*;/);
  assert.match(globalsCss, /@source\s+not\s+"\.\.\/\.\.\/\.claude\*"\s*;/);
});
