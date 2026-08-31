import test from "node:test";
import assert from "node:assert/strict";

const { sanitizeReasoningEffortForProvider } = await import("../../open-sse/executors/base.ts");
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");

function makeLog() {
  const messages: Array<[string, string]> = [];
  return {
    info: (tag: string, msg: string) => messages.push([tag, msg]),
    messages,
  };
}

test("sanitizeReasoningEffortForProvider: xiaomi-mimo preserves xhigh by default", () => {
  const log = makeLog();
  const body = {
    model: "mimo-v2.5-pro",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "xiaomi-mimo", "mimo-v2.5-pro", log);
  assert.equal(result, body, "xhigh passes through unless the model explicitly opts out");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "xhigh");
  assert.equal(
    (result as Record<string, unknown>).model,
    "mimo-v2.5-pro",
    "other fields preserved"
  );
  assert.equal(log.messages.length, 0);
});

test("sanitizeReasoningEffortForProvider: OpenRouter DeepSeek preserves xhigh", () => {
  const body = {
    model: "deepseek/deepseek-v4-pro",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "openrouter",
    "deepseek/deepseek-v4-pro",
    null
  );
  assert.equal(result, body);
  assert.equal((result as Record<string, unknown>).reasoning_effort, "xhigh");
});

test("sanitizeReasoningEffortForProvider: explicit xhigh opt-out maps to max for max-native providers", () => {
  const log = makeLog();
  const body = {
    model: "claude-opus-4-6",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-opus-4-6", log);
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /xhigh → max/.test(m)),
    "logs the mapping"
  );
});

test("sanitizeReasoningEffortForProvider: Anthropic-compatible dynamic provider honors xhigh opt-out", () => {
  const body = {
    model: "claude-opus-4-6",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "anthropic-compatible-test",
    "claude-opus-4-6",
    null
  );
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "high");
});

test("sanitizeReasoningEffortForProvider: xiaomi-mimo passes max through (new default)", () => {
  const log = makeLog();
  const body = {
    model: "mimo-v2.5-pro",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "xiaomi-mimo", "mimo-v2.5-pro", log);
  // xiaomi-mimo has supportsXHighEffort: undefined (not explicitly false), so max
  // passes through unchanged — the upstream decides whether to accept or reject.
  assert.equal(result, body, "max passes through unchanged for models not flagged as rejecting it");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.equal(log.messages.length, 0);
});

test("sanitizeReasoningEffortForProvider: Ollama Cloud preserves max", () => {
  const log = makeLog();
  const body = {
    model: "glm-5.2",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "ollama-cloud", "glm-5.2", log);
  assert.equal(result, body, "Ollama Cloud accepts max literally");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.equal(log.messages.length, 0);
});

test("sanitizeReasoningEffortForProvider: Ollama Cloud preserves nested max", () => {
  const body = {
    model: "glm-5.2",
    reasoning: { effort: "max", summary: "auto" },
    input: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "ollama-cloud", "glm-5.2", null);
  assert.equal(result, body, "Ollama Cloud accepts max literally");
  assert.equal((result as Record<string, unknown>).reasoning.effort, "max");
  assert.equal((result as Record<string, unknown>).reasoning.summary, "auto");
});

test("sanitizeReasoningEffortForProvider: Ollama Cloud maps registry model xhigh → max", () => {
  const log = makeLog();
  const body = {
    model: "glm-5.2",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "ollama-cloud", "glm-5.2", log) as Record<
    string,
    unknown
  >;
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal(result.reasoning_effort, "max");
  assert.equal(result.model, "glm-5.2", "other fields preserved");
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /xhigh → max/.test(m)),
    "logs the xhigh → max mapping"
  );
});

test("sanitizeReasoningEffortForProvider: Ollama Cloud maps passthrough unknown model xhigh → max", () => {
  const log = makeLog();
  const body = {
    model: "some-future-glm-model",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "ollama-cloud",
    "some-future-glm-model",
    log
  ) as Record<string, unknown>;
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal(result.reasoning_effort, "max");
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /xhigh → max/.test(m)),
    "logs the xhigh → max mapping"
  );
});

test("sanitizeReasoningEffortForProvider: OpenRouter DeepSeek passes max through (new default)", () => {
  const log = makeLog();
  const body = {
    model: "deepseek/deepseek-v4-pro",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "openrouter",
    "deepseek/deepseek-v4-pro",
    log
  );
  // New default: max passes through. OpenRouter DeepSeek is not flagged as
  // rejecting max, so the upstream decides.
  assert.equal(result, body, "max passes through unchanged");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.equal(log.messages.length, 0);
});

test("sanitizeReasoningEffortForProvider: OpenRouter Claude opt-out aliases downgrade max → high", () => {
  const log = makeLog();
  const body = {
    model: "anthropic/claude-opus-4.6",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "openrouter",
    "anthropic/claude-opus-4.6",
    log
  );
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "high");
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /max → high/.test(m)),
    "logs the downgrade"
  );
});

test("sanitizeReasoningEffortForProvider: OpenAI-compatible Gemini passes max through (new default)", () => {
  const log = makeLog();
  const body = {
    model: "gemini-3.1-pro-preview",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "openai-compatible-free1",
    "gemini-3.1-pro-preview",
    log
  );
  assert.equal(result, body, "max passes through unchanged for unknown providers");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.equal(log.messages.length, 0);
});

