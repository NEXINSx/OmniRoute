/**
 * Pure domain vocabulary for the Orchestration Canvas — no React, no side effects.
 * Spec: _tasks/superpowers/specs/2026-08-30-orchestration-canvas-design.md
 */
import { STATUS_HEX } from "@/shared/constants/statusColors";

export type OrchState =
  "queued" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
export type OrchSource = "cloud-agent" | "a2a" | "conductor" | "routing";
export type OrchNodeKind = "orchestrator" | "source" | "work" | "activity" | "overflow";

export interface OrchNode {
  id: string; // `${source}:${sourceId}` for work nodes
  kind: OrchNodeKind;
  source?: OrchSource;
  state?: OrchState;
  label: string;
  sublabel?: string;
  startedAt?: string;
  updatedAt?: string;
  endedAt?: string;
  cost?: number;
  counts?: Partial<Record<OrchState, number>>;
  // Overflow nodes only: per-state counts of the work nodes folded into this
  // overflow node when the MAX_WORK_NODES cap engages. overviewProjection folds
  // this into its `counts` totals (never into `columns`) so operators still see
  // TRUE totals even when the canvas caps the rendered node count.
  droppedByState?: Partial<Record<OrchState, number>>;
  mirrorOf?: string;
  raw?: unknown;
}

export interface OrchEdge {
  id: string;
  from: string;
  to: string;
  kind: "owns" | "mirror";
  active: boolean; // true while the target work is `running`
}

export interface SourceStatus {
  source: OrchSource;
  ok: boolean;
  offline?: boolean;
  error?: string;
  staleSince?: string;
}

export interface OrchSnapshot {
  nodes: OrchNode[];
  edges: OrchEdge[];
  sources: SourceStatus[];
  generatedAt: string;
}

export const ORCH_STATES = [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly OrchState[];

const STATE_HEX: Record<OrchState, string> = {
  queued: STATUS_HEX.muted,
  running: STATUS_HEX.warning,
  waiting_approval: STATUS_HEX.approval,
  succeeded: STATUS_HEX.success,
  failed: STATUS_HEX.error,
  cancelled: STATUS_HEX.muted,
};

export function orchStateColor(state: OrchState): string {
  return STATE_HEX[state];
}

export const STALE_COMPLETED_MS = 600_000; // completed >10 min ago drop out of the live view
export const MAX_WORK_NODES = 40; // beyond this, per-source overflow nodes take over
