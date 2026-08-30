/** Merge the three source mappers into one snapshot: root, dedupe, staleness filter, cap. Pure. */
import {
  MAX_WORK_NODES,
  STALE_COMPLETED_MS,
  type OrchEdge,
  type OrchNode,
  type OrchSnapshot,
  type OrchSource,
  type OrchState,
  type SourceStatus,
} from "./orchestrationTypes";

const TERMINAL: ReadonlySet<OrchState> = new Set(["succeeded", "failed", "cancelled"]);

export interface MergeOptions {
  now: number;
  showCompleted?: boolean;
}

interface Part {
  nodes: OrchNode[];
  edges: OrchEdge[];
}

function conductorMirrorId(node: OrchNode): string | null {
  const raw = node.raw as { metadata?: { conductor?: { task_id?: unknown } } } | undefined;
  const id = raw?.metadata?.conductor?.task_id;
  return typeof id === "string" ? id : null;
}

export function mergeSnapshot(
  parts: { cloudAgent: Part; a2a: Part; conductor: Part },
  sources: SourceStatus[],
  opts: MergeOptions
): OrchSnapshot {
  let nodes: OrchNode[] = [...parts.cloudAgent.nodes, ...parts.a2a.nodes, ...parts.conductor.nodes];
  let edges: OrchEdge[] = [...parts.cloudAgent.edges, ...parts.a2a.edges, ...parts.conductor.edges];

  // (2) Conductor↔A2A dedupe — key verified in src/lib/conductor/bridge.ts::ensureMirrored.
  const conductorTaskIds = new Set(
    nodes
      .filter((n) => n.source === "conductor" && n.id.startsWith("conductor:task:"))
      .map((n) => n.id.slice("conductor:task:".length))
  );
  const dropped = new Set<string>();
  for (const n of nodes) {
    if (n.source !== "a2a" || n.kind !== "work") continue;
    const mirror = conductorMirrorId(n);
    if (mirror && conductorTaskIds.has(mirror)) {
      dropped.add(n.id);
      const cNode = nodes.find((c) => c.id === `conductor:task:${mirror}`);
      if (cNode) {
        cNode.mirrorOf = n.id;
        edges.push({
          id: `e:mirror:${cNode.id}`,
          from: cNode.id,
          to: "source:a2a",
          kind: "mirror",
          active: false,
        });
      }
    }
  }

  // (3) staleness filter
  if (!opts.showCompleted) {
    for (const n of nodes) {
      if (n.kind !== "work" && n.kind !== "activity") continue;
      if (
        n.state &&
        TERMINAL.has(n.state) &&
        n.endedAt &&
        opts.now - Date.parse(n.endedAt) > STALE_COMPLETED_MS
      ) {
        dropped.add(n.id);
      }
    }
  }
  nodes = nodes.filter((n) => !dropped.has(n.id));
  edges = edges.filter((e) => !dropped.has(e.from) && !dropped.has(e.to));

  // (4) cap with per-source overflow, newest kept
  const works = nodes.filter((n) => n.kind === "work");
  if (works.length > MAX_WORK_NODES) {
    const bySource = new Map<OrchSource, OrchNode[]>();
    for (const w of works) {
      const list = bySource.get(w.source as OrchSource) ?? [];
      list.push(w);
      bySource.set(w.source as OrchSource, list);
    }
    const budgetPer = Math.max(1, Math.floor(MAX_WORK_NODES / bySource.size));
    const overflowNodes: OrchNode[] = [];
    for (const [source, list] of bySource) {
      if (list.length <= budgetPer) continue;
      list.sort((a, b) => Date.parse(b.updatedAt ?? "0") - Date.parse(a.updatedAt ?? "0"));
      const excess = list.slice(budgetPer);
      const counts: Partial<Record<OrchState, number>> = {};
      for (const n of excess) {
        dropped.add(n.id);
        if (n.state) counts[n.state] = (counts[n.state] ?? 0) + 1;
      }
      overflowNodes.push({
        id: `overflow:${source}`,
        kind: "overflow",
        source,
        label: `+${excess.length} more`,
        counts,
      });
    }
    nodes = nodes.filter((n) => !dropped.has(n.id)).concat(overflowNodes);
    edges = edges.filter((e) => !dropped.has(e.from) && !dropped.has(e.to));
    for (const o of overflowNodes) {
      edges.push({
        id: `e:source:${o.source}→${o.id}`,
        from: `source:${o.source}`,
        to: o.id,
        kind: "owns",
        active: false,
      });
    }
  }

  // (1) root — link every present SourceNode, plus failed sources so the UI can show them stale
  const root: OrchNode = { id: "orchestrator", kind: "orchestrator", label: "OmniRoute" };
  const sourceIds = new Set(nodes.filter((n) => n.kind === "source").map((n) => n.id));
  for (const s of sources) {
    if (!s.ok && !sourceIds.has(`source:${s.source}`) && s.source !== "routing") {
      nodes.push({
        id: `source:${s.source}`,
        kind: "source",
        source: s.source,
        label: s.source,
        sublabel: s.offline ? "offline" : "error",
      });
      sourceIds.add(`source:${s.source}`);
    }
  }
  for (const id of sourceIds) {
    edges.push({
      id: `e:orchestrator→${id}`,
      from: "orchestrator",
      to: id,
      kind: "owns",
      active: false,
    });
  }

  return { nodes: [root, ...nodes], edges, sources, generatedAt: new Date(opts.now).toISOString() };
}
