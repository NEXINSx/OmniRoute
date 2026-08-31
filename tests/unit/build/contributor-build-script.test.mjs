import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isContributorBuild,
  stubContributorInstrumentation,
} from "../../../scripts/build/backendOnlyPages.mjs";

const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
);

test("contributor build profile selects the webpack fallback", () => {
  assert.match(
    packageJson.scripts["build:contributor"],
    /OMNIROUTE_USE_TURBOPACK=0/
  );
});

test("contributor build profile skips standalone packaging", () => {
  assert.equal(isContributorBuild({ OMNIROUTE_BUILD_PROFILE: "contributor" }), true);
  assert.equal(isContributorBuild({ OMNIROUTE_BUILD_PROFILE: "backend" }), false);
});

test("contributor instrumentation stubs are reversible", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omniroute-contributor-"));
  const instrumentationDir = path.join(tempRoot, "src");
  await fs.mkdir(instrumentationDir, { recursive: true });
  const files = ["instrumentation.ts", "instrumentation-node.ts"];
  const originals = new Map();
  for (const file of files) {
    const target = path.join(instrumentationDir, file);
    const source = `export async function ${file === "instrumentation.ts" ? "register" : "registerNodejs"}() { return "original"; }`;
    originals.set(target, source);
    await fs.writeFile(target, source);
  }
  const stubbed = stubContributorInstrumentation(tempRoot, { warn() {} });
  assert.equal(stubbed.length, 2);
  for (const entry of stubbed) await fs.writeFile(entry.file, entry.original);
  for (const [target, source] of originals) assert.equal(await fs.readFile(target, "utf8"), source);
  await fs.rm(tempRoot, { recursive: true, force: true });
});
