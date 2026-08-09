// Collapsible details side panel (specs/ux-graph-canvas.md UX-507): selected
// node's category/config/every input+output port with its resolved
// source/target node+port name or an explicit "unconnected"/"literal"
// status — or, when nothing is selected, a graph summary (node/edge/
// variable/event counts) plus any validation diagnostics.
import type { MappedGraph, MappedNode } from "./map-graph.js";
import { categoryColor } from "./palette.js";
import type { GraphDiagnostic } from "./validation.js";

export type NodeDetailsProps = {
  graph: MappedGraph;
  selectedNode: MappedNode | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  diagnosticsByNode: Map<number, GraphDiagnostic[]>;
  unindexedDiagnostics: GraphDiagnostic[];
};

function formatLiteral(value: Array<number | boolean | string>): string {
  return value.length === 1 ? String(value[0]) : `[${value.map(String).join(", ")}]`;
}

function ConfigRows({ node }: { node: MappedNode }) {
  const entries = Object.entries(node.raw.configuration ?? {});
  if (entries.length === 0) return null;
  return (
    <section className="gcanvas-details-section">
      <h3>Configuration</h3>
      <table className="gcanvas-details-table">
        <tbody>
          {entries.map(([key, cfg]) => (
            <tr key={key}>
              <td className="gcanvas-details-key">{key}</td>
              <td className="gcanvas-details-value">{Array.isArray(cfg?.value) ? cfg.value.map(String).join(", ") : String(cfg?.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** UX-507: every port with its resolved source/target node+port, or an explicit "unconnected"/"literal" status. */
function PortStatusRows({ graph, node }: { graph: MappedGraph; node: MappedNode }) {
  function statusFor(port: MappedNode["ports"][number]): string {
    if (port.kind === "value-in") {
      const literal = node.literals[port.name];
      const edge = graph.edges.find((e) => e.kind === "value" && e.targetNode === node.index && e.targetPort === port.id);
      if (edge) return `from node ${edge.sourceNode}.${edge.sourcePort.replace(/^value-out:/, "")}`;
      if (literal) return `literal: ${formatLiteral(literal.value)}`;
      return "unconnected";
    }
    if (port.kind === "flow-in") {
      const edge = graph.edges.find((e) => e.kind === "flow" && e.targetNode === node.index && e.targetPort === port.id);
      return edge ? `from node ${edge.sourceNode}.${edge.sourcePort.replace(/^flow-out:/, "")}` : "unconnected";
    }
    // value-out / flow-out: may fan out to more than one target.
    const prefix = port.kind === "value-out" ? "value" : "flow";
    const targets = graph.edges.filter((e) => e.kind === prefix && e.sourceNode === node.index && e.sourcePort === port.id);
    if (targets.length === 0) return "unconnected";
    return targets.map((e) => `-> node ${e.targetNode}.${e.targetPort.replace(/^(value|flow)-in:/, "")}`).join(", ");
  }

  return (
    <section className="gcanvas-details-section">
      <h3>Ports</h3>
      <table className="gcanvas-details-table">
        <tbody>
          {node.ports.map((port) => (
            <tr key={port.id} data-testid={`gcanvas.details.port.${port.id}`}>
              <td className="gcanvas-details-key">
                {port.name} <span className="gcanvas-details-port-kind">({port.kind})</span>
              </td>
              <td className="gcanvas-details-value">{statusFor(port)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DiagnosticsSection({ diagnostics }: { diagnostics: GraphDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <section className="gcanvas-details-section">
      <h3>Validation</h3>
      <ul className="gcanvas-diagnostic-list">
        {diagnostics.map((d, i) => (
          <li key={i} className={`gcanvas-diagnostic gcanvas-diagnostic-${d.severity}`}>
            <span className="gcanvas-diagnostic-code">{d.code}</span> {d.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GraphSummary({ graph, unindexedDiagnostics }: { graph: MappedGraph; unindexedDiagnostics: GraphDiagnostic[] }) {
  return (
    <div className="gcanvas-details-summary">
      <h3>Graph {graph.graphIndex}</h3>
      <dl>
        <dt>Nodes</dt>
        <dd>{graph.nodeCount}</dd>
        <dt>Edges</dt>
        <dd>{graph.edgeCount}</dd>
        <dt>Variables</dt>
        <dd>{graph.variableCount}</dd>
        <dt>Events</dt>
        <dd>{graph.eventCount}</dd>
      </dl>
      {graph.warnings.length > 0 ? (
        <div className="gcanvas-banner">
          {graph.warnings.length} mapping warning(s):{"\n"}
          {graph.warnings.join("\n")}
        </div>
      ) : (
        <p className="gcanvas-details-hint">Select a node to see its details.</p>
      )}
      <DiagnosticsSection diagnostics={unindexedDiagnostics} />
    </div>
  );
}

export function NodeDetails({ graph, selectedNode, collapsed, onToggleCollapsed, diagnosticsByNode, unindexedDiagnostics }: NodeDetailsProps) {
  if (collapsed) {
    return (
      <button className="gcanvas-details-collapsed" onClick={onToggleCollapsed} title="Show details panel" aria-label="Show details panel">
        {"‹"}
      </button>
    );
  }

  const diagnostics = selectedNode ? (diagnosticsByNode.get(selectedNode.index) ?? []) : [];

  return (
    <aside className="gcanvas-details-panel" data-testid="gcanvas.details">
      <div className="gcanvas-details-header">
        <span>Details</span>
        <button onClick={onToggleCollapsed} title="Collapse details panel" aria-label="Collapse details panel">
          {"›"}
        </button>
      </div>
      <div className="gcanvas-details-body">
        {selectedNode ? (
          <>
            <div className="gcanvas-details-title-row">
              <span className="gcanvas-badge-chip" style={{ background: categoryColor(selectedNode.category) }}>
                {selectedNode.category}
              </span>
              <span className="gcanvas-node-label">{selectedNode.label}</span>
              <span className="gcanvas-node-index">#{selectedNode.index}</span>
            </div>
            <div className="gcanvas-node-op">{selectedNode.op}</div>
            {selectedNode.subtitle ? <div className="gcanvas-subtitle">{selectedNode.subtitle}</div> : null}
            {!selectedNode.knownSpec ? <div className="gcanvas-banner">Unregistered op — not in the kernel registry.</div> : null}
            <ConfigRows node={selectedNode} />
            <PortStatusRows graph={graph} node={selectedNode} />
            <DiagnosticsSection diagnostics={diagnostics} />
          </>
        ) : (
          <GraphSummary graph={graph} unindexedDiagnostics={unindexedDiagnostics} />
        )}
      </div>
    </aside>
  );
}
