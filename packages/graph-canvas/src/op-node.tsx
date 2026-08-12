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

/** Mirrors `@gltf-studio/usage-index`'s identical set (not imported — this package has no dependency on that one; `map-graph.ts`'s own `HANDLER_OPS` documents the same non-import rationale). Card-legibility audit (this task's bullet 3): `animation/start|stop|stopAt` all take a `values.animation` ref literal the card previously showed no resolved name for at all. */
const ANIMATION_OPS: ReadonlySet<string> = new Set(["animation/start", "animation/stop", "animation/stopAt"]);

export type LiteralCommit = (nodeIndex: number, socket: string, type: ValueType, value: Array<number | boolean | string>) => void;

/**
 * Document-level name lookups a bare `MappedGraph` can't carry (mapGraph is
 * pure over the graph object alone, never `document.json` — see
 * `MappedNode.handlerTarget`'s own doc comment in map-graph.ts): scene-node
 * names (indexed by scene-node index, `document.json.nodes[i].name` or a
 * `Node {i}` fallback — `sceneNodeNames.length` is also this card's source
 * of truth for "does this index still exist", i.e. the dangling-reference
 * check) and animation clip names (same convention, `document.json.animations`).
 * Threaded in as one small, optional prop object rather than widening
 * `MappedNode`/`mapGraph`'s own contract — `@gltf-studio/audio-canvas`'s
 * reuse of this same component (specs/ux-graph-canvas.md's M7 implementation
 * note) has no document-level scene/animation concept at all, so this stays
 * entirely optional (omitted there, its `KHR_audio_graph` nodes never set
 * `handlerTarget` anyway).
 */
export type DocNames = { sceneNodeNames: string[]; animationNames: string[] };

export type OpNodeData = {
  node: MappedNode;
  /** Value-in port ids (mapGraph port id, e.g. "value-in:a") that are wired via a value edge — never shown as editable literals. */
  connectedValueInPorts: ReadonlySet<string>;
  diagnostics: GraphDiagnostic[];
  onLiteralCommit: LiteralCommit;
  onPointerTextClick: (nodeIndex: number) => void;
  onPointerIconClick: (nodeIndex: number) => void;
  docNames?: DocNames;
  /** Target chip click (handler nodes only, and only once resolved to a real, non-dangling scene node — see `resolveHandlerTarget` below): selects that scene node, same store action a scene-tree row click makes. */
  onTargetChipClick?: (sceneNodeIndex: number) => void;
};
export type OpNodeType = Node<OpNodeData, "op">;

const MAX_LITERAL_CHARS = 16;

