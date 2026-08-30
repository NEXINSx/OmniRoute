# PR Handoff — six fix branches for the v3.8.51 bug audit

Every finding from [`BUG_AUDIT_v3.8.51.md`](./BUG_AUDIT_v3.8.51.md) now has a fix branch on
`geek007git/OmniRoute`, each based on the upstream tip `25aa95f0d` of `release/v3.8.51`, each with
exactly one Conventional-Commits commit and a failing-then-passing regression test (the project's
Hard Rule #18 TDD protocol). All neighboring test suites were run green and `typecheck:core` is
clean on every code branch.

**How to open each PR:** click the link, paste the title and body given below, and submit.
The base branch is `release/v3.8.51` (already preselected by the links).

| #   | Branch                                      | Fixes audit finding                              | Open PR                                                                                                                                             |
| --- | ------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `fix/orcarouter-translate-path-golden`      | 1 (HIGH — red CI gate)                           | [open](https://github.com/diegosouzapw/OmniRoute/compare/release/v3.8.51...geek007git:OmniRoute:fix/orcarouter-translate-path-golden?expand=1)      |
| 2   | `fix/injection-guard-nonchat-route-logging` | 2 (MEDIUM — silenced security logs)              | [open](https://github.com/diegosouzapw/OmniRoute/compare/release/v3.8.51...geek007git:OmniRoute:fix/injection-guard-nonchat-route-logging?expand=1) |
| 3   | `fix/plugin-hooks-manifest-refresh`         | 3 (MEDIUM — stale plugin manifest)               | [open](https://github.com/diegosouzapw/OmniRoute/compare/release/v3.8.51...geek007git:OmniRoute:fix/plugin-hooks-manifest-refresh?expand=1)         |
| 4   | `fix/codex-import-psd-merge`                | 4+6+7 (MEDIUM+2×LOW — import upsert regressions) | [open](https://github.com/diegosouzapw/OmniRoute/compare/release/v3.8.51...geek007git:OmniRoute:fix/codex-import-psd-merge?expand=1)                |
| 5   | `fix/onstreamcomplete-timeout-isolation`    | 5 (LOW — hook timeout kills plugin)              | [open](https://github.com/diegosouzapw/OmniRoute/compare/release/v3.8.51...geek007git:OmniRoute:fix/onstreamcomplete-timeout-isolation?expand=1)    |
| 6   | `fix/lease-status-connection-projection`    | 8 (LOW — latent PII projection)                  | [open](https://github.com/diegosouzapw/OmniRoute/compare/release/v3.8.51...geek007git:OmniRoute:fix/lease-status-connection-projection?expand=1)    |

Bonus discovery while validating PR 1: `tests/unit/executor-map-golden.test.ts` is ALSO red on the
base tip (stale goldens in `tests/snapshots/executors/`: `executor-map` and `dispatch-rules`) —
same class of missed-regen problem, deliberately left out of these branches. Worth an upstream
issue or its own branch.

---

## PR 1 — fix/orcarouter-translate-path-golden

**Title:** `test(providers): regenerate translate-path golden for OrcaRouter chat-completions base URL`

**Body:**

## Problem

`tests/unit/provider-translate-path-golden.test.ts` is red on the release tip (`25aa95f0d`): `goldenSnapshot()` throws `GoldenMismatchError` for `provider/translate-path` (1 of 3 subtests fails), so every PR cut from `release/v3.8.51` inherits a red unit shard.

## Root cause

Commit `22011437f` (#11923) changed the OrcaRouter base URL in `open-sse/config/providers/registry/orcarouter/index.ts:16` from `https://api.orcarouter.ai/v1` to `https://api.orcarouter.ai/v1/chat/completions`, but did not regenerate the golden snapshot. `tests/snapshots/provider/translate-path.json:4614-4615` still recorded the old `/v1` URL for both `stream` and `nonStream`, and `goldenSnapshot()` (`tests/helpers/goldenSnapshot.ts`) strict-compares.

## Fix

Regenerated the golden with `UPDATE_GOLDEN=1`. The diff is exactly 2 lines — the orcarouter `stream`/`nonStream` url entries now read `https://api.orcarouter.ai/v1/chat/completions`. No other provider entry changed (verified via `git diff`). No production code touched.

## Test evidence

- Before: `node --import tsx/esm --test tests/unit/provider-translate-path-golden.test.ts` → exit 1, `golden mismatch for "provider/translate-path"`.
- After: same command → 3/3 pass (stability, determinism, drift-guard subtests).
- Neighbors: `tests/unit/account-fallback-service.test.ts` (only unit test referencing orcarouter) and `tests/unit/correctness/goldenSnapshot.test.ts` fully green.

## Base-red note

⚠️ base-red inherited: this branch fixes the OrcaRouter translate-path golden failure itself. Separately, `tests/unit/executor-map-golden.test.ts` is also red on the base tip (stale goldens in `tests/snapshots/executors/`: `executor-map` and `dispatch-rules`) — unrelated to this diff (that test never reads `translate-path.json`) and intentionally left for its own fix.

---

## PR 2 — fix/injection-guard-nonchat-route-logging

**Title:** `fix(guardrails): restore injection-guard logging on middleware-only routes`

**Body:**

## Problem

Since #11936, a BLOCKED (400) or flagged prompt-injection attempt on any of the 13 middleware-only routes (`/v1/embeddings`, `/v1/images/*`, `/v1/audio/speech`, `/v1/moderations`, `/v1/rerank`, `/v1/ocr`, `/v1/search`, `/v1/segment`, `/v1/classify`, `/v1/videos/generations`, `/v1/music/generations`) leaves ZERO server-side trace — a security-observability regression.

## Root cause

#11936 removed the console fallback to deduplicate log output: `getLogger()` in `src/lib/guardrails/promptInjection.ts:114` became `options.logger ?? null`, and `createInjectionGuard()` in `src/middleware/promptInjectionGuard.ts:36` passed `log: options.logger ?? null`. The dedupe premise only holds for chat-family routes, where `guardrailRegistry.runPreCallHooks` (`src/sse/handlers/chat.ts:700`) re-evaluates injection with a pino logger. Middleware-only routes call `createInjectionGuard()` with no `options.logger`, so `emitGuardrailLog` became a no-op — their ONLY evaluation went silent.

## Fix

Distinguish "logger omitted" from "logger explicitly disabled":

- `src/middleware/promptInjectionGuard.ts`: omitted logger → `console` fallback restored (middleware-only routes log again); explicit `logger: null` → silence.
- `src/lib/guardrails/promptInjection.ts` `getLogger()`: explicit `logger: null` is honored as an opt-out; omitted logger defers to `context.log` (registry/pino path unchanged).
- The five chat-family callsites that ARE double-evaluated now opt into silence explicitly with `{ logger: null }`, preserving the #11936 dedupe: `/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/messages`, `/v1/relay/chat/completions` (forwards to `handleChat`). The relay **bifrost** route keeps the default and regains logging — it skips `handleChat` entirely (Go sidecar), so it is middleware-only.

Log message content/shape is unchanged.

## Test evidence

New regression test: `tests/unit/injection-guard-nonchat-route-logging.test.ts`

- Before fix: 5 tests, **3 fail** ("a blocked injection on a middleware-only route must leave a server-side trace"); the two silence cases (explicit `logger: null`, caller-supplied logger with no console duplicate) pass before AND after — the #11936 dedupe contract is asserted, not broken.
- After fix: **5/5 pass**.
- Focused guardrail suites: **47/47 pass**. Route-level tests touching the modified routes: **23/23 pass**. `npm run typecheck:core` clean.
- Known unrelated Windows flake: `tests/unit/responses-parse-once-4041.test.ts` teardown `EBUSY ... storage.sqlite` — verified identical on the unmodified base.

⚠️ base-red inherited: the base tip has a red golden gate (OrcaRouter translate-path; see the companion PR) — unrelated to this diff.

---

## PR 3 — fix/plugin-hooks-manifest-refresh

**Title:** `fix(plugins): refresh stored manifest from disk on activate so new hook fields reach existing installs`

**Body:**

## Problem

Plugins installed before #11934 never receive `onStreamComplete` events even after upgrading OmniRoute — the hook silently never registers while the dashboard shows the plugin active. The #11825 delivery fix only works for fresh installs.

## Root cause

The `plugins.manifest` DB column is a snapshot validated by the Zod schema of the version that _installed_ the plugin, and `activate()` consumed it verbatim (`JSON.parse(row.manifest)`, `src/lib/plugins/manager.ts:386` pre-fix). Pre-#11934 installs carry a snapshot where the old `HooksSchema` stripped `hooks.onStreamComplete`, and nothing re-reads `plugin.json`: `scan()` only inserts unknown plugins, `upgrade()` requires a strictly newer version, `activate()` never re-validates. So `manifestFlag` at `src/lib/plugins/loader.ts:346` stays falsy and no IPC wrapper is built.

## Fix

`activate()` (covering the `loadAll()` boot path) now refreshes the manifest from disk: re-read `plugin.json`, `safeValidateManifest()` with the current schema, and — when it validates, names the same plugin, and `main` passes the same `assertEntryPointWithinDest()` containment gate as install/upgrade — persist the refreshed manifest + derived hooks list (`updatePluginManifest()` in `src/lib/db/plugins.ts`) and activate with it. Any read/parse/validation failure, name mismatch, or containment violation falls back to the stored manifest exactly as before (never bricks an existing install). Existing realpath entry-point checks unchanged.

## Test evidence

`tests/unit/plugins-manifest-refresh-on-activate.test.ts` fails on base `25aa95f0d` ("onStreamComplete never reached the plugin — activate() used the stale DB manifest…") and passes with the fix; also covers corrupt-`plugin.json` fallback and name-mismatch guard. 132/132 neighboring plugin tests pass; `typecheck:core` clean.

Command: `node --import tsx/esm --import ./open-sse/utils/setupPolyfill.ts --import ./tests/_setup/isolateDataDir.ts --test --test-force-exit tests/unit/plugins-manifest-refresh-on-activate.test.ts`

⚠️ base-red inherited: the base tip has a red golden gate (OrcaRouter translate-path; see the companion PR) — unrelated to this diff.

---

## PR 4 — fix/codex-import-psd-merge

**Title:** `fix(codex): preserve existing provider state when bulk-import upserts a matching connection`

**Body:**

## Problem

Three related regressions on the bulk-import upsert path that became reachable when 8180b3213 (#11954) started mirroring `workspaceId` into the import payload (`src/lib/oauth/services/codexImport.ts:237-244`), making re-imports match existing OAuth rows and flow into `createProviderConnection`'s upsert:

1. **providerSpecificData clobbered** — the upsert's `merged = { ...decryptedExisting, ...data }` (`src/lib/db/providers.ts:577-583`) replaces PSD wholesale with the import's 3-key object (`chatgptAccountId`, `workspaceId`, `chatgptPlanType`); only the fingerprint seed survives (`ensureCodexFingerprintSeed`). Lost: `chatgptUserId`/`organizations`/`workspacePlanType` (written by the OAuth login flow, `src/lib/oauth/providers/codex.ts:196-202`), runtime quota state (`codexExhaustedWindowByScope`, `codexScopeRateLimitedUntil`, `codexScopeRateLimitSource`), and the operator-set `codexFingerprintMode`. Losing `chatgptUserId` degrades `buildAccountIdentity` (`src/lib/usage/accountIdentity.ts:65-75`) from user-keyed to email-keyed identity and fragments usage history.
2. **Stale "Token Expired" badge** — the payload set `expiresAt` but never `tokenExpiresAt`, so the upsert kept the old row's long-expired `tokenExpiresAt`, which the dashboard badge prefers (`src/lib/oauth/connectionPersistence.ts:87-94`).
3. **Duplicate priorities** — the forwarded 9router `priority` overwrote the matched row's priority, and the upsert branch (unlike `updateProviderConnection`, `providers.ts:987-994`) never calls `reorderConnections`.

## Fix

Caller-side, mirroring the single-file import's correct pattern (`src/lib/oauth/utils/codexAuthImport.ts:211-216`):

- `codexImport.ts` gains a **pure** exported helper `preserveExistingCodexConnectionState(payload, existingConnections)`: when a connection with the same email + `providerSpecificData.workspaceId` (the exact upsert match key) exists, it merges the import's PSD keys **over** the existing row's PSD and drops the forwarded priority so the operator's ordering wins. No match → payload unchanged.
- The normalizer now mirrors `expiresAt` into `tokenExpiresAt` (same #5326 pattern as `buildOAuthConnectionCreatePayload`).
- The route (`src/app/api/oauth/codex/import/route.ts`) fetches current codex OAuth connections per record and passes the payload through the helper before `createProviderConnection`. Per-record fetch matters: an earlier record in the same batch may create the row a later duplicate must match.

`createProviderConnection`/`updateProviderConnection` semantics are untouched for all other callers.

## Test evidence

New regression suite `tests/unit/codex-bulk-import-preserve-state-11954.test.ts` (real route POST + SQLite, fetch mocked, `resetDbInstance()` + handle cleanup in hooks). Before the fix all four tests fail for the documented reasons (`chatgptUserId` → `undefined`, `tokenExpiresAt` stuck at the stale ISO, matched priority duplicating a sibling's, create-path `tokenExpiresAt` `undefined`); after the fix 4/4 pass. Adjacent suites green: `codexBulkImport`, `codex-import-refresh-validation-7522`, `codex-import-route`, `codexAuthImport`, `codexAuthImportBulk`, `codex-auth-import-userid-dedup-6301`, `codex-session-json-import-6636`, `codex-import-token-route`, `oauth-import-manage-scope`. `npm run typecheck:core` clean.

⚠️ base-red inherited: the base tip has a red golden gate (OrcaRouter translate-path; see the companion PR) — unrelated to this diff.

---

## PR 5 — fix/onstreamcomplete-timeout-isolation

**Title:** `fix(plugins): do not kill the plugin process when a fire-and-forget hook times out`

**Body:**

## Problem

Since #11934 wired `onStreamComplete` through the plugin loader's `callHook()`, a single slow delivery of this hook kills the whole plugin. `onStreamComplete` is a fire-and-forget, one-way notification that fires once per completed stream — a plugin posting usage to a slow remote sink can plausibly exceed `DEFAULT_HOOK_TIMEOUT` (10s). When that happens, the timeout path SIGTERM→SIGKILLs the plugin's child process with no respawn anywhere: every other in-flight hook call is rejected ("Channel closed") and the plugin is left dead-but-shown-active until a manual deactivate/activate.

## Root cause

`src/lib/plugins/loader.ts` — `callHook()`'s timeout handler unconditionally escalates `child.kill("SIGTERM")` → `SIGKILL`. Those kill semantics pre-existed for rarely-fired blocking/lifecycle hooks, but #11934's lifecycle-hook loop (loader.ts:349-363) routed the per-stream `onStreamComplete` notification through the same path.

## Fix

- New `NOTIFICATION_HOOKS` set (currently `onStreamComplete`): on timeout the pending IPC call is dropped — the promise resolves, a warning naming the plugin and hook is logged (`plugin.notification_hook_timeout_dropped`) — and the child process stays alive to serve subsequent hooks. A late IPC reply for the dropped id is safely ignored (the pending entry is gone; call ids are monotonic and never reused).
- Blocking hooks (`onRequest`/`onResponse`/`onError`) and lifecycle hooks keep the kill-on-timeout isolation semantics unchanged — pinned by a dedicated test.
- `loadPlugin()` gains an optional `LoadPluginOptions { hookTimeoutMs? }` (default unchanged, 10s) so the timeout paths are testable without waiting out the production value. Both existing callers unaffected.

## Test evidence

`node --import tsx/esm --test tests/unit/plugins-onstreamcomplete-timeout-isolation.test.ts`

- **Before (base 25aa95f0d):** fails for the documented reason — `plugin.onStreamComplete_error ... timed out after 10000ms` → `loader.process_exit` → `Channel closed`.
- **After:** 2/2 pass — the timed-out delivery settles with a warning, the child survives, a subsequent delivery reaches the plugin; the blocking-hook (`onRequest`) timeout still kills the process.
- Regression runs (all green): `plugins-loader`, `plugins-loader-ipc`, `8395-plugin-hooks-fire`, `plugins-onstreamcomplete-delivery-11825`, `plugins-index`, `plugins-dev-mode`, `chatcore-plugin-onresponse`, `plugins-manager-restart-reload-7806`, `plugins-manager`, `plugins-manager-lifecycle`, `plugins-hooks`, `plugins-hook-payload-chaining-3286`. `npm run typecheck:core` clean.
- Pre-existing Windows-only failures on the unmodified base: `plugins-welcome-banner-e2e` (bare-path dynamic import), `plugins-edge-cases` (`EBUSY` on SQLite temp unlink).

⚠️ base-red inherited: the base tip has a red golden gate (OrcaRouter translate-path; see the companion PR) — unrelated to this diff.

---

## PR 6 — fix/lease-status-connection-projection

**Title:** `fix(leases): project status lease row to lease columns so joined connection PII never escapes`

**Body:**

## Problem

`getExclusiveConnectionLeaseStatus` returns a `lease` object that, at runtime, silently carries the connection owner's identity: `connectionEmail`, `connectionDisplayName`, `connectionName`, `connectionAuthType`, and `connectionProvider` — the raw, unfiltered joined values, bypassing the `configuredConnectionName()` privacy fencing that #11910 (81bf1ef98) introduced.

This is latent, defense-in-depth: the only consumer today (`src/app/api/v1/session-leases/route.ts:104-110`) whitelists five lifecycle fields, so nothing leaks in the current release. But `ExclusiveConnectionLease`'s declared type does not include those keys, so any future consumer that serializes `status.lease` directly type-checks fine and leaks the connection owner's email/display name.

## Root cause

`src/lib/db/exclusiveConnectionLeases.ts:62` — `const lease = (row: LeaseRow) => rowToCamel(row) as ExclusiveConnectionLease;` is a cast, not a projection. The status query selects `leases.*` plus five joined `connections.*` columns into a `LeaseStatusRow`, and `rowToCamel` faithfully camelizes every column it is given.

## Fix

`lease()` is now an explicit projection that returns exactly the 12 declared `ExclusiveConnectionLease` fields. Joined rows can never smuggle extra columns onto the runtime object — hardening the status path and every current/future `lease()` call site. The status-level fenced fields (`provider`, `connectionName` via `configuredConnectionName()`) are unchanged, and the session-leases route needed no changes.

## Test evidence

New regression test `tests/unit/exclusive-lease-status-projection.test.ts` — seeds a connection with a real email + display name, acquires a lease, calls `getExclusiveConnectionLeaseStatus`, and asserts the returned lease object has none of the five joined keys (and exactly the 12 declared keys), while lifecycle fields and the fenced `displayName`/`provider` behavior are intact.

- Before fix: `not ok 1 ... lease must not carry connectionEmail` (1 fail) → After fix: 1 pass.
- No regression: `exclusive-connection-leases` + `session-leases-route` → 25/25; `sse-auth-exclusive-leases`, `chat-managed-lease-routing`, `exclusive-lease-auxiliary-isolation`, `exclusive-lease-connection-test-isolation` → 48/48; `exclusive-lease-managed-set`, `exclusive-lease-api-key-policy`, `lease-context` → 15/15. `npm run typecheck:core` clean.

⚠️ base-red inherited: the base tip has a red golden gate (OrcaRouter translate-path; see the companion PR) — unrelated to this diff.
