// Custom React Flow node for a mapped KHR_interactivity graph node
// (specs/ux-graph-canvas.md UX-503..506): header (op tail + category
// badge), subtitle row, one row per port with a named Handle (id === the
// mapGraph port id, so it matches MappedEdge.sourcePort/targetPort exactly —
// see graph-view.tsx), inline literal editing for unconnected scalar-typed
// value-in ports, flow ports visually distinct from value ports (triangle vs
// colored dot; value handles colored by resolved type), a pointer-category
// config row with two independent click targets (UX-505/UX-508), and a
// corner validation badge with a hover/focus tooltip (UX-506).
import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { MappedNode, MappedPort } from "./map-graph.js";
import { categoryColor, typeColor } from "./palette.js";
import { NODE_METRICS, eastPorts, westPorts } from "./elk-layout.js";
import type { GraphDiagnostic } from "./validation.js";
import type { ValueType } from "@gltfi/kernel";

const EDITABLE_SCALAR_TYPES: ReadonlySet<string> = new Set(["bool", "int", "float"]);

export type LiteralCommit = (nodeIndex: number, socket: string, type: ValueType, value: Array<number | boolean | string>) => void;

export type OpNodeData = {
  node: MappedNode;
  /** Value-in port ids (mapGraph port id, e.g. "value-in:a") that are wired via a value edge — never shown as editable literals. */
  connectedValueInPorts: ReadonlySet<string>;
  diagnostics: GraphDiagnostic[];
  onLiteralCommit: LiteralCommit;
  onPointerTextClick: (nodeIndex: number) => void;
  onPointerIconClick: (nodeIndex: number) => void;
};
export type OpNodeType = Node<OpNodeData, "op">;

const MAX_LITERAL_CHARS = 16;

function formatLiteral(value: Array<number | boolean | string>): string {
  const text = value.length === 1 ? String(value[0]) : `[${value.map(String).join(", ")}]`;
  return text.length > MAX_LITERAL_CHARS ? `${text.slice(0, MAX_LITERAL_CHARS - 1)}…` : text;
}

function LiteralInput({
  node,
  port,
  onCommit
}: {
  node: MappedNode;
  port: MappedPort;
  onCommit: (type: ValueType, value: Array<number | boolean | string>) => void;
}) {
  const literal = node.literals[port.name];
  const type = port.type as ValueType;
  const initial = literal?.value[0];
  const [text, setText] = useState<string>(() => (initial === undefined ? "" : String(initial)));

  if (type === "bool") {
    const checked = initial === true || initial === "true";
    return (
      <input
        type="checkbox"
        className="gcanvas-literal-input gcanvas-literal-bool"
        checked={checked}
        onChange={(e) => onCommit("bool", [e.target.checked])}
        onClick={(e) => e.stopPropagation()}
        data-testid={`gcanvas.literal.${node.index}.${port.name}`}
      />
    );
  }
  return (
    <input
      type="number"
      className="gcanvas-literal-input"
      value={text}
      step={type === "int" ? 1 : "any"}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text);
        if (Number.isFinite(n)) {
          onCommit(type, [type === "int" ? Math.trunc(n) : n]);
        }
      }}
      data-testid={`gcanvas.literal.${node.index}.${port.name}`}
    />
  );
}

function PortRow({
  port,
  node,
  side,
  connected,
  onLiteralCommit
}: {
  port: MappedPort;
  node: MappedNode;
  side: "west" | "east";
  connected: boolean;
  onLiteralCommit: LiteralCommit;
}) {
  const isFlow = port.kind === "flow-in" || port.kind === "flow-out";
  const literal = port.kind === "value-in" ? node.literals[port.name] : undefined;
  const handleKind = port.kind === "flow-in" || port.kind === "value-in" ? "target" : "source";
  const position = side === "west" ? Position.Left : Position.Right;
  const dotColor = isFlow ? "var(--gcanvas-flow-color, #e0a458)" : typeColor(port.type);
  const editable = port.kind === "value-in" && !connected && port.type !== undefined && EDITABLE_SCALAR_TYPES.has(port.type);

  const nameSpan = (
    <span className="gcanvas-port-name" title={port.name}>
      {port.name}
    </span>
  );
  const literalOrEditor = editable ? (
    <LiteralInput node={node} port={port} onCommit={(type, value) => onLiteralCommit(node.index, port.name, type, value)} />
  ) : literal ? (
    <span className="gcanvas-port-literal" title={formatLiteral(literal.value)}>
      {`= ${formatLiteral(literal.value)}`}
    </span>
  ) : null;
  const typeSpan = port.type ? <span className="gcanvas-port-type">{port.type}</span> : null;

  return (
    <div className={`gcanvas-op-row gcanvas-op-row-${side}`} style={{ minHeight: NODE_METRICS.rowHeight }}>
      <Handle
        id={port.id}
        type={handleKind}
        position={position}
        isConnectable
        className={`gcanvas-handle ${isFlow ? "gcanvas-handle-flow" : "gcanvas-handle-value"}`}
        style={{ background: isFlow ? dotColor : "var(--bg-0, #1e1e1e)", borderColor: dotColor }}
        data-testid={`gcanvas.handle.${node.index}.${port.id}`}
      />
      {side === "west" ? (
        <>
          {nameSpan}
          {literalOrEditor}
          {typeSpan}
        </>
      ) : (
        <>
          {typeSpan}
          {literalOrEditor}
          {nameSpan}
        </>
      )}
    </div>
  );
}

