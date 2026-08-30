/**
 * tests/unit/ui/orchestrationModel.test.ts
 * Run: node --import tsx/esm --test tests/unit/ui/orchestrationModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORCH_STATES,
  orchStateColor,
} from "../../../src/app/(dashboard)/dashboard/orchestration/model/orchestrationTypes.ts";
import { STATUS_HEX } from "../../../src/shared/constants/statusColors.ts";
import { fromCloudAgent } from "../../../src/app/(dashboard)/dashboard/orchestration/model/fromCloudAgent.ts";
import type { CloudAgentTask } from "../../../src/lib/cloudAgent/types.ts";
import { fromA2A } from "../../../src/app/(dashboard)/dashboard/orchestration/model/fromA2A.ts";
import type { A2ATask } from "../../../src/lib/a2a/taskManager.ts";

describe("orchestrationTypes", () => {
  it("covers all six states with a color each", () => {
    assert.equal(ORCH_STATES.length, 6);
    for (const s of ORCH_STATES) {
      assert.match(orchStateColor(s), /^#[0-9a-f]{6}$/i, s);
    }
  });
  it("waiting_approval maps to the new STATUS_HEX.approval violet", () => {
    assert.equal(orchStateColor("waiting_approval"), STATUS_HEX.approval);
    assert.equal(STATUS_HEX.approval, "#8b5cf6");
  });
  it("running maps to warning, succeeded to success, failed to error", () => {
    assert.equal(orchStateColor("running"), STATUS_HEX.warning);
    assert.equal(orchStateColor("succeeded"), STATUS_HEX.success);
    assert.equal(orchStateColor("failed"), STATUS_HEX.error);
  });
});

function caTask(over: Partial<CloudAgentTask>): CloudAgentTask {
  return {
    id: "t1",
    providerId: "devin",
    status: "running",
    prompt: "Fix the flaky test in CI",
    source: { repoName: "acme/app", repoUrl: "https://github.com/acme/app" },
    options: {},
    activities: [],
    createdAt: "2026-08-30T10:00:00Z",
    updatedAt: "2026-08-30T10:05:00Z",
    ...over,
  } as CloudAgentTask;
}

describe("fromCloudAgent", () => {
  it("maps every status to the unified OrchState", () => {
    const cases: Array<[CloudAgentTask["status"], string]> = [
      ["queued", "queued"],
      ["running", "running"],
      ["awaiting_approval", "waiting_approval"],
      ["completed", "succeeded"],
      ["failed", "failed"],
      ["cancelled", "cancelled"],
    ];
    for (const [input, expected] of cases) {
      const { nodes } = fromCloudAgent([caTask({ status: input })]);
      const work = nodes.find((n) => n.kind === "work");
      assert.equal(work?.state, expected, input);
    }
  });
  it("unknown status becomes failed with the raw value in sublabel", () => {
    const { nodes } = fromCloudAgent([caTask({ status: "exploded" as CloudAgentTask["status"] })]);
    const work = nodes.find((n) => n.kind === "work");
    assert.equal(work?.state, "failed");
    assert.match(work?.sublabel ?? "", /exploded/);
  });
  it("running task with activities gets one ActivityNode; completed does not", () => {
    const running = caTask({
      activities: [
        { id: "a1", type: "command", content: "npm test", timestamp: "2026-08-30T10:04:00Z" },
      ],
    });
    const done = caTask({ id: "t2", status: "completed", activities: running.activities });
    const { nodes, edges } = fromCloudAgent([running, done]);
    const acts = nodes.filter((n) => n.kind === "activity");
    assert.equal(acts.length, 1);
    assert.equal(acts[0].id, "cloud-agent:t1:activity");
    assert.ok(
      edges.some(
        (e) => e.from === "cloud-agent:t1" && e.to === "cloud-agent:t1:activity" && e.active
      )
    );
  });
  it("emits a SourceNode with per-state counts and owns-edges from it", () => {
    const { nodes, edges } = fromCloudAgent([caTask({}), caTask({ id: "t2", status: "failed" })]);
    const src = nodes.find((n) => n.id === "source:cloud-agent");
    assert.equal(src?.counts?.running, 1);
    assert.equal(src?.counts?.failed, 1);
    assert.ok(
      edges.some(
        (e) => e.from === "source:cloud-agent" && e.to === "cloud-agent:t1" && e.kind === "owns"
      )
    );
  });
  it("empty input emits nothing", () => {
    const out = fromCloudAgent([]);
    assert.equal(out.nodes.length, 0);
    assert.equal(out.edges.length, 0);
  });
});

function a2aTask(over: Partial<A2ATask>): A2ATask {
  return {
    id: "a1",
    skill: "smart-routing",
    state: "working",
    input: { skill: "smart-routing", messages: [{ role: "user", content: "route this well" }] },
    artifacts: [],
    events: [{ timestamp: "2026-08-30T10:00:00Z", state: "submitted" }],
    metadata: {},
    createdAt: "2026-08-30T10:00:00Z",
    updatedAt: "2026-08-30T10:01:00Z",
    expiresAt: "2026-08-30T10:05:00Z",
    ...over,
  } as A2ATask;
}

describe("fromA2A", () => {
  it("maps the five A2A states", () => {
    const cases: Array<[A2ATask["state"], string]> = [
      ["submitted", "queued"],
      ["working", "running"],
      ["completed", "succeeded"],
      ["failed", "failed"],
      ["cancelled", "cancelled"],
    ];
    for (const [input, expected] of cases) {
      const { nodes } = fromA2A([a2aTask({ state: input })]);
      assert.equal(nodes.find((n) => n.kind === "work")?.state, expected, input);
    }
  });
  it("work node id is a2a:<id>, label is the skill", () => {
    const { nodes } = fromA2A([a2aTask({})]);
    const w = nodes.find((n) => n.kind === "work");
    assert.equal(w?.id, "a2a:a1");
    assert.equal(w?.label, "smart-routing");
  });
  it("empty input emits nothing", () => {
    assert.equal(fromA2A([]).nodes.length, 0);
  });
});
