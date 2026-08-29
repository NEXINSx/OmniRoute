// tests/unit/combo/combo-lkgp-clear.test.ts
// #11911 regression: when a combo target is marked exhausted (providerExhausted or the
// connection added to exhaustedConnections), the Last Known Good Provider (LKGP) pin must
// be cleared so the next request doesn't re-pin the same dead provider/connection.
//
// Locks the exact clearing rules of clearLKGPOnExhaustion (shared by handleComboChat +
// handleRoundRobinCombo):
//   - the `executionKey` pin always names the target that just failed → always cleared on
//     exhaustion of that target;
//   - the combo-level pin (the only one read by applyStrategyOrdering / resolveAutoStrategy)
//     records whichever target last succeeded, which needn't be the one that just failed →
//     cleared only when it names the exhausted provider and, when both carry a connectionId,
//     the exhausted connection. A preference pointing at a healthy target survives.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-lkgp-clear-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { getDbInstance, resetDbInstance } = await import("../../../src/lib/db/core.ts");
const { getLKGP, setLKGP } = await import("../../../src/lib/db/settings/lkgp.ts");
const { clearLKGPOnExhaustion } = await import("../../../open-sse/services/combo/lkgpClearing.ts");

const log = { info() {}, warn() {}, error() {}, debug() {} };

function resetStorage() {
  try {
    if (globalThis.__omnirouteDb?.open) {
      globalThis.__omnirouteDb.close();
    }
  } catch {}
  delete globalThis.__omnirouteDb;
  resetDbInstance();
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  getDbInstance();
}

// Seeds the same two pins handleComboChat writes on success: the per-target
// executionKey pin and the combo-level pin.
function seedPins(comboName: string, comboKey: string, provider: string, connId?: string) {
  setLKGP(comboName, comboKey, provider, connId ?? undefined);
  setLKGP(comboName, "openai/gpt-4o", provider, connId ?? undefined);
}

const comboName = "test-combo";
const comboKey = "test-combo"; // combo.id || combo.name

test("provider-level exhaustion clears both the executionKey and the combo-level pin", async () => {
  resetStorage();
  seedPins(comboName, comboKey, "openai");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "openai/gpt-4o", provider: "openai", connectionId: null },
    providerExhausted: true,
    exhaustedConnections: new Set(),
    log,
    tag: "COMBO",
  });

  assert.equal(await getLKGP(comboName, comboKey), null, "combo-level pin must be cleared");
  assert.equal(await getLKGP(comboName, "openai/gpt-4o"), null, "executionKey pin must be cleared");
});

test("connection-level exhaustion clears both pins when they name the exact connection", async () => {
  resetStorage();
  seedPins(comboName, comboKey, "openai", "conn-1");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "openai/gpt-4o", provider: "openai", connectionId: "conn-1" },
    providerExhausted: false,
    exhaustedConnections: new Set(["openai:conn-1"]),
    log,
    tag: "COMBO",
  });

  assert.equal(await getLKGP(comboName, comboKey), null, "combo-level pin must be cleared");
  assert.equal(await getLKGP(comboName, "openai/gpt-4o"), null, "executionKey pin must be cleared");
});

test("combo-level pin for a different, healthy provider is kept", async () => {
  resetStorage();
  // Pin names provider B (the last successful target). A DIFFERENT target (A:conn-1)
  // exhausts this request — B was never unhealthy, so its preference must survive.
  seedPins(comboName, comboKey, "provider-b");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "a-model", provider: "provider-a", connectionId: "conn-1" },
    providerExhausted: true,
    exhaustedConnections: new Set(["provider-a:conn-1"]),
    log,
    tag: "COMBO",
  });

  assert.deepEqual(
    await getLKGP(comboName, comboKey),
    { provider: "provider-b" },
    "combo-level pin naming a healthy provider must survive"
  );
});

