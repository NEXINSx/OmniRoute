/** Conductor fleet snapshot → unified orchestration nodes. Pure. */
import type { FleetSnapshot, FleetTask } from "@/lib/conductor/hubProxy";
import type { OrchEdge, OrchNode, OrchState } from "./orchestrationTypes";

function mapHubStatus(status: string): OrchState | null {
  const s = status.toLowerCase();
  if (s === "queued" || s === "pending") return "queued";
  if (s === "running" || s === "working" || s === "scheduled") return "running";
  if (s === "done" || s === "completed" || s === "succeeded") return "succeeded";
  if (s === "failed" || s === "error") return "failed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return null;
}

function taskNode(t: FleetTask, kind: "work" | "activity"): OrchNode {
  const mapped = mapHubStatus(t.status);
  return {
    id: `conductor:task:${t.id}`,
    kind,
    source: "conductor",
    state: mapped ?? "failed",
    label: t.summary ?? t.id,
    sublabel: mapped ? (t.repo ?? t.mode) : `unknown status: ${t.status}`,
    updatedAt: t.updated_at ?? undefined,
    raw: t,
  };
}

export function fromConductor(snap: FleetSnapshot): { nodes: OrchNode[]; edges: OrchEdge[] } {
  if (snap.offline || (snap.runners.length === 0 && snap.tasks.length === 0)) {
    return { nodes: [], edges: [] };
  }
  const nodes: OrchNode[] = [];
  const edges: OrchEdge[] = [];
  const counts: Partial<Record<OrchState, number>> = {};
  const bump = (s: OrchState) => {
    counts[s] = (counts[s] ?? 0) + 1;
  };

  const activeByRunner = new Map<string, FleetTask>();
  for (const t of snap.tasks) {
    if (t.runner && mapHubStatus(t.status) === "running") activeByRunner.set(t.runner, t);
  }

  for (const r of snap.runners) {
    const id = `conductor:runner:${r.id}`;
    const activeTask = activeByRunner.get(r.id);
    const state: OrchState = !r.online
      ? "failed"
      : r.draining
        ? "cancelled"
        : activeTask
          ? "running"
          : "queued";
    bump(state);
    nodes.push({
      id,
      kind: "work",
      source: "conductor",
      state,
      label: r.name,
      sublabel: r.clis.join(", "),
      raw: r,
    });
    edges.push({
      id: `e:source:conductor→${id}`,
      from: "source:conductor",
      to: id,
      kind: "owns",
      active: state === "running",
    });
    if (activeTask) {
      nodes.push(taskNode(activeTask, "activity"));
      edges.push({
        id: `e:${id}→conductor:task:${activeTask.id}`,
        from: id,
        to: `conductor:task:${activeTask.id}`,
        kind: "owns",
        active: true,
      });
    }
  }

  for (const t of snap.tasks) {
    if (t.runner && activeByRunner.get(t.runner)?.id === t.id) continue; // already an activity
    const node = taskNode(t, "work");
    bump(node.state as OrchState);
    nodes.push(node);
    edges.push({
      id: `e:source:conductor→${node.id}`,
      from: "source:conductor",
      to: node.id,
      kind: "owns",
      active: node.state === "running",
    });
  }

  nodes.unshift({
    id: "source:conductor",
    kind: "source",
    source: "conductor",
    label: "Conductor",
    counts,
  });
  return { nodes, edges };
}