test("sanitizeReasoningEffortForProvider: nested OpenAI reasoning max passes through (new default)", () => {
  const body = {
    model: "gemini-3.1-pro-preview",
    reasoning: { effort: "max", summary: "auto" },
    input: [],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "openai-compatible-free1",
    "gemini-3.1-pro-preview",
    null
  );
  assert.equal(result, body, "max passes through unchanged");
  assert.equal((result as Record<string, unknown>).reasoning.effort, "max");
  assert.equal(
    (result as Record<string, unknown>).reasoning.summary,
    "auto",
    "other reasoning fields preserved"
  );
});

test("sanitizeReasoningEffortForProvider: claude preserves max for Opus/Sonnet and downgrades Haiku", () => {
  const sonnetBody = {
    model: "claude-sonnet-4-6",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const sonnetResult = sanitizeReasoningEffortForProvider(
    sonnetBody,
    "claude",
    "claude-sonnet-4-6",
    null
  );
  assert.equal(sonnetResult, sonnetBody);
  assert.equal((sonnetResult as any).reasoning_effort, "max");

  const opusBody = {
    model: "claude-opus-4-6",
    reasoning: { effort: "max", summary: "auto" },
    input: [],
  };
  const opusResult = sanitizeReasoningEffortForProvider(
    opusBody,
    "anthropic-compatible-cc-test",
    "claude-opus-4-6",
    null
  );
  assert.equal(opusResult, opusBody);
  assert.equal((opusResult as any).reasoning.effort, "max");

  const haikuBody = {
    model: "claude-haiku-4-5-20251001",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const haikuResult = sanitizeReasoningEffortForProvider(
    haikuBody,
    "claude",
    "claude-haiku-4-5-20251001",
    null
  );
  assert.notEqual(haikuResult, haikuBody);
  assert.equal((haikuResult as any).reasoning_effort, "high");
});

test("sanitizeReasoningEffortForProvider: xiaomi-mimo preserves nested xhigh by default", () => {
  const body = {
    model: "mimo-v2.5-pro",
    reasoning: { effort: "xhigh", summary: "auto" },
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "xiaomi-mimo", "mimo-v2.5-pro", null);
  assert.equal(result, body);
  assert.equal((result as Record<string, unknown>).reasoning.effort, "xhigh");
  assert.equal(
    (result as Record<string, unknown>).reasoning.summary,
    "auto",
    "other reasoning fields preserved"
  );
});

test("sanitizeReasoningEffortForProvider: explicit xhigh opt-out preserves Responses shape", () => {
  const body = {
    model: "claude-opus-4-6",
    reasoning: { effort: "xhigh", summary: "auto" },
    input: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-opus-4-6", null);
  assert.equal((result as Record<string, unknown>).reasoning.effort, "max");
  assert.equal((result as Record<string, unknown>).reasoning_effort, undefined);
});

test("sanitizeReasoningEffortForProvider: mistral/devstral strips reasoning_effort entirely", () => {
  const log = makeLog();
  const body = {
    model: "devstral-2512",
    reasoning_effort: "medium",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "mistral", "devstral-2512", log);
  assert.equal(
    (result as Record<string, unknown>).reasoning_effort,
    undefined,
    "reasoning_effort must be stripped"
  );
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /removed/.test(m)),
    "logs the removal"
  );
});

test("sanitizeReasoningEffortForProvider: github/claude-opus-4.6 preserves reasoning_effort (#791)", () => {
  // Upstream PR decolua/9router#791 (port): Copilot now honors reasoning_effort
  // on Claude Opus 4.6 and Sonnet 4.6. Older Opus variants and Haiku still strip.
  const body = {
    model: "claude-opus-4-6",
    reasoning_effort: "high",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "github", "claude-opus-4-6", null);
  assert.equal((result as Record<string, unknown>).reasoning_effort, "high");
});

test("sanitizeReasoningEffortForProvider: github/claude-opus-4.7 still strips (#791)", () => {
  const body = {
    model: "claude-opus-4.7",
    reasoning_effort: "high",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "github", "claude-opus-4.7", null);
  assert.equal((result as Record<string, unknown>).reasoning_effort, undefined);
});

test("sanitizeReasoningEffortForProvider: rejecting providers strip max before normalization", () => {
  const mistralBody = {
    model: "devstral-2512",
    reasoning_effort: "max",
    messages: [],
  };
  const mistralResult = sanitizeReasoningEffortForProvider(
    mistralBody,
    "mistral",
    "devstral-2512",
    null
  );
  assert.equal((mistralResult as any).reasoning_effort, undefined);

  // Pre-#791: github stripped reasoning_effort entirely for every Claude model.
  // Post-#791: Opus 4.6 keeps reasoning_effort; `max` downgrades to `high`
  // because github is not Claude/CC-compatible (so supportsMax=false) and
  // the canonical Claude Opus 4.6 model opts out of xhigh.
  const githubBody = {
    model: "claude-opus-4-6",
    reasoning_effort: "max",
    messages: [],
  };
  const githubResult = sanitizeReasoningEffortForProvider(
    githubBody,
    "github",
    "claude-opus-4-6",
    null
  );
  assert.equal((githubResult as any).reasoning_effort, "high");

  // Pre-#791 strip is preserved for github Claude models that DO NOT opt in
  // (Haiku 4.5, Opus 4.7, older Sonnet, etc.).
  const githubHaiku = {
    model: "claude-haiku-4.5",
    reasoning_effort: "max",
    messages: [],
  };
  const githubHaikuResult = sanitizeReasoningEffortForProvider(
    githubHaiku,
    "github",
    "claude-haiku-4.5",
    null
  );
  assert.equal((githubHaikuResult as any).reasoning_effort, undefined);
});

test("sanitizeReasoningEffortForProvider: mistral/devstral strips reasoning object when only effort present", () => {
  const body = {
    model: "devstral-2512",
    reasoning: { effort: "medium" },
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "mistral", "devstral-2512", null);
  assert.equal(
    (result as Record<string, unknown>).reasoning,
    undefined,
    "reasoning object dropped when emptied"
  );
});

test("sanitizeReasoningEffortForProvider: mistral/devstral preserves reasoning when other fields remain", () => {
  const body = {
    model: "devstral-2512",
    reasoning: { effort: "medium", summary: "auto" },
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "mistral", "devstral-2512", null);
  assert.deepEqual((result as Record<string, unknown>).reasoning, { summary: "auto" });
});

test("sanitizeReasoningEffortForProvider: codex with xhigh passes through unchanged", () => {
  const body = {
    model: "gpt-5.5-xhigh",
    reasoning_effort: "xhigh",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "codex", "gpt-5.5-xhigh", null);
  assert.equal((result as Record<string, unknown>).reasoning_effort, "xhigh");
});

test("sanitizeReasoningEffortForProvider: codex preserves OMP minimal across carriers", () => {
  const body = {
    model: "gpt-5.6-terra",
    reasoning_effort: "minimal",
    reasoning: { effort: "minimal", summary: "auto" },
    output_config: { effort: "minimal" },
    input: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "codex", "gpt-5.6-terra", null) as Record<
    string,
    unknown
  >;

  assert.equal(result.reasoning_effort, "minimal");
  assert.deepEqual(result.reasoning, { effort: "minimal", summary: "auto" });
  assert.deepEqual(result.output_config, { effort: "minimal" });
});

test("sanitizeReasoningEffortForProvider: no-op when reasoning_effort absent", () => {
  const body = { model: "mimo-v2.5-pro", messages: [] };
  const result = sanitizeReasoningEffortForProvider(body, "xiaomi-mimo", "mimo-v2.5-pro", null);
  assert.equal(result, body, "returns original body unchanged");
});

test("sanitizeReasoningEffortForProvider: handles unknown providers as pass-through", () => {
  const body = { model: "some-model", reasoning_effort: "xhigh", messages: [] };
  const result = sanitizeReasoningEffortForProvider(body, "unknown-provider", "some-model", null);
  assert.equal(result, body);
  assert.equal((result as Record<string, unknown>).reasoning_effort, "xhigh");
});

test("sanitizeReasoningEffortForProvider: non-object body returns unchanged", () => {
  assert.equal(sanitizeReasoningEffortForProvider(null, "xiaomi-mimo", "x", null), null);
  assert.equal(sanitizeReasoningEffortForProvider("string", "xiaomi-mimo", "x", null), "string");
  const arr: unknown[] = [];
  assert.equal(sanitizeReasoningEffortForProvider(arr, "xiaomi-mimo", "x", null), arr);
});

// ── #8057: max passes through by default for unknown models ──────────────────
// New models should work immediately without waiting for a whitelist update.

test("sanitizeReasoningEffortForProvider: completely unknown model passes max through (#8057)", () => {
  const body = {
    model: "brand-new-model-2026",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "some-new-provider",
    "brand-new-model-2026",
    null
  );
  assert.equal(result, body, "unknown models must not have max rewritten");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: unknown model max passes through on all proxy types (#8057)", () => {
  for (const provider of [
    "tokenrouter",
    "zemux",
    "openrouter",
    "openai-compatible-test",
    "custom-proxy",
  ]) {
    const body = {
      model: "future-model-v5",
      reasoning_effort: "max",
      messages: [],
    };
    const result = sanitizeReasoningEffortForProvider(body, provider, "future-model-v5", null);
    assert.equal(result, body, `${provider}: max must pass through for unknown models`);
    assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  }
});

test("sanitizeReasoningEffortForProvider: proxy-prefixed kimi-k3 resolves and preserves max", () => {
  // TokenRouter sends moonshotai/kimi-k3-free — global fallback resolves it to kimi-k3,
  // which has supportsXHighEffort: false + supportsMax: true via supportsMaxEffortForProvider.
  const body = {
    model: "moonshotai/kimi-k3-free",
    reasoning_effort: "max",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "tokenrouter",
    "moonshotai/kimi-k3-free",
    null
  );
  assert.equal(result, body, "kimi-k3 behind tokenrouter must keep max");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: proxy-prefixed kimi-k3 xhigh maps to max (not high)", () => {
  // When Claude Code sends xhigh for kimi-k3 behind a proxy, it should map to max
  // (the model's highest tier), not downgrade to high.
  const log = makeLog();
  const body = {
    model: "moonshotai/kimi-k3-free",
    reasoning_effort: "xhigh",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "tokenrouter",
    "moonshotai/kimi-k3-free",
    log
  );
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /xhigh → max/.test(m)),
    "logs the xhigh → max mapping"
  );
});

