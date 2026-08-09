// Collapsible details side panel (specs/ux-graph-canvas.md UX-507): selected
// node's category/config/every input+output port with its resolved
// source/target node+port name or an explicit "unconnected"/"literal"
// status — or, when nothing is selected, a graph summary (node/edge/
// variable/event counts) plus any validation diagnostics.
//
// M4's config-field editor (PR #9's gap) lives here too, as `ConfigEditor`:
// variable/event dropdown selectors (+ "new…" flows), a pointer node's
// "Retarget…" button (routes through the SAME pointer-picker dialog the
// canvas node's own `✎` icon opens — one editing surface, not two), an
// animation index selector for animation/start|stop's `values.animation`
// (a VALUE, not a `configuration` field, but grouped here since the config
// editor is the natural place a user looks for it), and a generic
// key/value fallback (inferred from the current value's JS type) for every
// other op's config fields this doesn't special-case.
import { useState } from "react";
import type { ValueType } from "@gltfi/kernel";
import type { InteractivityEvent, InteractivityVariable, MappedGraph, MappedNode } from "./map-graph.js";
import { categoryColor } from "./palette.js";
import type { GraphDiagnostic } from "./validation.js";

const VARIABLE_TYPE_OPTIONS: ValueType[] = ["bool", "int", "float", "float2", "float3", "float4"];

export type NodeDetailsProps = {
  graph: MappedGraph;
  selectedNode: MappedNode | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  diagnosticsByNode: Map<number, GraphDiagnostic[]>;
  unindexedDiagnostics: GraphDiagnostic[];
  /** Declared variables/events for this graph, for the config editor's dropdowns (empty arrays are fine — just "+ New…" then). */
  variables?: InteractivityVariable[];
  events?: InteractivityEvent[];
  /** `document.json.animations[].name` (or a `"Animation {i}"` fallback), for animation/start|stop's index selector. */
  animationNames?: string[];
  onSetConfigField?: (nodeIndex: number, field: string, value: Array<number | boolean | string>) => void;
  onAddVariableAndSetConfig?: (nodeIndex: number, field: string, id: string, signature: ValueType, arraySlot?: number) => void;
  onSetEventConfig?: (nodeIndex: number, eventIndex: number) => void;
  onAddEventAndSetConfig?: (nodeIndex: number, id: string) => void;
  onSetAnimationValue?: (nodeIndex: number, animationIndex: number) => void;
  onOpenPointerPicker?: (nodeIndex: number) => void;
};

function formatLiteral(value: Array<number | boolean | string>): string {
  return value.length === 1 ? String(value[0]) : `[${value.map(String).join(", ")}]`;
}

const NEW_OPTION = "__new__";
const NONE_OPTION = "__none__";

