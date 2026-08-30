import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, "config/release/wreq-js-native-manifest.json");

interface NativeEntry {
  path: string;
  size: number;
  sha256: string;
}

interface NativeManifest {
  package: string;
  version: string;
  npmIntegrity: string;
  license: string;
  nativeAddons: NativeEntry[];
}

test("wreq-js 3.0.0 has an exact seven-platform native hash manifest and notice", () => {
  assert.equal(existsSync(MANIFEST_PATH), true, "native manifest must be committed");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as NativeManifest;
  assert.equal(manifest.package, "wreq-js");
  assert.equal(manifest.version, "3.0.0");
  assert.equal(
    manifest.npmIntegrity,
    "sha512-RZCoRSevVPpH4A4B4MxbFGo/pVPFveWd2gbe4ENKpPWlKXEYklZSDESOjBMmrIsmnkHh+nhM4PNJvG+NL7wBPA=="
  );
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.nativeAddons.length, 7);
  assert.deepEqual(manifest.nativeAddons.map((entry) => entry.path).sort(), [
    "rust/wreq-js.darwin-arm64.node",
    "rust/wreq-js.darwin-x64.node",
    "rust/wreq-js.linux-arm64-gnu.node",
    "rust/wreq-js.linux-arm64-musl.node",
    "rust/wreq-js.linux-x64-gnu.node",
    "rust/wreq-js.linux-x64-musl.node",
    "rust/wreq-js.win32-x64-msvc.node",
  ]);

  const packageRoot = join(ROOT, "node_modules/wreq-js");
  const installedPackage = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  };
  assert.equal(installedPackage.version, manifest.version);
  for (const entry of manifest.nativeAddons) {
    const bytes = readFileSync(join(packageRoot, entry.path));
    assert.equal(bytes.byteLength, entry.size, `${entry.path}: byte size`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256,
      `${entry.path}: sha256`
    );
  }

  const notices = readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.match(notices, /^## wreq-js 3\.0\.0$/m);
  assert.match(notices, /Copyright \(c\) 2025 will-work-for-meal/);
  assert.match(notices, /Copyright \(c\) 2025 Oleksandr Herasymov/);
});
