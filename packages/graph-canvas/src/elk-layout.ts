// Pure ELK graph construction for a MappedGraph, and pure extraction of
// computed positions from an ELK layout result. Deliberately free of any
// elkjs import (and any worker/DOM API) so this module can be:
//   - imported directly by a vitest test that runs `new ELK().layout(...)`
//     synchronously in Node (see test/elkLayout.test.ts) - no worker needed
//     there, per the plan;
//   - imported by graph/GraphView.tsx (main webview bundle) to build the
//     ELK input graph without pulling elkjs's bundled solver into the main
//     bundle;
//   - imported by graph/layout.worker.ts, the only module that actually
//     imports elkjs and runs elk.layout(...).
//
// Layout contract (plan, Workstream B / B3 #2):
//   - ELK `layered`, direction RIGHT
//   - one ELK port per handle (flow-in/flow-out/value-in/value-out)
//   - elk.port.side WEST for flow-in then value-in (declaration order),
//     EAST for flow-out then value-out
//   - portConstraints: "FIXED_ORDER"
//   - node width/height estimated from title/subtitle/port-row counts

import type { MappedGraph, MappedNode, MappedPort } from "./map-graph.js";

// --- minimal local ELK JSON types (structurally compatible with elkjs's
// own ElkNode/ElkPort/ElkExtendedEdge, see node_modules/elkjs/lib/elk-api.d.ts,
// but not IMPORTED from elkjs - this module has zero elkjs dependency). -----

export type ElkPort = {
  id: string;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
};

export type ElkNode = {
  id: string;
  width: number;
  height: number;
  ports: ElkPort[];
  layoutOptions?: Record<string, string>;
};

export type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
};

export type ElkGraph = {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
};

/** Layout result shape actually consumed by extractPositions (elk.layout()'s resolved value satisfies this). */
export type ElkLayoutResult = {
  children?: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }>;
};

/**
 * Node-box + row metrics shared with OpNode.tsx so the ELK-estimated box
 * matches the rendered box closely enough that handles line up with edges.
 */
export const NODE_METRICS = {
  headerHeight: 28,
  subtitleHeight: 16,
  rowHeight: 20,
  verticalPadding: 12,
  minWidth: 180,
  maxWidth: 360,
  portSize: 8
} as const;

function formatLiteralForWidth(value: Array<number | boolean | string>): string {
  return value.length === 1 ? String(value[0]) : `[${value.map(String).join(",")}]`;
}

function estimateWidth(node: MappedNode): number {
  const labelLen = node.label.length + (node.knownSpec ? 0 : 12);
  const subtitleLen = node.subtitle?.length ?? 0;
  const longestPortRow = node.ports.reduce((max, p) => {
    const literal = p.kind === "value-in" ? node.literals[p.name] : undefined;
    const literalLen = literal ? ` = ${formatLiteralForWidth(literal.value)}`.length : 0;
    return Math.max(max, p.name.length + (p.type?.length ?? 0) + literalLen + 4);
  }, 0);
  const chars = Math.max(labelLen, subtitleLen, longestPortRow);
  const width = NODE_METRICS.minWidth + chars * 4.5;
  return Math.min(NODE_METRICS.maxWidth, Math.max(NODE_METRICS.minWidth, Math.round(width)));
}

/** Estimated node box, from title/subtitle/port-row counts (per the plan). */
export function estimateNodeSize(node: MappedNode): { width: number; height: number } {
  const westCount = node.ports.filter((p) => p.kind === "flow-in" || p.kind === "value-in").length;
  const eastCount = node.ports.filter((p) => p.kind === "flow-out" || p.kind === "value-out").length;
  const rows = Math.max(westCount, eastCount, 1);
  const height =
    NODE_METRICS.headerHeight +
    (node.subtitle ? NODE_METRICS.subtitleHeight : 0) +
    rows * NODE_METRICS.rowHeight +
    NODE_METRICS.verticalPadding;
  return { width: estimateWidth(node), height };
}

/** WEST-side ports in declaration order: flow-in first, then value-in. */
export function westPorts(node: MappedNode): MappedPort[] {
  return [...node.ports.filter((p) => p.kind === "flow-in"), ...node.ports.filter((p) => p.kind === "value-in")];
}

/** EAST-side ports in declaration order: flow-out first, then value-out. */
export function eastPorts(node: MappedNode): MappedPort[] {
  return [...node.ports.filter((p) => p.kind === "flow-out"), ...node.ports.filter((p) => p.kind === "value-out")];
}

/**
 * Globally-unique ELK port id for a (node index, mapGraph port id) pair.
 * mapGraph port ids (`${kind}:${name}`) are only unique WITHIN a node, and
 * ELK's flat id namespace needs global uniqueness - this is that namespacing,
 * inverted by parsing back out in GraphView when wiring up React Flow handles.
 */
export function elkPortId(nodeIndex: number, portId: string): string {
  return `${nodeIndex}::${portId}`;
}

/** Splits an elkPortId(...) back into its (nodeIndex, mapGraph port id) parts. */
export function parseElkPortId(elkId: string): { nodeIndex: number; portId: string } {
  const sep = elkId.indexOf("::");
  return { nodeIndex: Number(elkId.slice(0, sep)), portId: elkId.slice(sep + 2) };
}

/** Builds the ELK input graph for one MappedGraph, per the layout contract above. */
export function buildElkGraph(graph: MappedGraph): ElkGraph {
  const children: ElkNode[] = graph.nodes.map((node) => {
    const { width, height } = estimateNodeSize(node);
    const west = westPorts(node);
    const east = eastPorts(node);
    const westIds = new Set(west.map((p) => p.id));
    const ordered = [...west, ...east];
    const ports: ElkPort[] = ordered.map((port, index) => ({
      id: elkPortId(node.index, port.id),
      width: NODE_METRICS.portSize,
      height: NODE_METRICS.portSize,
      layoutOptions: {
        "elk.port.side": westIds.has(port.id) ? "WEST" : "EAST",
        "elk.port.index": String(index)
      }
    }));
    return {
      id: String(node.index),
      width,
      height,
      ports,
      layoutOptions: { "elk.portConstraints": "FIXED_ORDER" }
    };
  });

  const edges: ElkEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    sources: [elkPortId(edge.sourceNode, edge.sourcePort)],
    targets: [elkPortId(edge.targetNode, edge.targetPort)]
  }));

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.portConstraints": "FIXED_ORDER",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.spacing.nodeNode": "32",
      "elk.spacing.portPort": "6"
    },
    children,
    edges
  };
}

export type LayoutPositions = Record<number, { x: number; y: number; width: number; height: number }>;

/** Extracts per-node positions from an ELK layout RESULT (children carry x/y/width/height after elk.layout()). */
export function extractPositions(result: ElkLayoutResult): LayoutPositions {
  const out: LayoutPositions = {};
  for (const child of result.children ?? []) {
    const index = Number(child.id);
    if (Number.isNaN(index)) continue;
    out[index] = { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 };
  }
  return out;
}
