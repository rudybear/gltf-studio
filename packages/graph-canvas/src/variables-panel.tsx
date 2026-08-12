// Variables panel (task: "in the node graph there is no way to edit
// variables" — specs/ux-graph-canvas.md UX-5xx): a collapsible dock panel
// listing every declared `graph.variables[]` entry — inline-editable name,
// a type dropdown, a TYPED default-value editor (reusing `literal-editors.ts`'s
// `TypedLiteralEditor`, same component B's graph-literal editing uses —
// always with `colorKind` omitted here: a variable has no pointer PATH to
// resolve a color property against, unlike a `pointer/set|interpolate`
// node's literal socket, so every vector default renders as plain grouped
// numeric fields, never a color picker), a usage count, and a delete
// button — plus a parallel (smaller: no type/default) section for custom
// events. "+ Add variable"/"+ Add event" append a fresh declaration.
//
// Pure presentation + local editing state; every actual document mutation
// is a callback prop `graph-canvas.tsx` wires to `GraphEdit`'s variable/event
// factories (DOC-055), same "one module calls the command factories"
// convention that file's own header comment establishes for the rest of
// this package.
import { useState } from "react";
import type { InteractivityEvent, InteractivityVariable } from "./map-graph.js";
import { TypedLiteralEditor, type LiteralValue } from "./literal-editors.js";

/** Mirrors `node-details.tsx`'s own identical `VARIABLE_TYPE_OPTIONS` list (that one seeds a FRESH variable's "+ New variable..." type picker; this one retypes an EXISTING one) — not imported, since importing a private const across files this small isn't worth the coupling; keep both in sync if the picker vocabulary ever grows. */
const VARIABLE_TYPE_OPTIONS = ["bool", "int", "float", "float2", "float3", "float4"] as const;

export type VariablesPanelProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  variables: InteractivityVariable[];
  events: InteractivityEvent[];
  types: Array<{ signature: string }>;
  /** `variableUsageCounts[i]` = number of DISTINCT graph nodes referencing `variables[i]` (`GraphEdit.countVariableUsage`) — drives both the displayed count and whether the delete button is enabled. */
  variableUsageCounts: number[];
  eventUsageCounts: number[];
  onAddVariable: () => void;
  onRenameVariable: (index: number, id: string) => void;
  onSetVariableType: (index: number, signature: string) => void;
  onSetVariableDefault: (index: number, value: LiteralValue) => void;
  onRemoveVariable: (index: number) => void;
  onAddEvent: () => void;
  onRenameEvent: (index: number, id: string) => void;
  onRemoveEvent: (index: number) => void;
  /** Optional (task: "wire selection/usage to the existing usage-index if cheap... optional, note if skipped"): clicking a variable/event row highlights its get/set/send/receive nodes on the canvas. Omitted -> row click is inert (still fully editable via its own controls either way). */
  onSelectVariable?: (index: number) => void;
  onSelectEvent?: (index: number) => void;
};

function IdField({ value, onCommit, testId }: { value: string; onCommit: (next: string) => void; testId: string }): JSX.Element {
  const [text, setText] = useState(value);
  return (
    <input
      type="text"
      className="gcanvas-config-input gcanvas-variables-name"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const trimmed = text.trim();
        if (trimmed.length > 0 && trimmed !== value) onCommit(trimmed);
        else setText(value); // empty/unchanged -- revert the input to the last real value rather than committing a blank id.
      }}
      data-testid={testId}
    />
  );
}