export function OpNode({ data, selected }: NodeProps<OpNodeType>) {
  const { node, connectedValueInPorts, diagnostics, onLiteralCommit, onPointerTextClick, onPointerIconClick } = data;
  const color = categoryColor(node.category);
  const west = westPorts(node);
  const east = eastPorts(node);
  const isPointer = node.category === "pointer";
  const hasDiagnostics = diagnostics.length > 0;
  const worstSeverity = diagnostics.some((d) => d.severity === "error") ? "error" : diagnostics.length > 0 ? "warning" : undefined;

  return (
    <div
      className={`gcanvas-op-node${selected ? " gcanvas-op-node-selected" : ""}${node.knownSpec ? "" : " gcanvas-op-node-unknown"}`}
      style={{ borderLeftColor: color }}
      data-testid={`gcanvas.node.${node.index}`}
    >
      {hasDiagnostics ? (
        <span
          className={`gcanvas-badge gcanvas-badge-${worstSeverity}`}
          tabIndex={0}
          role="status"
          title={diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n")}
          data-testid={`gcanvas.badge.${node.index}`}
        >
          !
        </span>
      ) : null}
      <div className="gcanvas-op-header" style={{ height: NODE_METRICS.headerHeight }}>
        <span className="gcanvas-op-badge" style={{ background: color }}>
          {node.category}
        </span>
        <span className="gcanvas-op-label" title={node.op}>
          {node.label}
        </span>
        <span className="gcanvas-op-index">#{node.index}</span>
      </div>
      {node.subtitle && !isPointer ? (
        <div className="gcanvas-op-subtitle" style={{ height: NODE_METRICS.subtitleHeight }} title={node.subtitle}>
          {node.subtitle}
        </div>
      ) : null}
      {node.subtitle && isPointer ? (
        <div className="gcanvas-op-pointer-row" style={{ height: NODE_METRICS.subtitleHeight }}>
          <button
            type="button"
            className="gcanvas-pointer-text"
            title={node.subtitle}
            data-testid={`gcanvas.pointer-text.${node.index}`}
            onClick={(e) => {
              e.stopPropagation();
              onPointerTextClick(node.index);
            }}
          >
            {node.subtitle}
          </button>
          <button
            type="button"
            className="gcanvas-pointer-icon"
            title="Retarget pointer"
            aria-label="Retarget pointer"
            data-testid={`gcanvas.pointer-icon.${node.index}`}
            onClick={(e) => {
              e.stopPropagation();
              onPointerIconClick(node.index);
            }}
          >
            ✎
          </button>
        </div>
      ) : null}
      <div className="gcanvas-op-body">
        <div className="gcanvas-op-col gcanvas-op-col-west">
          {west.map((port) => (
            <PortRow
              key={port.id}
              port={port}
              node={node}
              side="west"
              connected={connectedValueInPorts.has(port.id)}
              onLiteralCommit={onLiteralCommit}
            />
          ))}
        </div>
        <div className="gcanvas-op-col gcanvas-op-col-east">
          {east.map((port) => (
            <PortRow key={port.id} port={port} node={node} side="east" connected={false} onLiteralCommit={onLiteralCommit} />
          ))}
        </div>
      </div>
      {!node.knownSpec ? <div className="gcanvas-op-unknown-badge">unregistered op</div> : null}
    </div>
  );
}