/** Resolves `handlerTarget.nodeIndex` against `sceneNodeNames` into exactly one of three card states — "any node" (the `-1` sentinel, or no config at all), a resolved name+index, or a dangling "missing" index (e.g. its scene node was deleted, DOC-049's "left dangling, not repaired" policy) — the single place this three-way distinction is made so the chip's label/click-ability/styling below can't drift from each other. */
function resolveHandlerTarget(
  nodeIndex: number,
  sceneNodeNames: string[]
): { label: string; missing: boolean; clickIndex: number | null } {
  if (nodeIndex === -1) return { label: "any node", missing: false, clickIndex: null };
  if (nodeIndex < 0 || nodeIndex >= sceneNodeNames.length) {
    return { label: `⚠ missing (#${nodeIndex})`, missing: true, clickIndex: null };
  }
  return { label: `${sceneNodeNames[nodeIndex]} (#${nodeIndex})`, missing: false, clickIndex: nodeIndex };
}

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
  const { node, connectedValueInPorts, diagnostics, onLiteralCommit, onPointerTextClick, onPointerIconClick, docNames, onTargetChipClick } = data;
  const color = categoryColor(node.category);
  const west = westPorts(node);
  const east = eastPorts(node);
  const isPointer = node.category === "pointer";
  const hasDiagnostics = diagnostics.length > 0;
  const worstSeverity = diagnostics.some((d) => d.severity === "error") ? "error" : diagnostics.length > 0 ? "warning" : undefined;

  // Task: "handler nodes show their target" — event/onSelect|onHoverIn|
  // onHoverOut previously rendered NO indication at all of which scene node
  // (`configuration.nodeIndex`) they're scoped to (map-graph.ts's
  // `nodeSubtitle` never handled these ops). `handlerTarget` is set purely
  // from the graph's own config (map-graph.ts); resolving its `nodeIndex`
  // against the document's real scene-node list is this render-time concern.
  const target = node.handlerTarget ? resolveHandlerTarget(node.handlerTarget.nodeIndex, docNames?.sceneNodeNames ?? []) : null;

  // Card-legibility audit (task bullet 3): animation/start|stop|stopAt's
  // `values.animation` ref literal previously had no card row at all — only
  // `node-details.tsx`'s side panel (`AnimationValueEditor`) showed it, and
  // even that only as a raw index once selected. Resolved here the same way
  // `target` above is: a pure literal index (`node.literals.animation`,
  // already computed by mapGraph) resolved against `docNames.animationNames`.
  const animationLiteral = ANIMATION_OPS.has(node.op) ? node.literals.animation : undefined;
  const animationIndex = typeof animationLiteral?.value[0] === "number" ? animationLiteral.value[0] : undefined;
  const animationNames = docNames?.animationNames ?? [];
  const animationLabel =
    animationIndex === undefined
      ? undefined
      : animationIndex < 0 || animationIndex >= animationNames.length
        ? `⚠ missing (#${animationIndex})`
        : `${animationNames[animationIndex]} (#${animationIndex})`;
  const animationMissing = animationIndex !== undefined && (animationIndex < 0 || animationIndex >= animationNames.length);

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
        <div
          className={`gcanvas-op-subtitle${node.subtitleMissing ? " gcanvas-op-subtitle-missing" : ""}`}
          style={{ height: NODE_METRICS.subtitleHeight }}
          title={node.subtitle}
        >
          {node.subtitle}
        </div>
      ) : null}
      {target ? (
        <div className="gcanvas-op-target-row" style={{ height: NODE_METRICS.subtitleHeight }} data-testid={`gcanvas.op-target-row.${node.index}`}>
          <span className="gcanvas-op-target-label">target:</span>
          <button
            type="button"
            className={`gcanvas-target-chip${target.missing ? " gcanvas-target-chip-missing" : ""}${target.clickIndex === null ? " gcanvas-target-chip-inert" : ""}`}
            title={target.clickIndex !== null ? "Select this scene node" : target.label}
            disabled={target.clickIndex === null}
            data-testid={`gcanvas.target-chip.${node.index}`}
            onClick={(e) => {
              e.stopPropagation();
              if (target.clickIndex !== null) onTargetChipClick?.(target.clickIndex);
            }}
          >
            {target.label}
          </button>
          {node.handlerTarget?.stopPropagation ? (
            <span className="gcanvas-stop-propagation-badge" title="Stops event propagation" data-testid={`gcanvas.stop-propagation.${node.index}`}>
              stopPropagation
            </span>
          ) : null}
        </div>
      ) : null}
      {animationLabel ? (
        <div
          className={`gcanvas-op-subtitle${animationMissing ? " gcanvas-op-subtitle-missing" : ""}`}
          style={{ height: NODE_METRICS.subtitleHeight }}
          title={animationLabel}
          data-testid={`gcanvas.op-animation-row.${node.index}`}
        >
          clip: {animationLabel}
        </div>
      ) : null}
      {isPointer ? (
        // M4: unconditional (not gated on `node.subtitle`) — a pointer/*
        // node added blank (e.g. from the palette, which has no path to
        // prefill, unlike the Inspector `◈`/scene-tree drag-drop paths) must
        // still expose the `✎` icon, its only route to ever getting a
        // pointer configured (UX-505's two-click-target contract still
        // holds either way: the placeholder text is a no-op click target
        // when there's nothing to jump to yet, distinct from the icon).
        <div className="gcanvas-op-pointer-row" style={{ height: NODE_METRICS.subtitleHeight }}>
          <button
            type="button"
            className="gcanvas-pointer-text"
            title={node.subtitle ?? "No pointer set yet"}
            data-testid={`gcanvas.pointer-text.${node.index}`}
            onClick={(e) => {
              e.stopPropagation();
              if (node.subtitle) onPointerTextClick(node.index);
            }}
          >
            {node.subtitle ?? "(no pointer set)"}
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