function VariableRow({
  variable,
  index,
  types,
  usageCount,
  onRename,
  onSetType,
  onSetDefault,
  onRemove,
  onSelect
}: {
  variable: InteractivityVariable;
  index: number;
  types: Array<{ signature: string }>;
  usageCount: number;
  onRename: (id: string) => void;
  onSetType: (signature: string) => void;
  onSetDefault: (value: LiteralValue) => void;
  onRemove: () => void;
  onSelect?: () => void;
}): JSX.Element {
  const signature = types[variable.type]?.signature ?? "float";
  const inUse = usageCount > 0;
  return (
    <tr className="gcanvas-variables-row" data-testid={`gcanvas.variables.row.${index}`}>
      <td>
        <IdField value={variable.id ?? `var#${index}`} onCommit={onRename} testId={`gcanvas.variables.name.${index}`} />
      </td>
      <td>
        <select
          className="gcanvas-config-input"
          value={signature}
          onChange={(e) => onSetType(e.target.value)}
          data-testid={`gcanvas.variables.type.${index}`}
        >
          {VARIABLE_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {!VARIABLE_TYPE_OPTIONS.includes(signature as (typeof VARIABLE_TYPE_OPTIONS)[number]) ? (
            <option value={signature}>{signature}</option>
          ) : null}
        </select>
      </td>
      <td data-testid={`gcanvas.variables.default.${index}`}>
        {/* `key` remounts the editor (and its own local text-buffer state) on a type change — a stale "x/y/z" buffer from a just-retyped float3 field must not leak into a fresh bool checkbox. */}
        <TypedLiteralEditor
          key={signature}
          type={signature}
          value={variable.value ?? []}
          onCommit={onSetDefault}
          testIdBase={`gcanvas.variables.default.${index}.editor`}
        />
      </td>
      <td className="gcanvas-variables-usage" data-testid={`gcanvas.variables.usage.${index}`}>
        <button
          type="button"
          className="gcanvas-variables-usage-btn"
          disabled={!onSelect || usageCount === 0}
          title={onSelect ? "Select referencing nodes" : undefined}
          onClick={onSelect}
        >
          {usageCount}
        </button>
      </td>
      <td>
        <button
          type="button"
          className="btn small gcanvas-variables-delete"
          disabled={inUse}
          title={inUse ? `Used by ${usageCount} node${usageCount === 1 ? "" : "s"} — remove those references first` : "Delete variable"}
          data-testid={`gcanvas.variables.delete.${index}`}
          onClick={onRemove}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function EventRow({
  event,
  index,
  usageCount,
  onRename,
  onRemove,
  onSelect
}: {
  event: InteractivityEvent;
  index: number;
  usageCount: number;
  onRename: (id: string) => void;
  onRemove: () => void;
  onSelect?: () => void;
}): JSX.Element {
  const inUse = usageCount > 0;
  return (
    <tr className="gcanvas-variables-row" data-testid={`gcanvas.events.row.${index}`}>
      <td>
        <IdField value={event.id ?? `event#${index}`} onCommit={onRename} testId={`gcanvas.events.name.${index}`} />
      </td>
      <td className="gcanvas-variables-usage" data-testid={`gcanvas.events.usage.${index}`}>
        <button type="button" className="gcanvas-variables-usage-btn" disabled={!onSelect || usageCount === 0} onClick={onSelect}>
          {usageCount}
        </button>
      </td>
      <td>
        <button
          type="button"
          className="btn small gcanvas-variables-delete"
          disabled={inUse}
          title={inUse ? `Used by ${usageCount} node${usageCount === 1 ? "" : "s"} — remove those references first` : "Delete event"}
          data-testid={`gcanvas.events.delete.${index}`}
          onClick={onRemove}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

export function VariablesPanel({
  collapsed,
  onToggleCollapsed,
  variables,
  events,
  types,
  variableUsageCounts,
  eventUsageCounts,
  onAddVariable,
  onRenameVariable,
  onSetVariableType,
  onSetVariableDefault,
  onRemoveVariable,
  onAddEvent,
  onRenameEvent,
  onRemoveEvent,
  onSelectVariable,
  onSelectEvent
}: VariablesPanelProps): JSX.Element {
  if (collapsed) {
    return (
      <button
        className="gcanvas-variables-collapsed"
        onClick={onToggleCollapsed}
        title="Show variables panel"
        aria-label="Show variables panel"
        data-testid="gcanvas.variables.expand"
      >
        {"›"}
      </button>
    );
  }

  return (
    <aside className="gcanvas-variables-panel" data-testid="gcanvas.variables">
      <div className="gcanvas-details-header">
        <span>Variables</span>
        <button onClick={onToggleCollapsed} title="Collapse variables panel" aria-label="Collapse variables panel" data-testid="gcanvas.variables.collapse">
          {"‹"}
        </button>
      </div>
      <div className="gcanvas-variables-body">
        <section className="gcanvas-details-section">
          <table className="gcanvas-details-table gcanvas-variables-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Default</th>
                <th>Used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {variables.map((v, i) => (
                <VariableRow
                  key={i}
                  variable={v}
                  index={i}
                  types={types}
                  usageCount={variableUsageCounts[i] ?? 0}
                  onRename={(id) => onRenameVariable(i, id)}
                  onSetType={(sig) => onSetVariableType(i, sig)}
                  onSetDefault={(value) => onSetVariableDefault(i, value)}
                  onRemove={() => onRemoveVariable(i)}
                  onSelect={onSelectVariable ? () => onSelectVariable(i) : undefined}
                />
              ))}
            </tbody>
          </table>
          <button type="button" className="btn small" data-testid="gcanvas.variables.add" onClick={onAddVariable}>
            + Add variable
          </button>
        </section>

        <section className="gcanvas-details-section">
          <h3>Custom events</h3>
          <table className="gcanvas-details-table gcanvas-variables-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <EventRow
                  key={i}
                  event={e}
                  index={i}
                  usageCount={eventUsageCounts[i] ?? 0}
                  onRename={(id) => onRenameEvent(i, id)}
                  onRemove={() => onRemoveEvent(i)}
                  onSelect={onSelectEvent ? () => onSelectEvent(i) : undefined}
                />
              ))}
            </tbody>
          </table>
          <button type="button" className="btn small" data-testid="gcanvas.events.add" onClick={onAddEvent}>
            + Add event
          </button>
        </section>
      </div>
    </aside>
  );
}
