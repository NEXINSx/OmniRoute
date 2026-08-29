import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// run-next.mjs has top-level side effects (bootstrapEnv, native sqlite, server
// listen) so it cannot be imported in-process. Guard the fix by inspecting the
// source: the dev/start server MUST force NODE_ENV to match the run mode, after
// the mergedEnv copy loop (which pulls NODE_ENV=production from .env/.env.example)
// and before next() is constructed. Otherwise `npm run dev` boots the dev
// bundler with NODE_ENV=production, which breaks Next's webpack CSS pipeline and
// fails globals.css with "Unexpected character '@'" on `@import "tailwindcss"`.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, "../../scripts/dev/run-next.mjs"), "utf8");

// Quote- and whitespace-tolerant so legitimate Prettier/formatting changes
// don't trip the guard; only a real change to the assignment shape should.
const NODE_ENV_NORMALIZE =
  /process\.env\.NODE_ENV\s*=\s*dev\s*\?\s*['"]development['"]\s*:\s*['"]production['"]/;

test("run-next.mjs forces NODE_ENV to track the run mode", () => {
  assert.match(
    source,
    NODE_ENV_NORMALIZE,
    "expected NODE_ENV to be forced to development in dev mode, production otherwise"
  );
});

test("NODE_ENV normalization runs after the merged-env copy and before next()", () => {
  const copyLoopIdx = source.search(/process\.env\[key\]\s*=\s*value/);
  const normalizeIdx = source.search(NODE_ENV_NORMALIZE);
  const nextCallIdx = source.search(/\bnext\s*\(\s*\{/);

  assert.ok(copyLoopIdx !== -1, "expected the mergedEnv copy loop to exist");
  assert.ok(normalizeIdx !== -1, "expected the NODE_ENV normalization to exist");
  assert.ok(nextCallIdx !== -1, "expected the next() construction to exist");
  assert.ok(
    normalizeIdx > copyLoopIdx,
    "NODE_ENV must be normalized AFTER the env copy loop (else .env overwrites it)"
  );
  assert.ok(normalizeIdx < nextCallIdx, "NODE_ENV must be normalized BEFORE next() reads it");
});

// run-next.mjs still cannot be imported in-process, so this stays a source guard like
// the cases above. #12059: on macOS arm64 Turbopack never finishes the first dev
// compile — measured at 5 min with zero progress past "Compiling instrumentation
// Node.js", where webpack dev reaches listen state. The dev path must therefore fall
// back to the same platform default the build path uses instead of hardcoding
// Turbopack, while still letting an operator-set value win.
test("run-next.mjs falls back to the platform bundler default when unset", () => {
  assert.match(
    source,
    /isTurbopackStallPlatform\s*\(/,
    "run-next.mjs must consult isTurbopackStallPlatform() so dev and build agree on the default"
  );
  assert.match(
    source,
    /devBundlerExplicit\s*!==\s*undefined/,
    "the platform default must only apply when OMNIROUTE_USE_TURBOPACK is unset, so an explicit operator choice still wins"
  );
  assert.ok(
    !/const useTurbopack = dev && [^;]*OMNIROUTE_USE_TURBOPACK !== "0" && !isBun;/.test(source),
    "run-next.mjs must not unconditionally default dev to Turbopack (#12059)"
  );
});
