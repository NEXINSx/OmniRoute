/**
 * #11947 — built-in auto combos must derive their advertised modality contract
 * from the post-filter effective target pool exposed by createBuiltinAutoCombo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-11947-auto-modalities-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "catalog-11947-secret";

const core = await import("../../src/lib/db/core.ts");
const combosDb = await import("../../src/lib/db/combos.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const modelsDevSync = await import("../../src/lib/modelsDevSync.ts");
const builtinCatalog = await import("../../open-sse/services/autoCombo/builtinCatalog.ts");
const v1ModelsCatalog = await import("../../src/app/api/v1/models/catalog.ts");

type CapabilityEntry = {
  tool_call: boolean | null;
  reasoning: boolean | null;
  attachment: boolean | null;
  structured_output: boolean | null;
  temperature: boolean | null;
  modalities_input: string;
  modalities_output: string;
  knowledge_cutoff: string | null;
  release_date: string | null;
  last_updated: string | null;
  status: string | null;
  family: string | null;
  open_weights: boolean | null;
  limit_context: number | null;
  limit_input: number | null;
  limit_output: number | null;
  interleaved_field: string | null;
};

type CatalogCapabilities = {
  tool_calling?: boolean;
  reasoning?: boolean;
  thinking?: boolean;
  temperature?: boolean;
  vision?: boolean;
};

type CatalogRow = {
  id: string;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  capabilities?: CatalogCapabilities;
  input_modalities?: string[];
  output_modalities?: string[];
};

const VISION_AUTO_IDS = ["auto/best-vision", "auto/pro-vision", "auto/vision"] as const;
const BASELINE_CAPABILITIES = {
  tool_calling: true,
  reasoning: true,
  thinking: true,
  temperature: true,
};

function capabilityEntry(overrides: Partial<CapabilityEntry> = {}): CapabilityEntry {
  return {
    tool_call: true,
    reasoning: false,
    attachment: null,
    structured_output: true,
    temperature: true,
    modalities_input: JSON.stringify([]),
    modalities_output: JSON.stringify([]),
    knowledge_cutoff: null,
    release_date: null,
    last_updated: null,
    status: null,
    family: null,
    open_weights: false,
    limit_context: 128000,
    limit_input: 128000,
    limit_output: 16384,
    interleaved_field: null,
    ...overrides,
  };
}

async function resetStorage(): Promise<void> {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  v1ModelsCatalog.__resetCatalogBuilderRunsForTest();
}

async function seedOpenAiModels(
  models: Array<{ id: string; capability?: CapabilityEntry }>
): Promise<void> {
  const connection = (await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: `openai-11947-${Math.random().toString(16).slice(2, 8)}`,
    apiKey: "sk-test",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  })) as { id: string };

  await modelsDb.replaceSyncedAvailableModelsForConnection("openai", connection.id, models);

  const capabilities = Object.fromEntries(
    models
      .filter((model): model is { id: string; capability: CapabilityEntry } =>
        Boolean(model.capability)
      )
      .map((model) => [model.id, model.capability])
  );
  modelsDevSync.saveModelsDevCapabilities(
    Object.keys(capabilities).length > 0 ? { openai: capabilities } : {}
  );
}

async function fetchAutoRows(): Promise<Map<string, CatalogRow>> {
  const response = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models", { method: "GET" })
  );
  assert.equal(response.status, 200, "catalog setup must return HTTP 200");
  const body = (await response.json()) as { data: CatalogRow[] };
  return new Map(body.data.filter((row) => row.id.startsWith("auto/")).map((row) => [row.id, row]));
}

function requireRow(rows: Map<string, CatalogRow>, id: string): CatalogRow {
  const row = rows.get(id);
  assert.ok(row, `${id} setup precondition: catalog row must be advertised`);
  return row;
}

async function assertEffectivePoolIsNonEmpty(ids: readonly string[]): Promise<void> {
  const prepared = await builtinCatalog.prepareBuiltinAutoComboInputs();
  for (const id of ids) {
    const suffix = id.replace(/^auto\/?/, "");
    const virtualCombo = await builtinCatalog.createBuiltinAutoCombo(id, suffix, prepared);
    assert.ok(
      virtualCombo.models.length > 0,
      `${id} setup precondition: effective target pool must be non-empty`
    );
  }
}

test.beforeEach(async () => {
  await resetStorage();
  modelsDevSync.saveModelsDevCapabilities({});
  await settingsDb.updateSettings({
    autoRoutingEnabled: true,
    hideAutoCombos: false,
    blockedProviders: ["opencode"],
  });
});

test.after(() => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }
});

test("#11947 auto/* entries include capabilities object (baseline)", async () => {
  const rows = await fetchAutoRows();
  assert.ok(rows.size > 0, "sanity: at least one auto/* entry listed");

  for (const [id, row] of rows) {
    assert.ok(
      row.capabilities && typeof row.capabilities === "object",
      `${id} must have a capabilities object`
    );
    assert.equal(row.capabilities.tool_calling, true, `${id} tool_calling`);
    assert.equal(row.capabilities.reasoning, true, `${id} reasoning`);
  }
});

test("#11947 auto/* vision entries carry capabilities.vision when pool is vision-capable", async () => {
  await seedOpenAiModels([
    {
      id: "gpt-4o",
      capability: capabilityEntry({
        attachment: true,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  ]);

  await assertEffectivePoolIsNonEmpty(VISION_AUTO_IDS);
  const rows = await fetchAutoRows();

  for (const id of VISION_AUTO_IDS) {
    const row = requireRow(rows, id);
    assert.equal(row.capabilities?.vision, true, `${id} must advertise vision`);
    assert.deepEqual(row.capabilities, { ...BASELINE_CAPABILITIES, vision: true });
    assert.deepEqual(row.input_modalities, ["text", "image"]);
    assert.deepEqual(row.output_modalities, ["text"]);
  }
});

test("#11947 empty effective pools retain baseline limits and omit modality evidence", async () => {
  const prepared = await builtinCatalog.prepareBuiltinAutoComboInputs();
  for (const id of VISION_AUTO_IDS) {
    const virtualCombo = await builtinCatalog.createBuiltinAutoCombo(
      id,
      id.replace(/^auto\/?/, ""),
      prepared
    );
    assert.equal(
      virtualCombo.models.length,
      0,
      `${id} setup precondition: effective target pool must be empty`
    );
  }

  const rows = await fetchAutoRows();
  for (const id of VISION_AUTO_IDS) {
    const row = requireRow(rows, id);
    assert.equal(row.context_length, 128000);
    assert.equal(row.max_input_tokens, 128000);
    assert.equal(row.max_output_tokens, 8192);
    assert.deepEqual(row.capabilities, BASELINE_CAPABILITIES);
    assert.equal("input_modalities" in row, false);
    assert.equal("output_modalities" in row, false);
  }
});

test("#11947 unresolved effective targets fail closed without modality fields", async () => {
  await seedOpenAiModels([{ id: "unknown-metadata-11947" }]);
  await assertEffectivePoolIsNonEmpty(["auto/chat"]);

  const row = requireRow(await fetchAutoRows(), "auto/chat");
  assert.deepEqual(row.capabilities, BASELINE_CAPABILITIES);
  assert.equal("input_modalities" in row, false);
  assert.equal("output_modalities" in row, false);
});

test("#11947 missing input evidence omits vision while preserving independent output evidence", async () => {
  await seedOpenAiModels([
    {
      id: "vision-missing-input-11947",
      capability: capabilityEntry({
        attachment: true,
        modalities_input: JSON.stringify([]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  ]);
  await assertEffectivePoolIsNonEmpty(["auto/vision"]);

  const row = requireRow(await fetchAutoRows(), "auto/vision");
  assert.equal("vision" in (row.capabilities ?? {}), false);
  assert.equal("input_modalities" in row, false);
  assert.deepEqual(row.output_modalities, ["text"]);
});

// A genuinely heterogeneous pool under PROJECT semantics: the verdict that makes
// the pool mixed must come from a path `resolveVisionCapability` actually
// demotes, not from a raw `attachment` flag the resolver would have promoted.
// `mimo-v2.5-pro` is denylisted by KNOWN_TEXT_ONLY_DESPITE_SYNC (#4071), so its
// resolved verdict is false even though its synced row claims attachment:true
// with image modalities. Pairing it with a genuinely vision-capable target is
// the only shape that exercises unanimity rather than the raw flag.
test("#11947 mixed vision verdicts suppress image input but keep common output evidence", async () => {
  await seedOpenAiModels([
    {
      id: "gpt-4o",
      capability: capabilityEntry({
        attachment: true,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
    {
      id: "mimo-v2.5-pro",
      capability: capabilityEntry({
        attachment: true,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  ]);
  await assertEffectivePoolIsNonEmpty(["auto/chat"]);

  const row = requireRow(await fetchAutoRows(), "auto/chat");
  assert.equal("vision" in (row.capabilities ?? {}), false);
  assert.equal("input_modalities" in row, false);
  assert.deepEqual(row.output_modalities, ["text"]);
});

// #4071 cross-surface invariant: a wrong synced `attachment:true` must never let
// an image request reach a blind model. The resolver demotes the denylisted id
// BEFORE it reads `synced.attachment`, so advertising vision here would route
// image traffic to a text-only target. Every auto/* row is checked because the
// denylisted model participates in many pools.
test("#11947 denylisted text-only targets never advertise vision from a wrong synced flag", async () => {
  await seedOpenAiModels([
    {
      id: "mimo-v2.5-pro",
      capability: capabilityEntry({
        attachment: true,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  ]);
  await assertEffectivePoolIsNonEmpty(["auto/chat"]);

  const rows = await fetchAutoRows();
  assert.ok(rows.size > 0, "sanity: at least one auto/* entry listed");
  for (const [id, row] of rows) {
    assert.notEqual(
      row.capabilities?.vision,
      true,
      `${id} must not advertise vision for a KNOWN_TEXT_ONLY_DESPITE_SYNC target`
    );
  }
});

// #9195: the operator's dashboard "Vision capable" toggle is stored as an
// explicit false and is the authoritative verdict for that model. The resolver
// applies it before any synced evidence, so a contradictory synced
// `attachment:true` must not resurrect vision on the auto row.
test("#11947 operator vision override outranks contradictory synced attachment evidence", async () => {
  await seedOpenAiModels([
    {
      id: "operator-blind-11947",
      capability: capabilityEntry({
        attachment: true,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  ]);
  await modelsDb.addCustomModel(
    "openai",
    "operator-blind-11947",
    "operator-blind-11947",
    "manual",
    "chat-completions",
    ["chat"],
    undefined,
    {},
    false
  );
  v1ModelsCatalog.__resetCatalogBuilderRunsForTest();
  assert.equal(
    modelsDb.getCustomModelVisionOverride("openai", "operator-blind-11947"),
    false,
    "setup precondition: the operator override must be persisted as explicit false"
  );
  await assertEffectivePoolIsNonEmpty(["auto/chat"]);

  const rows = await fetchAutoRows();
  for (const [id, row] of rows) {
    assert.notEqual(
      row.capabilities?.vision,
      true,
      `${id} must not advertise vision against an operator supportsVision:false override`
    );
  }
});

// #8250: models.dev ships `attachment:false` alongside image modalities for
// genuinely multimodal models (documented for Kimi K3). The project's decision
// is that the richer modality signal wins, so this pool is UNANIMOUSLY
// vision-capable and both the flag and the truthful input evidence must survive.
test("#11947 unanimous attachment:false-with-image pools keep vision and truthful input", async () => {
  await seedOpenAiModels([
    {
      id: "kimi-shape-a-11947",
      capability: capabilityEntry({
        attachment: false,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
    {
      id: "kimi-shape-b-11947",
      capability: capabilityEntry({
        attachment: false,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  ]);
  await assertEffectivePoolIsNonEmpty(["auto/chat"]);

  const row = requireRow(await fetchAutoRows(), "auto/chat");
  assert.deepEqual(row.capabilities, { ...BASELINE_CAPABILITIES, vision: true });
  assert.deepEqual(row.input_modalities, ["text", "image"]);
  assert.deepEqual(row.output_modalities, ["text"]);
});

test("#11947 non-vision ids never infer vision from their name", async () => {
  await seedOpenAiModels([
    {
      id: "coding-text-only-11947",
      capability: capabilityEntry({
        attachment: false,
        modalities_input: JSON.stringify(["text"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  ]);
  await assertEffectivePoolIsNonEmpty(["auto/coding"]);

  const row = requireRow(await fetchAutoRows(), "auto/coding");
  assert.equal("vision" in (row.capabilities ?? {}), false);
  assert.deepEqual(row.input_modalities, ["text"]);
  assert.deepEqual(row.output_modalities, ["text"]);
});

test("#11947 user-defined combo with vision targets includes modalities in catalog", async () => {
  await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "openai-11947-user-combo-vision-test",
    apiKey: "test-key-11947",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {},
  });
  modelsDevSync.saveModelsDevCapabilities({
    openai: {
      "gpt-4o": capabilityEntry({
        attachment: true,
        modalities_input: JSON.stringify(["text", "image"]),
        modalities_output: JSON.stringify(["text"]),
      }),
    },
  });
  await combosDb.createCombo({
    name: "test-vision-combo-11947",
    strategy: "priority",
    models: ["openai/gpt-4o"],
  });

  const response = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models")
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: CatalogRow[] };
  const combo = body.data.find((row) => row.id === "test-vision-combo-11947");

  assert.ok(combo, "the user-defined vision combo must be listed");
  assert.equal(combo.capabilities?.vision, true);
  assert.ok(combo.input_modalities?.includes("image"));
  assert.ok(combo.output_modalities?.includes("text"));
});
