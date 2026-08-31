/** OrchSnapshot → @xyflow nodes/edges with a deterministic shallow 3-layer layout. Pure. */
import type { Edge, Node } from "@xyflow/react";
import { edgeStyle } from "@/shared/components/flow/edgeStyles";
import type { OrchNodeKind, OrchSnapshot } from "./orchestrationTypes";

const LAYER_Y: Record<OrchNodeKind, number> = {
  orchestrator: 0,
  source: 150,
  work: 320,
  overflow: 320,
  activity: 470,
};
const X_GAP = 260;

export function orchestrationToFlow(snap: OrchSnapshot): {
  nodes: Node[];
  edges: Edge[];
  fitKey: string;
} {
  const byLayer = new Map<number, string[]>();
  for (const n of [...snap.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const y = LAYER_Y[n.kind];
    const ids = byLayer.get(y) ?? [];
    ids.push(n.id);
    byLayer.set(y, ids);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [y, ids] of byLayer) {
    const width = (ids.length - 1) * X_GAP;
    ids.forEach((id, i) => pos.set(id, { x: i * X_GAP - width / 2, y }));
  }

  const stateOf = new Map(snap.nodes.map((n) => [n.id, n.state]));
  const nodes: Node[] = snap.nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: pos.get(n.id)!,
    data: n as unknown as Record<string, unknown>,
  }));
  const edges: Edge[] = snap.edges.map((e) => {
    const target = stateOf.get(e.to);
    const style = edgeStyle(e.active, false, target === "failed", target === "succeeded");
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      animated: e.active,
      style: e.kind === "mirror" ? { ...style, strokeDasharray: "6 4" } : style,
    };
  });

  const fitKey = snap.nodes
    .filter((n) => n.kind === "work")
    .map((n) => n.id)
    .sort()
    .join("|");
  return { nodes, edges, fitKey };
}