test("sanitizeReasoningEffortForProvider: Claude Haiku max degrades to high (explicitly flagged)", () => {
  // Claude Haiku is explicitly flagged as supportsXHighEffort: false and NOT in
  // supportsMaxEffortForProvider, so max should degrade to high.
  const body = {
    model: "claude-haiku-4-5-20251001",
    reasoning_effort: "max",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "claude",
    "claude-haiku-4-5-20251001",
    null
  );
  assert.notEqual(result, body);
  assert.equal((result as Record<string, unknown>).reasoning_effort, "high");
});

// ── NVIDIA NIM GLM-5.2 (#7215) ─────────────────────────────────────────────

test("sanitizeReasoningEffortForProvider: NVIDIA GLM-5.2 enables thinking for active effort", () => {
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    const body = { reasoning_effort: effort, messages: [] };
    const result = sanitizeReasoningEffortForProvider(
      body,
      "nvidia",
      "z-ai/glm-5.2",
      null
    ) as Record<string, unknown>;

    assert.notEqual(result, body);
    assert.equal(result.reasoning_effort, undefined);
    assert.deepEqual(result.chat_template_kwargs, { enable_thinking: true });
  }
});

test("sanitizeReasoningEffortForProvider: NVIDIA GLM-5.2 maps none to thinking off", () => {
  const result = sanitizeReasoningEffortForProvider(
    { reasoning_effort: "none", messages: [] },
    "nvidia",
    "z-ai/glm-5.2",
    null
  ) as Record<string, unknown>;

  assert.equal(result.reasoning_effort, undefined);
  assert.deepEqual(result.chat_template_kwargs, { enable_thinking: false });
});

