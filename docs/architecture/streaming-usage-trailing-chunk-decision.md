---
title: "Streaming Usage: Trailing Empty-Choices Chunk"
version: 3.8.51
lastUpdated: 2026-08-29
---

# Decision Record — Capturing Usage on Trailing `choices: []` Streaming Chunks

**Status:** proposed (PR #11833, awaiting @diegosouzapw review)
**Date:** 2026-08-29
**Refs:** [#11817](https://github.com/diegosouzapw/OmniRoute/issues/11817), companion to [#9536](https://github.com/diegosouzapw/OmniRoute/issues/9536) / PR #9657

## TL;DR

`openaiToClaudeResponse()` in [`open-sse/translator/response/openai-to-claude.ts`](../../open-sse/translator/response/openai-to-claude.ts) early-returned before capturing `usage` whenever a chunk had no `choices[0]`. Upstreams using OpenAI's `stream_options.include_usage` contract (confirmed: Fireworks) send the authoritative usage block — including prompt-cache accounting — on exactly that shape: a trailing chunk with `choices: []`. The fix reorders the function so usage capture runs before the choices guard, at the cost of doing that check on every chunk instead of only ones with a choice.

## Context

Two ways OpenAI-compatible upstreams deliver usage in a stream:

1. **Usage attached to the finish_reason chunk itself.** Single chunk, `choices: [{finish_reason: "stop", ...}], usage: {...}`. This already worked.
2. **Usage on a separate trailing chunk, per the `include_usage` spec.** The finish_reason chunk arrives with `usage: null`, then one more chunk follows with `choices: []` and the real `usage` object. This is what Fireworks does, and it's spec-compliant OpenAI behavior, not a Fireworks quirk — so any upstream following that spec exactly hits the same bug.

The existing code only handled case 1. Case 2's trailing chunk was dropped by the `!chunk.choices?.[0]` guard before ever reaching the usage-extraction logic, so `state.usage` kept whatever the finish_reason chunk had set (no cache split, or an estimate downstream falls back to).

## Decision

Move the usage-capture block (lines ~194-215) to run unconditionally on any non-null chunk, before the `choices?.[0]` guard. The guard itself is unchanged for everything after it — content/tool/finish handling still requires a real choice and returns `null` when there isn't one.

### Alternatives considered

- **Special-case `choices: []` explicitly** (`if (chunk.choices?.length === 0 && chunk.usage) { ...capture...; return null; }`) instead of reordering. Rejected: duplicates the extraction logic in two places, or requires extracting it into a shared helper for a one-call-site function — more surface area than reordering three lines for the same effect.
- **Delay `message_delta`/`message_stop` until stream end**, so the terminal SSE event always has final usage regardless of which chunk it arrives on. This is the more complete fix (see Known Limitation below) but changes the finish-emission path shared by every provider going through this translator — bigger blast radius than this PR's scope. Left as a follow-up, not bundled here.

## Known limitation (not fixed by this PR)

`message_delta`/`message_stop` fire as soon as `choice.finish_reason` is seen (guarded by `state.claudeFinishEmitted`), which — per the ordering in case 2 above — is typically _before_ the trailing usage chunk arrives. This PR guarantees `state.usage` is correct for anything reading it **after** the stream completes (billing/logging writes, admin dashboards). It does **not** guarantee the live SSE `message_delta.usage` sent to the client reflects the corrected numbers, since that event may already be on the wire by the time the real usage lands. Confirming and closing that gap (if it matters for OmniRoute's actual billing pipeline) is the follow-up described above.

## Validation

- `tests/unit/11817-streaming-usage-trailing-empty-choices.test.ts` — reproduces the issue's exact Fireworks payload shape and asserts `state.usage` (input/output/cache_read) matches provider-reported numbers; asserts a usage-less trailing chunk is still a safe no-op.
- Full existing suite touching this function (tool calls, XML `<invoke>` parsing, tool-name casing, finish-dedup, the non-streaming #9536 companion test): 93/93 pass, no regressions.
