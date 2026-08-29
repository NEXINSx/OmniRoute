/**
 * lkgpClearing.ts — clearing the Last Known Good Provider (LKGP) pin when a
 * combo target is marked exhausted (#11911).
 *
 * Shared by both combo dispatchers (handleComboChat + handleRoundRobinCombo).
 * `setLKGP` is only ever called on success, so a pin never got invalidated once
 * its target started failing; the exhaustion-classification sites were the hole.
 *
 * Two pins are written on success (`setLKGP(combo.name, <key>, provider, connId)`):
 *   - `<combo.name>:<target.executionKey>` — names exactly that one target,
 *   - `<combo.name>:<combo.id || combo.name>` — the combo-level pin read by
 *     applyStrategyOrdering / resolveAutoStrategy on the next request.
 *
 * Clearing safety differs per pin:
 *   - The `executionKey` pin always names the target that just failed — clear it.
 *   - The combo-level pin records whichever target last succeeded, which needn't
 *     be the one that just failed (a target can be skipped and a *different*,
 *     healthy one tried and exhausted). Keep a preference that points at a
 *     healthy target; clear it only when it names the exhausted provider and,
 *     when both carry a connectionId, the exhausted connection.
 */
import type { ComboLogger } from "./types.ts";

export type LKGPExhaustionTarget = {
  executionKey: string;
  provider?: string | null;
  connectionId?: string | null;
};

export type ClearLKGPOnExhaustionOptions = {
  comboName: string;
  /** `combo.id || combo.name` — the combo-level pin key (must match the read sites). */
  comboKey: string;
  target: LKGPExhaustionTarget;
  providerExhausted: boolean;
  exhaustedConnections: Set<string>;
  log: ComboLogger;
  tag: string;
};

/**
 * Clear the LKGP pin when a combo target was just marked exhausted. No-op when
 * nothing was actually marked (mirrors the #1731/#1731v2 classification guard:
 * with a connectionId the exhaustion is connection-scoped, otherwise the
 * provider itself is dead). Fire-and-forget at the call sites; failures are
 * logged, never thrown.
 */
export async function clearLKGPOnExhaustion(opts: ClearLKGPOnExhaustionOptions): Promise<void> {
  const { comboName, comboKey, target, providerExhausted, exhaustedConnections, log, tag } = opts;
  const provider = target.provider;
  const connId = target.connectionId ?? undefined;

  // #11911: exhaustion is either provider-level (`providerExhausted`) or
  // connection-level (the `${provider}:${connId}` key in exhaustedConnections).
  // `providerExhausted` also returns true for a connection-scoped 401/403 (see
  // markAuthLevelExhaustion) and agentrouter quota exhaustion, but in every such
  // case the connId key lands in exhaustedConnections too — so with a connId the
  // set membership is the load-bearing check, and the `"undefined"` interpolation
  // the inline code had is avoided by gating on connId's presence.
  if (
    !provider ||
    provider === "unknown" ||
    !(connId ? exhaustedConnections.has(`${provider}:${connId}`) : providerExhausted)
  ) {
    return;
  }

  try {
    const { clearLKGP, getLKGP } = await import("../../../src/lib/localDb");
    // The executionKey pin always names the target that just failed.
    await clearLKGP(comboName, target.executionKey);
    // The combo-level pin records whichever target last succeeded, which needn't
    // be the one that just failed — keep a preference pointing at a healthy
    // target, clear it only when it names the exhausted provider/connection.
    const pinned = await getLKGP(comboName, comboKey);
    if (
      pinned?.provider === provider &&
      (connId == null || pinned.connectionId == null || pinned.connectionId === connId)
    ) {
      await clearLKGP(comboName, comboKey);
    }
  } catch (err) {
    log.warn(tag, "Failed to clear Last Known Good Provider. This is non-fatal.", { err });
  }
}