test("sanitizeReasoningEffortForProvider: NVIDIA GLM-5.2 maps nested reasoning.effort", () => {
  const result = sanitizeReasoningEffortForProvider(
    { reasoning: { effort: "high" }, messages: [] },
    "nvidia",
    "z-ai/glm-5.2",
    null
  ) as Record<string, unknown>;

  assert.equal(result.reasoning, undefined);
  assert.deepEqual(result.chat_template_kwargs, { enable_thinking: true });
});

test("DefaultExecutor: NVIDIA GLM-5.2 maps nested effort before unsupported-param stripping", () => {
  const result = new DefaultExecutor("nvidia").transformRequest(
    "z-ai/glm-5.2",
    {
      model: "z-ai/glm-5.2",
      reasoning: { effort: "high", summary: "auto" },
      messages: [],
    },
    false,
    {}
  ) as Record<string, unknown>;

  assert.equal(result.reasoning, undefined);
  assert.equal(result.reasoning_effort, undefined);
  assert.deepEqual(result.chat_template_kwargs, { enable_thinking: true });
});

test("DefaultExecutor: NVIDIA reasoning levels remain intact for GPT-OSS", () => {
  const result = new DefaultExecutor("nvidia").transformRequest(
    "openai/gpt-oss-120b",
    {
      model: "openai/gpt-oss-120b",
      reasoning_effort: "low",
      messages: [],
    },
    false,
    {}
  ) as Record<string, unknown>;

  assert.equal(result.reasoning_effort, "low");
  assert.equal(result.chat_template_kwargs, undefined);
});

test("sanitizeReasoningEffortForProvider: NVIDIA GLM-5.2 preserves a native thinking switch", () => {
  const result = sanitizeReasoningEffortForProvider(
    {
      reasoning_effort: "xhigh",
      chat_template_kwargs: { enable_thinking: false, custom_flag: true },
      messages: [],
    },
    "nvidia",
    "z-ai/glm-5.2",
    null
  ) as Record<string, unknown>;

  assert.equal(result.reasoning_effort, undefined);
  assert.deepEqual(result.chat_template_kwargs, {
    enable_thinking: false,
    custom_flag: true,
  });
});

test("sanitizeReasoningEffortForProvider: NVIDIA GLM-5.2 mapping is narrowly scoped", () => {
  const otherModel = { reasoning_effort: "high", messages: [] };
  const otherProvider = { reasoning_effort: "high", messages: [] };

  assert.equal(
    sanitizeReasoningEffortForProvider(otherModel, "nvidia", "z-ai/glm-5.1", null),
    otherModel
  );
  assert.equal(
    sanitizeReasoningEffortForProvider(otherProvider, "openai", "z-ai/glm-5.2", null),
    otherProvider
  );
});

// ── Native DeepSeek (api.deepseek.com) ───────────────────────────────────────
// DeepSeek V4 thinking mode accepts reasoning_effort as {low, high, max}.
// The internal OmniRoute scale maps medium → high and xhigh → max so the client's
// requested effort is honored instead of silently dropped to the default.

test("sanitizeReasoningEffortForProvider: native deepseek maps xhigh → max", () => {
  const log = makeLog();
  const body = {
    model: "deepseek-v4-pro",
    reasoning_effort: "xhigh",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "deepseek", "deepseek-v4-pro", log);
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.equal(
    (result as Record<string, unknown>).model,
    "deepseek-v4-pro",
    "other fields preserved"
  );
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /xhigh → max/.test(m)),
    "logs the xhigh → max mapping"
  );
});

test("sanitizeReasoningEffortForProvider: native deepseek preserves max", () => {
  const log = makeLog();
  const body = {
    model: "deepseek-v4-flash",
    reasoning_effort: "max",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "deepseek", "deepseek-v4-flash", log);
  assert.equal(result, body, "max is DeepSeek's native top tier — passes through unchanged");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
  assert.equal(log.messages.length, 0);
});

