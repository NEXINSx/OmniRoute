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
  const flag = resolveNextBuildBundlerFlag({});
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
  assert.equal(resolveNextBuildBundlerFlag(env), "--turbopack");
});
