import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  honorBundlerFlagFromEnvFile,
  resolveNextBuildBundlerFlag,
} from "../../../scripts/build/build-next-isolated.mjs";

/** Throwaway project dir carrying a `.env` with the given bundler setting. */
function makeProjectDir(envLine) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-bundler-env-"));
  fs.writeFileSync(path.join(dir, ".env"), `OTHER_SETTING=1\n${envLine}\n`);
  return dir;
}

test("resolveNextBuildBundlerFlag returns --turbopack by default", () => {
  // Platform pinned: the default is platform-dependent since #12059, so a bare call
  // would assert this machine's architecture instead of the rule being tested.
  const flag = resolveNextBuildBundlerFlag({}, "linux", "x64");
  assert.equal(flag, "--turbopack");
});

test("resolveNextBuildBundlerFlag returns --webpack when OMNIROUTE_USE_TURBOPACK is '0'", () => {
  const flag = resolveNextBuildBundlerFlag({ OMNIROUTE_USE_TURBOPACK: "0" });
  assert.equal(flag, "--webpack");
});

test("resolveNextBuildBundlerFlag returns --turbopack when OMNIROUTE_USE_TURBOPACK is '1'", () => {
  const flag = resolveNextBuildBundlerFlag({ OMNIROUTE_USE_TURBOPACK: "1" });
  assert.equal(flag, "--turbopack");
});

// `npm run build` is the only entry point that never loads `.env` (the dev server
// goes through scripts/dev/run-next.mjs → bootstrapEnv()). So the documented
// escape hatch for the macOS arm64 Turbopack stall (#6409/#9695) was silently
// ignored on the build path: `.env` said 0 and the build still ran Turbopack.
test("honorBundlerFlagFromEnvFile fills OMNIROUTE_USE_TURBOPACK from .env", () => {
  const dir = makeProjectDir("OMNIROUTE_USE_TURBOPACK=0");
  const env = {};
  honorBundlerFlagFromEnvFile(env, dir);
  assert.equal(env.OMNIROUTE_USE_TURBOPACK, "0");
  assert.equal(resolveNextBuildBundlerFlag(env), "--webpack");
});

test("honorBundlerFlagFromEnvFile lets the shell env win over .env", () => {
  const dir = makeProjectDir("OMNIROUTE_USE_TURBOPACK=0");
  const env = { OMNIROUTE_USE_TURBOPACK: "1" };
  honorBundlerFlagFromEnvFile(env, dir);
  assert.equal(env.OMNIROUTE_USE_TURBOPACK, "1");
  assert.equal(resolveNextBuildBundlerFlag(env), "--turbopack");
});

test("honorBundlerFlagFromEnvFile is a no-op when .env is missing", () => {
  const env = {};
  honorBundlerFlagFromEnvFile(env, fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-no-env-")));
  assert.equal(env.OMNIROUTE_USE_TURBOPACK, undefined);
  // Platform pinned for the same reason as the default case above.
  assert.equal(resolveNextBuildBundlerFlag(env, "linux", "x64"), "--turbopack");
});

// Turbopack is unusable on macOS arm64 with Next 16.3.2: `next build` never converges
// (25 min+, chunks pinned at 20) and `next dev` never reaches listen state, while the
// same commits are green in CI on Linux x64. See issue #12059.
test("resolveNextBuildBundlerFlag defaults to --webpack on darwin/arm64", () => {
  assert.equal(resolveNextBuildBundlerFlag({}, "darwin", "arm64"), "--webpack");
});

test("resolveNextBuildBundlerFlag still defaults to --turbopack on linux", () => {
  assert.equal(resolveNextBuildBundlerFlag({}, "linux", "x64"), "--turbopack");
});

test("resolveNextBuildBundlerFlag defaults to --turbopack on darwin/x64 (Intel Mac)", () => {
  // The stall is specific to arm64; do not penalise Intel Macs on a guess.
  assert.equal(resolveNextBuildBundlerFlag({}, "darwin", "x64"), "--turbopack");
});

test("an explicit OMNIROUTE_USE_TURBOPACK=1 still wins on darwin/arm64", () => {
  // The platform default only applies when the operator has NOT chosen. Overriding an
  // explicit request is exactly what the original env-only design guarded against.
  assert.equal(
    resolveNextBuildBundlerFlag({ OMNIROUTE_USE_TURBOPACK: "1" }, "darwin", "arm64"),
    "--turbopack"
  );
});