test("sanitizeReasoningEffortForProvider: native deepseek preserves low", () => {
  const body = {
    model: "deepseek-v4-pro",
    reasoning_effort: "low",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "deepseek", "deepseek-v4-pro", null);
  assert.equal(result, body, "low is already valid — passes through unchanged");
});

test("sanitizeReasoningEffortForProvider: native non-V4 deepseek clamps low → high", () => {
  const body = {
    model: "deepseek-chat",
    reasoning_effort: "low",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "deepseek", "deepseek-chat", null);
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "high");
});

test("sanitizeReasoningEffortForProvider: native deepseek clamps medium → high", () => {
  const body = {
    model: "deepseek-v4-pro",
    reasoning_effort: "medium",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "deepseek", "deepseek-v4-pro", null);
  assert.equal((result as Record<string, unknown>).reasoning_effort, "high");
});

test("sanitizeReasoningEffortForProvider: native deepseek preserves high unchanged", () => {
  const body = {
    model: "deepseek-v4-pro",
    reasoning_effort: "high",
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "deepseek", "deepseek-v4-pro", null);
  assert.equal(result, body, "high is already valid — passes through unchanged");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "high");
});

test("sanitizeReasoningEffortForProvider: native deepseek maps nested reasoning.effort xhigh → max", () => {
  const body = {
    model: "deepseek-v4-pro",
    reasoning: { effort: "xhigh", summary: "auto" },
    input: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "deepseek", "deepseek-v4-pro", null);
  assert.equal((result as Record<string, unknown>).reasoning.effort, "max");
  assert.equal(
    (result as Record<string, unknown>).reasoning.summary,
    "auto",
    "other reasoning fields preserved"
  );
  assert.equal((result as Record<string, unknown>).reasoning_effort, undefined);
});

test("sanitizeReasoningEffortForProvider: OpenRouter DeepSeek still preserves xhigh (not native)", () => {
  // Regression guard: the native-deepseek mapping must NOT touch openrouter,
  // whose normalized API expects xhigh (issue earendil-works/pi#4055).
  const body = {
    model: "deepseek/deepseek-v4-pro",
    reasoning_effort: "xhigh",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "openrouter",
    "deepseek/deepseek-v4-pro",
    null
  );
  assert.equal(result, body);
  assert.equal((result as Record<string, unknown>).reasoning_effort, "xhigh");
});

// ── opencode-go DeepSeek V4 effort variants (#4647) ──────────────────────────
// opencode-go proxies DeepSeek with the native DeepSeek API contract. Both V4
// models advertise none/low/high/max, and the sanitizer must preserve those
// literal values rather than rewriting `max` to `xhigh`.

test("sanitizeReasoningEffortForProvider: opencode-go DeepSeek V4 Pro preserves max", () => {
  const body = {
    model: "deepseek-v4-pro",
    reasoning_effort: "max",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "opencode-go", "deepseek-v4-pro", null);
  assert.equal(result, body, "opencode-go DeepSeek max must pass through unchanged");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: opencode-go preserves both V4 models' tiers", () => {
  for (const model of ["deepseek-v4-pro", "deepseek-v4-flash"]) {
    for (const level of ["none", "low", "high", "max"]) {
      const body = {
        model: `${model}-${level}`,
        reasoning_effort: level,
        messages: [],
      };
      const result = sanitizeReasoningEffortForProvider(
        body,
        "opencode-go",
        `${model}-${level}`,
        null
      );
      assert.equal(
        (result as Record<string, unknown>).reasoning_effort,
        level,
        `opencode-go ${model}-${level} preserves reasoning_effort=${level}`
      );
    }
  }
});

type EffortCarrierResult = {
  reasoning_effort?: string;
  reasoning?: { effort?: string };
};

test("sanitizeReasoningEffortForProvider: command-code preserves literal max", () => {
  const body = { reasoning_effort: "max" };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "command-code",
    "deepseek/deepseek-v4-flash",
    null
  ) as EffortCarrierResult;
  assert.equal(result.reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: command-code preserves nested literal max", () => {
  const body = { reasoning: { effort: "max" } };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "command-code",
    "gpt-5.6-luna",
    null
  ) as EffortCarrierResult;
  assert.equal(result.reasoning?.effort, "max");
});

test("sanitizeReasoningEffortForProvider: command-code maps normalized xhigh back to max", () => {
  const body = { reasoning_effort: "xhigh", reasoning: { effort: "xhigh" } };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "command-code",
    "gpt-5.6-luna",
    null
  ) as EffortCarrierResult;
  assert.equal(result.reasoning_effort, "max");
  assert.equal(result.reasoning?.effort, "max");
});

test("sanitizeReasoningEffortForProvider: command-code maps unsupported minimal to low", () => {
  const log = makeLog();
  const body = { reasoning_effort: "minimal", messages: [] };
  const result = sanitizeReasoningEffortForProvider(
    body,
    "command-code",
    "poolside/laguna-s-2.1-free",
    log
  ) as Record<string, unknown>;
  // Upstream rejects minimal (400 "expected one of low|medium|high|xhigh|max").
  assert.equal(result.reasoning_effort, "low");
  assert.ok(
    log.messages.some(([, msg]) => msg.includes("minimal → low")),
    "sanitizer logs the downgrade"
  );
});