test("combo-level pin naming a different connection of the same provider is kept", async () => {
  resetStorage();
  // Pin names provider-a:conn-2 — a healthy SIBLING connection. Exhausting conn-1 must
  // not drop the sibling's preference.
  seedPins(comboName, comboKey, "provider-a", "conn-2");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "provider-a/gpt-4o", provider: "provider-a", connectionId: "conn-1" },
    providerExhausted: true,
    exhaustedConnections: new Set(["provider-a:conn-1"]),
    log,
    tag: "COMBO",
  });

  assert.deepEqual(
    await getLKGP(comboName, comboKey),
    { provider: "provider-a", connectionId: "conn-2" },
    "combo-level pin naming a healthy sibling connection must survive"
  );
  assert.equal(
    await getLKGP(comboName, "provider-a/gpt-4o"),
    null,
    "the exhausted target's own executionKey pin must still be cleared"
  );
});

test("provider-level exhaustion clears a connection-scoped combo pin for that provider", async () => {
  resetStorage();
  // Whole provider is dead; even a connection-scoped pin for that provider should go.
  seedPins(comboName, comboKey, "openai", "conn-7");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "openai/gpt-4o", provider: "openai", connectionId: null },
    providerExhausted: true,
    exhaustedConnections: new Set(),
    log,
    tag: "COMBO",
  });

  assert.equal(await getLKGP(comboName, comboKey), null);
});

test("no exhaustion marks nothing and both pins survive", async () => {
  resetStorage();
  seedPins(comboName, comboKey, "openai", "conn-1");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "openai/gpt-4o", provider: "openai", connectionId: "conn-1" },
    providerExhausted: false,
    exhaustedConnections: new Set(),
    log,
    tag: "COMBO",
  });

  assert.deepEqual(await getLKGP(comboName, comboKey), {
    provider: "openai",
    connectionId: "conn-1",
  });
  assert.ok(await getLKGP(comboName, "openai/gpt-4o"), "executionKey pin must survive");
});

test("unknown provider is never cleared (guard)", async () => {
  resetStorage();
  seedPins(comboName, comboKey, "openai");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "unknown/gpt-4o", provider: "unknown", connectionId: null },
    providerExhausted: true,
    exhaustedConnections: new Set(),
    log,
    tag: "COMBO",
  });

  assert.deepEqual(await getLKGP(comboName, comboKey), { provider: "openai" });
});

test("a connection-scoped 401 (providerExhausted true + conn in exhaustion set) clears only when the pin names that exact provider:connection", async () => {
  resetStorage();
  // Mirrors the #8137 auth case: providerExhausted returns true BUT the exhaustion is
  // connection-scoped (a 401 on conn-1). A pin on the SAME provider's different
  // connection is a healthy sibling — it must survive.
  seedPins(comboName, comboKey, "provider-a", "conn-2");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "provider-a/gpt-4o", provider: "provider-a", connectionId: "conn-1" },
    providerExhausted: true,
    exhaustedConnections: new Set(["provider-a:conn-1"]),
    log,
    tag: "COMBO",
  });

  assert.deepEqual(
    await getLKGP(comboName, comboKey),
    { provider: "provider-a", connectionId: "conn-2" },
    "a connection-scoped auth failure must not clear a sibling connection's pin"
  );
});

test("legacy provider-only combo pin is cleared when that provider exhausts without a connectionId", async () => {
  resetStorage();
  // setLKGP stores `{provider}` when no connectionId is available — the legacy shape.
  setLKGP(comboName, comboKey, "openai");
  setLKGP(comboName, "openai/gpt-4o", "openai");

  await clearLKGPOnExhaustion({
    comboName,
    comboKey,
    target: { executionKey: "openai/gpt-4o", provider: "openai", connectionId: null },
    providerExhausted: true,
    exhaustedConnections: new Set(),
    log,
    tag: "COMBO",
  });

  assert.equal(await getLKGP(comboName, comboKey), null);
});
