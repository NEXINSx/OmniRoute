import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isContributorBuild } from "../../../scripts/build/backendOnlyPages.mjs";

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