test("sanitizeReasoningEffortForProvider: opencode-go with non-DeepSeek model passes max through (new default)", () => {
  // opencode-go non-DeepSeek models are not explicitly flagged as rejecting max,
  // so max passes through unchanged under the new default.
  const body = {
    model: "mimo-v2.5-pro",
    reasoning_effort: "max",
    messages: [],
  };
  const result = sanitizeReasoningEffortForProvider(body, "opencode-go", "mimo-v2.5-pro", null);
  assert.equal(result, body, "max passes through unchanged");
  assert.equal((result as Record<string, unknown>).reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: #7044 output_config.effort (Claude native) xhigh is mapped to max, not bypassed", () => {
  const log = makeLog();
  const body = {
    model: "claude-opus-4-6",
    output_config: { effort: "xhigh" },
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-opus-4-6", log);
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal(
    (result as Record<string, unknown>).output_config.effort,
    "max",
    "xhigh mapped to max on the output_config carrier"
  );
  assert.ok(
    !("reasoning_effort" in (result as Record<string, unknown>)),
    "no spurious reasoning_effort injected when only output_config was present"
  );
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /xhigh → max/.test(m)),
    "logs the mapping"
  );
});

test("sanitizeReasoningEffortForProvider: #7044 output_config.effort high passes through unchanged", () => {
  const body = {
    model: "claude-opus-4-6",
    output_config: { effort: "high" },
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-opus-4-6", null);
  assert.equal(result, body, "high is supported — body returned unchanged");
  assert.equal((result as Record<string, unknown>).output_config.effort, "high");
});

// ── User reported cases & future-proof model matching ──────────────────────

test("sanitizeReasoningEffortForProvider: cmd / z-ai/glm-5.3-flash maps xhigh → max and preserves max", () => {
  const log = makeLog();
  const bodyXHigh = { model: "z-ai/glm-5.3-flash", reasoning_effort: "xhigh", messages: [] };
  const resXHigh = sanitizeReasoningEffortForProvider(bodyXHigh, "cmd", "z-ai/glm-5.3-flash", log) as Record<string, unknown>;
  assert.equal(resXHigh.reasoning_effort, "max");

  const bodyMax = { model: "z-ai/glm-5.3-flash", reasoning_effort: "max", messages: [] };
  const resMax = sanitizeReasoningEffortForProvider(bodyMax, "cmd", "z-ai/glm-5.3-flash", log) as Record<string, unknown>;
  assert.equal(resMax.reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: cmd / deepseek/deepseek-v4-flash-vision-exp maps xhigh → max and preserves max", () => {
  const log = makeLog();
  const bodyXHigh = { model: "deepseek/deepseek-v4-flash-vision-exp", reasoning_effort: "xhigh", messages: [] };
  const resXHigh = sanitizeReasoningEffortForProvider(bodyXHigh, "cmd", "deepseek/deepseek-v4-flash-vision-exp", log) as Record<string, unknown>;
  assert.equal(resXHigh.reasoning_effort, "max");

  const bodyMax = { model: "deepseek/deepseek-v4-flash-vision-exp", reasoning_effort: "max", messages: [] };
  const resMax = sanitizeReasoningEffortForProvider(bodyMax, "cmd", "deepseek/deepseek-v4-flash-vision-exp", log) as Record<string, unknown>;
  assert.equal(resMax.reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: opencode-go / glm-5.3-flash maps xhigh → max and preserves max", () => {
  const log = makeLog();
  const bodyXHigh = { model: "glm-5.3-flash", reasoning_effort: "xhigh", messages: [] };
  const resXHigh = sanitizeReasoningEffortForProvider(bodyXHigh, "opencode-go", "glm-5.3-flash", log) as Record<string, unknown>;
  assert.equal(resXHigh.reasoning_effort, "max");

  const bodyMax = { model: "glm-5.3-flash", reasoning_effort: "max", messages: [] };
  const resMax = sanitizeReasoningEffortForProvider(bodyMax, "opencode-go", "glm-5.3-flash", log) as Record<string, unknown>;
  assert.equal(resMax.reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: opencode-go / deepseek-v4-flash-vision-exp maps xhigh → max and preserves max", () => {
  const log = makeLog();
  const bodyXHigh = { model: "deepseek-v4-flash-vision-exp", reasoning_effort: "xhigh", messages: [] };
  const resXHigh = sanitizeReasoningEffortForProvider(bodyXHigh, "opencode-go", "deepseek-v4-flash-vision-exp", log) as Record<string, unknown>;
  assert.equal(resXHigh.reasoning_effort, "max");

  const bodyMax = { model: "deepseek-v4-flash-vision-exp", reasoning_effort: "max", messages: [] };
  const resMax = sanitizeReasoningEffortForProvider(bodyMax, "opencode-go", "deepseek-v4-flash-vision-exp", log) as Record<string, unknown>;
  assert.equal(resMax.reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: ollamacloud / glm-5.3-flash:cloud maps xhigh → max and preserves max", () => {
  const log = makeLog();
  const bodyXHigh = { model: "glm-5.3-flash:cloud", reasoning_effort: "xhigh", messages: [] };
  const resXHigh = sanitizeReasoningEffortForProvider(bodyXHigh, "ollamacloud", "glm-5.3-flash:cloud", log) as Record<string, unknown>;
  assert.equal(resXHigh.reasoning_effort, "max");

  const bodyMax = { model: "glm-5.3-flash:cloud", reasoning_effort: "max", messages: [] };
  const resMax = sanitizeReasoningEffortForProvider(bodyMax, "ollamacloud", "glm-5.3-flash:cloud", log) as Record<string, unknown>;
  assert.equal(resMax.reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: ollamacloud / deepseek-v4-pro:cloud maps xhigh → max and preserves max", () => {
  const log = makeLog();
  const bodyXHigh = { model: "deepseek-v4-pro:cloud", reasoning_effort: "xhigh", messages: [] };
  const resXHigh = sanitizeReasoningEffortForProvider(bodyXHigh, "ollamacloud", "deepseek-v4-pro:cloud", log) as Record<string, unknown>;
  assert.equal(resXHigh.reasoning_effort, "max");

  const bodyMax = { model: "deepseek-v4-pro:cloud", reasoning_effort: "max", messages: [] };
  const resMax = sanitizeReasoningEffortForProvider(bodyMax, "ollamacloud", "deepseek-v4-pro:cloud", log) as Record<string, unknown>;
  assert.equal(resMax.reasoning_effort, "max");
});

test("sanitizeReasoningEffortForProvider: future models (glm-5.4, deepseek-v5, kimi-k4) on arbitrary providers map xhigh → max and preserve max", () => {
  const log = makeLog();
  for (const m of ["glm-5.4", "glm-5.4-flash", "glm-6.0", "deepseek-v5", "deepseek-v5-pro", "kimi-k4", "moonshotai/Kimi-K4"]) {
    const bXHigh = { model: m, reasoning_effort: "xhigh", messages: [] };
    const rXHigh = sanitizeReasoningEffortForProvider(bXHigh, "some-proxy", m, log) as Record<string, unknown>;
    assert.equal(rXHigh.reasoning_effort, "max", `model ${m} should map xhigh → max`);

    const bMax = { model: m, reasoning_effort: "max", messages: [] };
    const rMax = sanitizeReasoningEffortForProvider(bMax, "some-proxy", m, log) as Record<string, unknown>;
    assert.equal(rMax.reasoning_effort, "max", `model ${m} should preserve max`);
  }
});

test("sanitizeReasoningEffortForProvider: muse-spark-1.2 clamps max/ultra → xhigh and none → minimal", () => {
  const log = makeLog();
  const bodyMax = { model: "muse-spark-1.2", reasoning_effort: "max", messages: [] };
  const resMax = sanitizeReasoningEffortForProvider(bodyMax, "codex", "muse-spark-1.2", log) as Record<string, unknown>;
  assert.equal(resMax.reasoning_effort, "xhigh", "muse-spark-1.2 clamps max to xhigh");

  const bodyUltra = { model: "muse-spark-1.2", reasoning_effort: "ultra", messages: [] };
  const resUltra = sanitizeReasoningEffortForProvider(bodyUltra, "codex", "muse-spark-1.2", log) as Record<string, unknown>;
  assert.equal(resUltra.reasoning_effort, "xhigh", "muse-spark-1.2 clamps ultra to xhigh");

  const bodyNone = { model: "muse-spark-1.2", reasoning_effort: "none", messages: [] };
  const resNone = sanitizeReasoningEffortForProvider(bodyNone, "codex", "muse-spark-1.2", log) as Record<string, unknown>;
  assert.equal(resNone.reasoning_effort, "minimal", "muse-spark-1.2 clamps none to minimal");

  const bodyMed = { model: "muse-spark-1.2", reasoning_effort: "medium", messages: [] };
  const resMed = sanitizeReasoningEffortForProvider(bodyMed, "codex", "muse-spark-1.2", log) as Record<string, unknown>;
  assert.equal(resMed.reasoning_effort, "medium", "muse-spark-1.2 preserves medium");
});

test("sanitizeReasoningEffortForProvider: GLM-5.3 and GLM-5.3-flash mappings and forced thinking", () => {
  const log = makeLog();
  for (const model of ["glm-5.3", "glm-5.3-flash", "z-ai/glm-5.3-flash"]) {
    // none/minimal/low → low
    for (const effort of ["none", "minimal", "low"]) {
      const b = { model, reasoning_effort: effort, messages: [] };
      const r = sanitizeReasoningEffortForProvider(b, "glm", model, log) as Record<string, unknown>;
      assert.equal(r.reasoning_effort, "low", `${model} should map ${effort} → low`);
    }

    // medium/high → high
    for (const effort of ["medium", "high"]) {
      const b = { model, reasoning_effort: effort, messages: [] };
      const r = sanitizeReasoningEffortForProvider(b, "glm", model, log) as Record<string, unknown>;
      assert.equal(r.reasoning_effort, "high", `${model} should map ${effort} → high`);
    }

    // xhigh/max/ultra → max
    for (const effort of ["xhigh", "max", "ultra"]) {
      const b = { model, reasoning_effort: effort, messages: [] };
      const r = sanitizeReasoningEffortForProvider(b, "glm", model, log) as Record<string, unknown>;
      assert.equal(r.reasoning_effort, "max", `${model} should map ${effort} → max`);
    }

    // thinking.type="disabled" is forced to "enabled"
    const bDisabled = {
      model,
      reasoning_effort: "max",
      thinking: { type: "disabled" },
      messages: [],
    };
    const rDisabled = sanitizeReasoningEffortForProvider(bDisabled, "glm", model, log) as Record<string, unknown>;
    assert.deepEqual(rDisabled.thinking, { type: "enabled" });
  }
});

test("sanitizeReasoningEffortForProvider: GLM-5.2 mappings", () => {
  const log = makeLog();
  const model = "glm-5.2";
  // none/minimal → none
  for (const effort of ["none", "minimal"]) {
    const b = { model, reasoning_effort: effort, messages: [] };
    const r = sanitizeReasoningEffortForProvider(b, "glm", model, log) as Record<string, unknown>;
    assert.equal(r.reasoning_effort, "none", `glm-5.2 should map ${effort} → none`);
  }

  // low/medium → high
  for (const effort of ["low", "medium"]) {
    const b = { model, reasoning_effort: effort, messages: [] };
    const r = sanitizeReasoningEffortForProvider(b, "glm", model, log) as Record<string, unknown>;
    assert.equal(r.reasoning_effort, "high", `glm-5.2 should map ${effort} → high`);
  }

  // high → high
  const bHigh = { model, reasoning_effort: "high", messages: [] };
  const rHigh = sanitizeReasoningEffortForProvider(bHigh, "glm", model, log) as Record<string, unknown>;
  assert.equal(rHigh.reasoning_effort, "high");

  // xhigh/max/ultra → max
  for (const effort of ["xhigh", "max", "ultra"]) {
    const b = { model, reasoning_effort: effort, messages: [] };
    const r = sanitizeReasoningEffortForProvider(b, "glm", model, log) as Record<string, unknown>;
    assert.equal(r.reasoning_effort, "max", `glm-5.2 should map ${effort} → max`);
  }
});

test("sanitizeReasoningEffortForProvider: o1-preview strips reasoning_effort", () => {
  const log = makeLog();
  const body = { model: "o1-preview", reasoning_effort: "high", messages: [] };
  const res = sanitizeReasoningEffortForProvider(body, "openai", "o1-preview", log) as Record<string, unknown>;
  assert.equal(res.reasoning_effort, undefined, "o1-preview strips reasoning_effort");
});

test("sanitizeReasoningEffortForProvider: o1, o1-mini, o3-mini clamp xhigh/max/ultra → high", () => {
  const log = makeLog();
  for (const model of ["o1", "o1-mini", "o3-mini", "o3-pro"]) {
    for (const effort of ["xhigh", "max", "ultra"]) {
      const b = { model, reasoning_effort: effort, messages: [] };
      const r = sanitizeReasoningEffortForProvider(b, "openai", model, log) as Record<string, unknown>;
      assert.equal(r.reasoning_effort, "high", `${model} should clamp ${effort} → high`);
    }
    for (const effort of ["low", "medium", "high"]) {
      const b = { model, reasoning_effort: effort, messages: [] };
      const r = sanitizeReasoningEffortForProvider(b, "openai", model, log) as Record<string, unknown>;
      assert.equal(r.reasoning_effort, effort, `${model} should preserve ${effort}`);
    }
  }
});

test("sanitizeReasoningEffortForProvider: Qwen 3.8 family (qwen3.8-max, qwen3.8-flash, qwen3.8-coder) reasoning effort handling", () => {
  const log = makeLog();
  // qwen3.8-max on DashScope / qwen-cloud accepts low, medium, xhigh (and passes through max)
  const bQwenMax = { model: "qwen3.8-max", reasoning_effort: "xhigh", messages: [] };
  const rQwenMax = sanitizeReasoningEffortForProvider(bQwenMax, "qwen-cloud", "qwen3.8-max", log) as Record<string, unknown>;
  assert.equal(rQwenMax.reasoning_effort, "xhigh", "qwen3.8-max preserves xhigh natively");

  const bQwenMaxLiteral = { model: "qwen3.8-max", reasoning_effort: "max", messages: [] };
  const rQwenMaxLiteral = sanitizeReasoningEffortForProvider(bQwenMaxLiteral, "qwen-cloud", "qwen3.8-max", log) as Record<string, unknown>;
  assert.equal(rQwenMaxLiteral.reasoning_effort, "max", "qwen3.8-max passes max through");

  // qwen-3.8 on opencode-go / command-code gateways maps xhigh → max
  const bQwenCmd = { model: "qwen-3.8", reasoning_effort: "xhigh", messages: [] };
  const rQwenCmd = sanitizeReasoningEffortForProvider(bQwenCmd, "cmd", "qwen-3.8", log) as Record<string, unknown>;
  assert.equal(rQwenCmd.reasoning_effort, "max", "qwen-3.8 on command-code maps xhigh → max");
});

test("sanitizeReasoningEffortForProvider: 2026 comprehensive models (Claude 4.7+, GPT-5.6, Kimi K4, DeepSeek V4) pass-through & normalization", () => {
  const log = makeLog();

  // Claude 4.7 / 5.0 allows all tiers
  for (const m of ["claude-opus-4-7", "claude-opus-4-8", "claude-5-sonnet", "claude-5-opus"]) {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      const b = { model: m, output_config: { effort }, messages: [] };
      const r = sanitizeReasoningEffortForProvider(b, "claude", m, log) as Record<string, unknown>;
      assert.equal((r.output_config as Record<string, unknown>).effort, effort, `${m} should support ${effort}`);
    }
  }

  // GPT-5.6 Sol/Terra allow ultra/max/xhigh
  for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
    const b = { model: "gpt-5.6-sol", reasoning: { effort }, messages: [] };
    const r = sanitizeReasoningEffortForProvider(b, "codex", "gpt-5.6-sol", log) as Record<string, unknown>;
    assert.equal((r.reasoning as Record<string, unknown>).effort, effort, `gpt-5.6-sol should preserve ${effort}`);
  }
});