/** A labeled `<select>` (+ inline "new…" mini-form) shared by the variable and event selectors below — they differ only in their option list and what "new" means. */
function DeclarationSelect({
  testIdBase,
  options,
  currentIndex,
  onSelect,
  onCreate,
  newFormLabel,
  showTypeSelector = false
}: {
  testIdBase: string;
  options: Array<{ index: number; label: string }>;
  currentIndex: number | undefined;
  onSelect: (index: number) => void;
  onCreate?: (id: string, signature?: ValueType) => void;
  newFormLabel: string;
  showTypeSelector?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newType, setNewType] = useState<ValueType>("float");

  if (creating) {
    return (
      <div className="gcanvas-config-new-row">
        <input
          className="gcanvas-config-input"
          placeholder="name"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          data-testid={`${testIdBase}.new-id`}
        />
        {showTypeSelector ? (
          <select className="gcanvas-config-input" value={newType} onChange={(e) => setNewType(e.target.value as ValueType)} data-testid={`${testIdBase}.new-type`}>
            {VARIABLE_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="btn small"
          data-testid={`${testIdBase}.new-confirm`}
          disabled={newId.trim().length === 0}
          onClick={() => {
            if (newId.trim().length === 0) return;
            onCreate?.(newId.trim(), newType);
            setCreating(false);
            setNewId("");
          }}
        >
          Add
        </button>
        <button type="button" className="btn small" data-testid={`${testIdBase}.new-cancel`} onClick={() => setCreating(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      className="gcanvas-config-input"
      value={currentIndex ?? NONE_OPTION}
      onChange={(e) => {
        if (e.target.value === NEW_OPTION) {
          setCreating(true);
        } else if (e.target.value !== NONE_OPTION) {
          onSelect(Number(e.target.value));
        }
      }}
      data-testid={testIdBase}
    >
      {/* Distinct from NEW_OPTION so this placeholder is never mistaken for "create new" — selecting it (or leaving it as the default) is a no-op, not an action. */}
      {currentIndex === undefined ? (
        <option value={NONE_OPTION} disabled>
          —
        </option>
      ) : null}
      {options.map((o) => (
        <option key={o.index} value={o.index}>
          {o.label}
        </option>
      ))}
      <option value={NEW_OPTION}>{newFormLabel}</option>
    </select>
  );
}

function GenericConfigField({
  field,
  value,
  onCommit
}: {
  field: string;
  value: { value?: Array<number | boolean | string> } | undefined;
  onCommit: (next: Array<number | boolean | string>) => void;
}) {
  const raw = value?.value?.[0];
  const [text, setText] = useState(() => (raw === undefined ? "" : String(raw)));

  if (typeof raw === "boolean") {
    return (
      <input
        type="checkbox"
        checked={raw}
        onChange={(e) => onCommit([e.target.checked])}
        data-testid={`gcanvas.details.config.${field}`}
      />
    );
  }
  if (typeof raw === "number") {
    return (
      <input
        type="number"
        className="gcanvas-config-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (Number.isFinite(n)) onCommit([n]);
        }}
        data-testid={`gcanvas.details.config.${field}`}
      />
    );
  }
  return (
    <input
      type="text"
      className="gcanvas-config-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit([text])}
      data-testid={`gcanvas.details.config.${field}`}
    />
  );
}

const VARIABLE_OPS = new Set(["variable/get", "variable/interpolate"]);
const EVENT_OPS = new Set(["event/send", "event/receive"]);
const POINTER_OPS = new Set(["pointer/get", "pointer/set", "pointer/interpolate"]);
const ANIMATION_OPS = new Set(["animation/start", "animation/stop"]);

function ConfigEditor({
  node,
  variables,
  events,
  onSetConfigField,
  onAddVariableAndSetConfig,
  onSetEventConfig,
  onAddEventAndSetConfig,
  onOpenPointerPicker
}: {
  node: MappedNode;
  variables: InteractivityVariable[];
  events: InteractivityEvent[];
  onSetConfigField?: NodeDetailsProps["onSetConfigField"];
  onAddVariableAndSetConfig?: NodeDetailsProps["onAddVariableAndSetConfig"];
  onSetEventConfig?: NodeDetailsProps["onSetEventConfig"];
  onAddEventAndSetConfig?: NodeDetailsProps["onAddEventAndSetConfig"];
  onOpenPointerPicker?: NodeDetailsProps["onOpenPointerPicker"];
}) {
  const raw = node.raw.configuration ?? {};
  // A blank node (e.g. added from the palette, which has no config to
  // prefill — unlike a drag-drop/Inspector-created node) has NO
  // `configuration` object yet at all, but its op still HAS a config field
  // the selector below needs to render (same problem UX-505's op-node.tsx
  // fix solves for the pointer icon) — so the row set to render is this
  // op's own known special fields UNION whatever raw fields already exist
  // (covering the generic fallback for every other op), not just
  // `Object.keys(raw)` alone.
  const specialFields = VARIABLE_OPS.has(node.op)
    ? ["variable"]
    : node.op === "variable/set"
      ? ["variables"]
      : EVENT_OPS.has(node.op)
        ? ["event"]
        : POINTER_OPS.has(node.op)
          ? ["pointer", "type"]
          : [];
  const keys = Array.from(new Set([...specialFields, ...Object.keys(raw)]));
  if (keys.length === 0) return null;

  const variableOptions = variables.map((v, i) => ({ index: i, label: v.id ?? `var#${i}` }));
  const eventOptions = events.map((e, i) => ({ index: i, label: e.id ?? `event#${i}` }));

  return (
    <section className="gcanvas-details-section">
      <h3>Configuration</h3>
      <table className="gcanvas-details-table">
        <tbody>
          {keys.map((key) => {
            const cfg = raw[key];
            const currentValue = Array.isArray(cfg?.value) ? (cfg.value[0] as number | undefined) : undefined;

            if (VARIABLE_OPS.has(node.op) && key === "variable" && onAddVariableAndSetConfig) {
              return (
                <tr key={key}>
                  <td className="gcanvas-details-key">{key}</td>
                  <td className="gcanvas-details-value">
                    <DeclarationSelect
                      testIdBase={`gcanvas.details.config.variable-select.${node.index}`}
                      options={variableOptions}
                      currentIndex={currentValue}
                      onSelect={(i) => onSetConfigField?.(node.index, "variable", [i])}
                      onCreate={(id, signature) => onAddVariableAndSetConfig(node.index, "variable", id, signature ?? "float")}
                      newFormLabel="+ New variable…"
                      showTypeSelector
                    />
                  </td>
                </tr>
              );
            }
            if (node.op === "variable/set" && key === "variables" && onAddVariableAndSetConfig) {
              const arr = Array.isArray(cfg?.value) ? (cfg.value as number[]) : [];
              return (
                <tr key={key}>
                  <td className="gcanvas-details-key">{key} [0]</td>
                  <td className="gcanvas-details-value">
                    <DeclarationSelect
                      testIdBase={`gcanvas.details.config.variable-select.${node.index}`}
                      options={variableOptions}
                      currentIndex={arr[0]}
                      onSelect={(i) => {
                        const next = arr.slice();
                        next[0] = i;
                        onSetConfigField?.(node.index, "variables", next);
                      }}
                      onCreate={(id, signature) => onAddVariableAndSetConfig(node.index, "variables", id, signature ?? "float", 0)}
                      newFormLabel="+ New variable…"
                      showTypeSelector
                    />
                    {arr.length > 1 ? <span className="dim gcanvas-config-note"> (+{arr.length - 1} more slot(s) — edit slot 0 only here)</span> : null}
                  </td>
                </tr>
              );
            }
            if (EVENT_OPS.has(node.op) && key === "event" && onAddEventAndSetConfig) {
              return (
                <tr key={key}>
                  <td className="gcanvas-details-key">{key}</td>
                  <td className="gcanvas-details-value">
                    <DeclarationSelect
                      testIdBase={`gcanvas.details.config.event-select.${node.index}`}
                      options={eventOptions}
                      currentIndex={currentValue}
                      onSelect={(i) => onSetEventConfig?.(node.index, i)}
                      onCreate={(id) => onAddEventAndSetConfig(node.index, id)}
                      newFormLabel="+ New event…"
                    />
                  </td>
                </tr>
              );
            }
            if (POINTER_OPS.has(node.op) && key === "pointer") {
              return (
                <tr key={key}>
                  <td className="gcanvas-details-key">{key}</td>
                  <td className="gcanvas-details-value">
                    <span className="mono">{String(cfg?.value?.[0] ?? "")}</span>
                    {onOpenPointerPicker ? (
                      <button
                        type="button"
                        className="btn small"
                        data-testid={`gcanvas.details.config.retarget.${node.index}`}
                        onClick={() => onOpenPointerPicker(node.index)}
                      >
                        Retarget…
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            }
            if (POINTER_OPS.has(node.op) && key === "type") {
              // Raw `types[]` index — edited only via the pointer picker (above), never typed directly (an arbitrary index could point at any signature).
              return (
                <tr key={key}>
                  <td className="gcanvas-details-key">{key}</td>
                  <td className="gcanvas-details-value dim">{cfg?.value?.[0] !== undefined ? String(cfg.value[0]) : "—"}</td>
                </tr>
              );
            }

            // Generic key/value fallback.
            return (
              <tr key={key}>
                <td className="gcanvas-details-key">{key}</td>
                <td className="gcanvas-details-value">
                  {onSetConfigField ? (
                    <GenericConfigField field={key} value={cfg} onCommit={(next) => onSetConfigField(node.index, key, next)} />
                  ) : (
                    <span>{Array.isArray(cfg?.value) ? cfg.value.map(String).join(", ") : String(cfg?.value)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** animation/start|stop's "animation" socket is a `values` entry (ref-typed literal), not a `configuration` field — grouped with the config editor anyway since that's where a user looks for "which clip does this node target". */
function AnimationValueEditor({ node, animationNames, onSetAnimationValue }: { node: MappedNode; animationNames: string[]; onSetAnimationValue?: NodeDetailsProps["onSetAnimationValue"] }) {
  if (!ANIMATION_OPS.has(node.op) || !onSetAnimationValue) return null;
  const literal = node.literals.animation;
  const currentIndex = literal?.value[0] as number | undefined;
  return (
    <section className="gcanvas-details-section">
      <h3>Animation</h3>
      <table className="gcanvas-details-table">
        <tbody>
          <tr>
            <td className="gcanvas-details-key">animation</td>
            <td className="gcanvas-details-value">
              <select
                className="gcanvas-config-input"
                value={currentIndex ?? ""}
                onChange={(e) => onSetAnimationValue(node.index, Number(e.target.value))}
                data-testid={`gcanvas.details.config.animation-select.${node.index}`}
              >
                <option value="" disabled>
                  Select a clip…
                </option>
                {animationNames.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </td>
          </tr>
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

export function NodeDetails({
  graph,
  selectedNode,
  collapsed,
  onToggleCollapsed,
  diagnosticsByNode,
  unindexedDiagnostics,
  variables = [],
  events = [],
  animationNames = [],
  onSetConfigField,
  onAddVariableAndSetConfig,
  onSetEventConfig,
  onAddEventAndSetConfig,
  onSetAnimationValue,
  onOpenPointerPicker
}: NodeDetailsProps) {
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
            <ConfigEditor
              node={selectedNode}
              variables={variables}
              events={events}
              onSetConfigField={onSetConfigField}
              onAddVariableAndSetConfig={onAddVariableAndSetConfig}
              onSetEventConfig={onSetEventConfig}
              onAddEventAndSetConfig={onAddEventAndSetConfig}
              onOpenPointerPicker={onOpenPointerPicker}
            />
            <AnimationValueEditor node={selectedNode} animationNames={animationNames} onSetAnimationValue={onSetAnimationValue} />
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
