import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the distributable is pinned to wreq-js 3.0.0 with no tls-client-node or orphaned koffi residue", () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    files: string[];
    optionalDependencies: Record<string, string>;
  };
  assert.equal(packageJson.optionalDependencies["wreq-js"], "3.0.0");
  assert.equal(packageJson.optionalDependencies["tls-client-node"], undefined);
  assert.equal(packageJson.files.includes("scripts/build/fixTlsClientNodeBinary.mjs"), false);

  for (const relativePath of [
    "package-lock.json",
    "next.config.mjs",
    "Dockerfile",
    "Dockerfile.bun",
    "pnpm.json",
    "pnpm-workspace.yaml",
    "config/quality/dependency-allowlist.json",
    "config/quality/.license-allowlist.json",
    "scripts/build/postinstall.mjs",
    "scripts/build/pack-artifact-policy.ts",
  ]) {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /tls-client-node/i,
      `${relativePath} still references tls-client-node`
    );
    assert.doesNotMatch(source, /\bkoffi\b/i, `${relativePath} still references orphaned koffi`);
  }

  assert.equal(existsSync(join(ROOT, "open-sse/services/tlsClientDownloadDir.ts")), false);
  assert.equal(existsSync(join(ROOT, "scripts/build/fixTlsClientNodeBinary.mjs")), false);

  for (const relativePath of [
    ".env.example",
    "docs/reference/ENVIRONMENT.md",
    "docs/security/STEALTH_GUIDE.md",
  ]) {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /OMNIROUTE_TLS_PROXY_URL/,
      `${relativePath} still documents the removed sidecar override`
    );
  }
});
