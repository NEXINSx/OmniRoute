/** Run: node --import tsx/esm --test tests/unit/ui/overviewProjection.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { overviewProjection } from "../../../src/app/(dashboard)/dashboard/orchestration/model/overviewProjection.ts";
import type { OrchSnapshot } from "../../../src/app/(dashboard)/dashboard/orchestration/model/orchestrationTypes.ts";

const snap: OrchSnapshot = {
  nodes: [
    { id: "orchestrator", kind: "orchestrator", label: "OmniRoute" },
    { id: "cloud-agent:1", kind: "work", source: "cloud-agent", state: "running", label: "a" },
    {
      id: "cloud-agent:2",
      kind: "work",
      source: "cloud-agent",
      state: "waiting_approval",
      label: "b",
    },
    {
      id: "a2a:3",
      kind: "work",
      source: "a2a",
      state: "failed",
      label: "c",
      updatedAt: "2026-08-30T11:00:00Z",
    },
    { id: "a2a:3:activity", kind: "activity", source: "a2a", state: "running", label: "noise" },
  ],
  edges: [],
  sources: [],
  generatedAt: "2026-08-30T12:00:00Z",
};

describe("overviewProjection", () => {
  it("counts only work nodes and adds comboActive to running", () => {
    const { counts } = overviewProjection(snap, 4);
    assert.equal(counts.running, 1 + 4);
    assert.equal(counts.waiting_approval, 1);
    assert.equal(counts.failed, 1);
    assert.equal(counts.queued, 0);
  });
  it("folds terminals into the done column", () => {
    const { columns } = overviewProjection(snap, 0);
    assert.equal(columns.done.length, 1);
    assert.equal(columns.done[0].id, "a2a:3");
    assert.equal(columns.running.length, 1);
  });
  it("folds an overflow node's droppedByState into counts but not into columns", () => {
    const snapWithOverflow: OrchSnapshot = {
      ...snap,
      nodes: [
        ...snap.nodes,
        {
          id: "overflow:cloud-agent",
          kind: "overflow",
          source: "cloud-agent",
          label: "+7 more",
          droppedByState: { running: 5, failed: 2 },
        },
      ],
    };
    const { counts, columns } = overviewProjection(snapWithOverflow, 0);
    assert.equal(counts.running, 1 + 5);
    assert.equal(counts.failed, 1 + 2);
    assert.equal(columns.running.length, 1);
    assert.equal(columns.done.length, 1);
  });
});
