# Bug Audit — release/v3.8.51 (latest commits)

- **Repo:** diegosouzapw/OmniRoute, branch `release/v3.8.51`
- **Audited tip:** `25aa95f0d0f5ba8f3fbb4c1deab0906344de3b81` (2026-08-30)
- **Audit date:** 2026-08-30
- **Scope:** the 18 newest substantive commits on the branch (16 deep-audited, 2 spot-checked; dependabot bumps excluded). Every finding below carries a concrete failure scenario; commits with no defensible finding are listed as clean at the end.
- **Note:** this file lives on a report-only branch (`report/bug-audit-v3.8.51`). It is not meant to be merged upstream as-is — use it to file issues / cut fix PRs.

---

## Finding 1 — [HIGH] OrcaRouter `baseUrl` change shipped without regenerating the translate-path golden → blocking unit gate red on the branch tip

- **Commit:** `22011437f` — fix(providers): route OrcaRouter chat requests to /v1/chat/completions (#11923)
- **Files:** `tests/snapshots/provider/translate-path.json:4614-4615` (stale) vs `open-sse/config/providers/registry/orcarouter/index.ts:16`
- **Status:** CONFIRMED by direct inspection at the tip.

The commit changed the orcarouter registry `baseUrl` from `https://api.orcarouter.ai/v1` to `https://api.orcarouter.ai/v1/chat/completions`, but did not regenerate `tests/snapshots/provider/translate-path.json`. `buildProviderUrl("orcarouter", …)` (`open-sse/services/provider.ts:272-333`) returns the registry `baseUrl` verbatim (orcarouter has no `baseUrls`/`urlBuilder`/`urlSuffix` and is not openai-compatible-prefixed), and `goldenSnapshot()` (`tests/helpers/goldenSnapshot.ts:52-55`) does a strict string compare and throws `GoldenMismatchError`. The golden at the tip still records:

```json
"nonStream": "https://api.orcarouter.ai/v1",
"stream": "https://api.orcarouter.ai/v1"
```

**Failure scenario:** `node --import tsx/esm --test tests/unit/provider-translate-path-golden.test.ts` (part of the blocking unit suite) fails with `GoldenMismatchError` on the orcarouter entry — every PR cut from `release/v3.8.51` inherits a red unit shard (same class as the #7840 precedent).

**Suggested fix:** regenerate the golden (`UPDATE_GOLDEN=1 node --import tsx/esm --test tests/unit/provider-translate-path-golden.test.ts`) and commit the updated orcarouter URLs. The runtime URL change itself is correct and matches sibling gateways.

---

## Finding 2 — [MEDIUM] Duplicate-log fix silenced injection-guard logging entirely on the 13 non-chat routes

- **Commit:** `8bed10130` — fix(guardrails): prevent duplicate prompt-injection-guard log output (#11936)
- **Files:** `src/middleware/promptInjectionGuard.ts:36`, `src/lib/guardrails/promptInjection.ts:114`

The dedupe premise ("the console line duplicates the structured pino log") only holds for routes that flow into `handleChat`, where `guardrailRegistry.runPreCallHooks` (`src/sse/handlers/chat.ts:700`) re-evaluates prompt injection with a pino logger. For the 13 routes whose ONLY injection evaluation is the middleware — `/v1/embeddings`, `/v1/images/generations`, `/v1/images/edits`, `/v1/images/upscale`, `/v1/audio/speech`, `/v1/moderations`, `/v1/rerank`, `/v1/ocr`, `/v1/search`, `/v1/segment`, `/v1/classify`, `/v1/videos/generations`, `/v1/music/generations` — the removed console fallback was the only emitter. `createInjectionGuard()` is called with no `options.logger` on all of them, so `getLogger()` returns `null` and `emitGuardrailLog` (`promptInjection.ts:123-124`) becomes a no-op. Neither the 400 branch nor the flagged branch logs anything, and no `call_logs` row is written for these blocks.

**Failure scenario:** with `INJECTION_GUARD_MODE=block`, an attacker POSTs `/v1/embeddings` with a high-severity injection pattern. The request is correctly rejected 400, but the server log contains nothing. In the default `warn` mode it is worse: a flagged request proceeds upstream with zero log — the security event leaves no server-side trace.

**Suggested fix:** keep a real logger fallback in `createInjectionGuard` and have only the chat-family routes (the ones actually double-evaluated) opt into silence explicitly (e.g. `createInjectionGuard({ logger: null })` with an explicit-null check).

---

## Finding 3 — [MEDIUM] `onStreamComplete` plugin fix never takes effect for plugins installed before the upgrade

- **Commit:** `66e02ec73` — fix(plugins): deliver onStreamComplete to disk-installed plugins (#11825) (#11934)
- **Files:** `src/lib/plugins/manager.ts:386`, `src/lib/plugins/loader.ts:346`

The manifest a plugin activates with is the JSON persisted to the DB at install time, not `plugin.json` on disk. Under the pre-fix code, `HooksSchema` had no `onStreamComplete` field, so Zod stripped it at install time. After upgrading OmniRoute, every pre-existing install has `manifest.hooks.onStreamComplete === undefined` at `activate()`/`loadAll()` time, so no IPC wrapper is built and the hook is never registered. There is no refresh path: `scan()` only inserts unknown plugins, `upgrade()` requires a strictly newer plugin version, and `activate()` never re-validates `plugin.json` from disk. The regression test only installs a fresh plugin, so it cannot catch this.

**Failure scenario:** the #11825 reporter upgrades to v3.8.51 expecting the fix; on boot `activate()` parses the stale DB manifest, the hook is silently not registered, and the plugin never receives `onStreamComplete` while the dashboard shows it active. Only uninstall/reinstall or a version-bumped upgrade heals it.

**Suggested fix:** in `activate()` (or a one-shot migration), re-read and `safeValidateManifest()` the on-disk `plugin.json` and refresh the stored manifest, so schema additions reach already-installed plugins.

---

## Finding 4 — [MEDIUM] Codex bulk-import upsert wipes existing `provider_specific_data` (identity, org, quota-window, fingerprint-mode keys)

- **Commit:** `8180b3213` — fix(codex): restore imported account state (#11954)
- **Files:** `src/lib/oauth/services/codexImport.ts:237-244` interacting with `src/lib/db/providers.ts:577-583`

By mirroring `workspaceId`, the import now matches existing OAuth-created rows and reaches `createProviderConnection`'s upsert, where `merged = { ...decryptedExisting, ...data }` REPLACES `providerSpecificData` wholesale with the import's 3-key object (`chatgptAccountId`, `workspaceId`, `chatgptPlanType`). Only the fingerprint seed is carried forward (`open-sse/config/codexIdentity.ts:120-143`). Everything else stored by the OAuth flow (`chatgptUserId`, `organizations`, `workspacePlanType` — `src/lib/oauth/providers/codex.ts:196-202`) and by the runtime (`codexExhaustedWindowByScope`, `codexScopeRateLimitedUntil`, `codexScopeRateLimitSource`, operator-set `codexFingerprintMode`) is silently dropped. The sibling single-file import path does this correctly — `codexAuthImport.ts:211-216` spreads `...toRecord(existing.providerSpecificData)` before overriding.

**Failure scenario:** operator has a dashboard-OAuth codex connection; they bulk-import a CodexSwitcher export containing the same account. The row loses `chatgptUserId`, so `buildAccountIdentity` (`src/lib/usage/accountIdentity.ts:65-75`) degrades from a user-keyed identity to an email-keyed one, and since this upsert branch sets `promotedCodexIdentity=false`, `reconcileCodexUsageHistory` never runs — usage/quota history fragments across two account keys. A per-connection `codexFingerprintMode` override silently reverts to default.

**Suggested fix:** merge incoming PSD over the existing decrypted PSD (`{ ...existingPsd, ...importPsd }`) as `codexAuthImport.ts` does, and/or run `reconcileCodexUsageHistory` on the workspace+email match.

---

## Finding 5 — [LOW] A slow `onStreamComplete` handler (>10s) permanently kills the whole plugin child process

- **Commit:** `66e02ec73` (same as Finding 3)
- **Files:** `src/lib/plugins/loader.ts:349-363` (timeout mechanics at `loader.ts:264-275`)

The new `onStreamComplete` wrapper reuses `callHook()`, whose timeout path does `child.kill("SIGTERM")` → SIGKILL escalation with no respawn logic. That kill semantics pre-exists for rarely-fired lifecycle hooks, but this commit attaches it to a hook documented as fire-and-forget that now fires once per completed stream. A single handler invocation exceeding `DEFAULT_HOOK_TIMEOUT` (10s — plausible for a plugin exporting usage to a slow remote sink) kills the plugin process, rejects every other in-flight hook call, and leaves the plugin dead-but-shown-active until manual deactivate/activate.

**Suggested fix:** for one-way notification hooks, time out the IPC wait without killing the child (drop the pending call), or add child respawn on unexpected exit.

---

## Finding 6 — [LOW] Re-import leaves stale `tokenExpiresAt` → dashboard shows "Token Expired" for freshly imported tokens

- **Commit:** `8180b3213` (same as Finding 4)
- **Files:** `src/lib/oauth/services/codexImport.ts:246-263`, `src/lib/db/providers.ts:577`

The import payload sets `expiresAt` but never `tokenExpiresAt`. On the newly reachable upsert path, `merged` keeps the existing row's (possibly long-expired) `tokenExpiresAt`, and the dashboard badge prefers `tokenExpiresAt || expiresAt` (`src/lib/oauth/connectionPersistence.ts:87-94`). Before this commit, imports always inserted a fresh row with `tokenExpiresAt = NULL`, so the badge correctly fell back to the new `expiresAt`.

**Failure scenario:** re-importing fresh tokens for an account whose old tokens expired weeks ago reports success and `testStatus: "active"`, yet the row shows a "Token Expired" badge until the first background refresh.

**Suggested fix:** set `tokenExpiresAt` alongside `expiresAt` in the import payload (mirroring `buildOAuthConnectionCreatePayload`).

---

## Finding 7 — [LOW] Imported `priority` overwrites the matched row's priority without reordering → duplicate priorities

- **Commit:** `8180b3213` (same as Finding 4)
- **Files:** `src/lib/oauth/services/codexImport.ts:265-267`

A 9router export's `priority` is forwarded; on the upsert path it replaces the operator's priority for the matched connection, and unlike `updateProviderConnection` (`src/lib/db/providers.ts:987-994`) the upsert branch never calls `reorderConnections`, so two codex connections can end up with the same priority value, making priority-strategy account selection tie-dependent.

**Suggested fix:** ignore `priority` when the record matches an existing row, or run `reorderConnections` after the upsert when the priority changed.

---

## Finding 8 — [LOW, latent] Lease status result silently carries joined PII columns behind the `ExclusiveConnectionLease` type

- **Commit:** `81bf1ef98` — feat(leases): expose owner-authenticated connection display name (#11910)
- **Files:** `src/lib/db/exclusiveConnectionLeases.ts:247`

`getExclusiveConnectionLeaseStatus` builds the returned `lease` via `rowToCamel(row) as ExclusiveConnectionLease` — a cast, not a projection — so the runtime object also contains `connectionEmail`, `connectionDisplayName`, `connectionName`, `connectionAuthType`, `connectionProvider` (unfiltered, bypassing the `configuredConnectionName` privacy fencing). Not observable today: the only consumer (`src/app/api/v1/session-leases/route.ts:104-110`) whitelists five lifecycle fields. But any future consumer that serializes `status.lease` directly (which type-checks fine) leaks the connection owner's email/display name past the fencing this very commit was designed around.

**Suggested fix:** strip the joined `connection_*` columns before calling `lease()`, or select a projected object.

---

## Commits audited clean

| Commit | Subject | Verdict notes |
| --- | --- | --- |
| `823dae0e9` | fix(skills): expand shorthand property types in injected tool schemas | Functionally a no-op — logic already landed byte-identically in `c5ebbb733` (#11881); adds a comment reword + extra regression test |
| `3852e0534` | fix(build): fail fast when an externalised optional native dep was silently dropped | `isAndroid` scope fix correct; the new gate is fail-open in every ambiguous case |
| `15b164866` | feat(providers): usage-fetch capability in provider plugin manifest | Extracted list is entry-for-entry identical (46/46); re-exports keep all importers working; new capability tag is discovery-only |
| `2471a0d95` | feat(plugins): OMNIROUTE_PLUGINS_DIR override | Operator-controlled env config; discovery and install root move together; entry-point containment guard intact |
| `41c613525` | fix(ollama): preserve multi-byte UTF-8 across stream chunks | Persistent `TextDecoder{stream:true}` correctly scoped per call; missing final drain immaterial (partial trailing line was already discarded by design) |
| `ff0743071` | fix(auth): downgrade transient states warn→debug | Every downgraded path still ends in a caller-visible outcome; legitimate noise reduction |
| `41f4f8377` | fix(release): tag-push Create Release never appends auto notes | Comment rewrite + `generate_release_notes: false`; no injection surface touched |
| `79b2e92c4` | fix(codex): fail over image generation for imported free plans | Plan detection keeps OAuth field authoritative; failover loop provably bounded; no state corruption |
| `e96e40c03` | fix(images): forward Antigravity image size | Null/type-safe normalization; Zod catchall passes `image_size` through |
| `097226b61` | fix(codex): normalize non-stream responses | `forceStream` mirrors chatgpt-web-codex exactly; upstream request unchanged; SSE→JSON bridge intact |
| `70af41b9f` | fix(db): invalidate connection cache after upsert | All `provider_connections` write paths audited — all invalidate (one skips by documented design) |
| `1c37fff05` | fix(memory): honor category filter in GET /api/memory | `json_valid` guard correct; Obsidian path safe (`metadata` defaults to `{}`) |
| `a1d6ff5fb` | fix(api): preserve caller-provided X-Correlation-Id | CRLF-stripped, length-bounded; `handleChatImplementation` accepts the 4th `correlationId` param on both call sites |

## Method

Each commit's full diff was read together with the surrounding code at the tip (not diff-only review); callers of changed functions were traced with grep; every finding above names a concrete failure scenario. Findings were produced by four independent review passes over disjoint commit batches and the highest-severity claim (Finding 1) was re-verified by direct file inspection at the audited tip.
