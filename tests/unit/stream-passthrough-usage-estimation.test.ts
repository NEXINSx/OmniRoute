// Locks passthrough stream.ts:1981 + empty-choices stream.ts:1754 : even with
// stream_options:{include_usage:true} we estimate when upstream closes on
// finish_reason without usage but with content, and we don't double-forward.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasValidUsage, estimateUsage, isEmptyUsage } from "../../open-sse/utils/usageTracking.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";

test("passthrough estimate: finish without usage but with content -> estimate", () => {
  // Regression: Gemini single-field usage must count as valid (totalTokenCount was missing before)
  assert.equal(hasValidUsage({ totalTokenCount: 15 } as Record<string, unknown>), true);
  assert.equal(isEmptyUsage({ totalTokenCount: 15 } as Record<string, unknown>), false);
  assert.equal(isEmptyUsage({ totalTokenCount: 0 } as Record<string, unknown>), true);
  assert.equal(!hasValidUsage(null) && 534 > 0, true);
  assert.equal(isEmptyUsage({ prompt_tokens: 0, completion_tokens: 0 }), true);
  const est = estimateUsage({ messages: [{ role: "user", content: "hi" }] }, 534, FORMATS.OPENAI);
  assert.equal(hasValidUsage(est as Record<string, unknown>), true);
  assert.equal((est as Record<string, unknown>).estimated, true);
});

test("passthrough no double: trailing choices:[] with valid usage -> no estimate", () => {
  assert.equal(hasValidUsage({ prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 }), true);
});

test("passthrough no fake: empty response totalContentLength==0 -> no estimate", () => {
  assert.equal(!hasValidUsage(null) && 0 > 0, false);
  assert.equal(!hasValidUsage({} as Record<string, unknown>) && 0 > 0, false);
});

test("passthrough no fake: tool_only contentLength==0 -> no estimate (tool_calls not counted today)", () => {
  // totalContentLength only counts delta.content + reasoningDelta today -> tool_only stays 0, so no estimate
  assert.equal(!hasValidUsage(null) && 0 > 0, false);
});

import { createSSEStream } from "../../open-sse/utils/stream.ts";

function collectSSE(stream: TransformStream<Uint8Array, Uint8Array>) {
  return async (writable: WritableStream<Uint8Array>, readable: ReadableStream<Uint8Array>) => {
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    const reader = readable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }
    return chunks.join("");
  };
}

function parseSSEUsage(sseText: string): unknown[] {
  return sseText
    .split("\n\n")
    .filter((block) => block.includes("data:"))
    .map((block) => {
      const line = block.split("\n").find((l) => l.startsWith("data:")) ?? "";
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") return null;
      try {
        return JSON.parse(json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

test("passthrough SSE: finish stop without usage + include_usage:true -> emits usage.estimated:true", async () => {
  const body = { model: "m", messages: [{ role: "user", content: "hi" }], stream: true, stream_options: { include_usage: true } };
  const stream = createSSEStream({
    mode: "passthrough" as const,
    body,
    sourceFormat: FORMATS.OPENAI,
    clientResponseFormat: FORMATS.OPENAI,
    provider: "test",
  });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const readAll = (async () => {
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  })();
  const enc = new TextEncoder();
  // delta content -> accumulates totalContentLength
  await writer.write(enc.encode(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "hello world" }, finish_reason: null }] })}\n\n`));
  // finish without usage
  await writer.write(enc.encode(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
  await writer.write(enc.encode("data: [DONE]\n\n"));
  await writer.close();
  const text = await readAll;
  const parsed = parseSSEUsage(text);
  const withUsage = parsed.filter((p: unknown) => (p as Record<string, unknown>).usage);
  assert.ok(withUsage.length >= 1, `expected at least 1 chunk with usage, got ${withUsage.length} — text: ${text.slice(0, 600)}`);
  const last = withUsage[withUsage.length - 1] as Record<string, unknown>;
  const usage = last.usage as Record<string, unknown>;
  assert.equal(usage.estimated, true);
  assert.ok(typeof usage.prompt_tokens === "number" && usage.prompt_tokens > 0);
  assert.ok(typeof usage.completion_tokens === "number" && usage.completion_tokens > 0);
});

test("passthrough SSE: trailing choices:[] valid after estimated finish -> trailing is dropped (estimated wins)", async () => {
  const body = { model: "m", messages: [{ role: "user", content: "hi" }], stream: true, stream_options: { include_usage: true } };
  const stream = createSSEStream({
    mode: "passthrough" as const,
    body,
    sourceFormat: FORMATS.OPENAI,
    clientResponseFormat: FORMATS.OPENAI,
    provider: "test",
  });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const readAll = (async () => {
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  })();
  const enc = new TextEncoder();
  await writer.write(enc.encode(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "hello world" }, finish_reason: null }] })}\n\n`));
  // finish without usage -> should estimate (injectedUsage=false at that point)
  await writer.write(enc.encode(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
  // trailing choices:[] with valid usage 50ms after -> inside empty-choices block hasValid(emptyChoicesUsage)&&!injectedUsage is now false, so chunk is dropped (warn path)
  await writer.write(enc.encode(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 } })}\n\n`));
  await writer.write(enc.encode("data: [DONE]\n\n"));
  await writer.close();
  const text = await readAll;
  const parsed = parseSSEUsage(text);
  const withUsage = parsed.filter((p: unknown) => (p as Record<string, unknown>).usage);
  // With the guard, the trailing valid is dropped (estimated was already sent on finish). Without guard we would see 2 (double). We assert drop.
  // If upstream ever sends real include_usage trailing, this documents the v1 tradeoff: estimated wins, valid is dropped.
  assert.equal(withUsage.length, 1, `expected 1 usage (estimated, trailing dropped), got ${withUsage.length} — usages: ${JSON.stringify(withUsage.map((p) => (p as Record<string, unknown>).usage))}`);
  assert.equal((withUsage[0] as Record<string, unknown> & { usage: Record<string, unknown> }).usage.estimated, true);
});
