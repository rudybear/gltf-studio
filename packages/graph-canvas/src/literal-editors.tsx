// Shared type-aware literal editor (task: "typed literal editors incl. color
// pickers" — specs/ux-graph-canvas.md UX-5xx): bool -> checkbox, int/float ->
// a single numeric input (unchanged from the pre-existing `LiteralInput` this
// replaces), float2/float3/float4 -> N grouped, labeled (x/y/z/w) numeric
// inputs, and — when the socket's pointer path resolves to a KNOWN color
// property (`color-field.tsx`'s `colorKindForPointerPath`) — a color picker
// instead of the grouped numeric fields. ONE editor implementation shared by
// both op-node.tsx's inline card editor and node-details.tsx's side-panel
// port-status editor, so the two surfaces can never drift on which types are
// editable or how a vector's components are laid out.
import { useState } from "react";
import type { ValueType } from "@gltfi/kernel";
import { ColorField, useNumericFallbackToggle, type ColorKind } from "./color-field.js";

export type LiteralValue = Array<number | boolean | string>;

/** Component count for every vector `ValueType` this editor groups into labeled numeric fields — scalar types (`bool`/`int`/`float`/`ref`) and matrix types (`float2x2`/`float3x3`/`float4x4`, never authored as an inline literal in this UI) are absent. */
export const VECTOR_COMPONENT_COUNTS: Readonly<Record<string, number>> = { float2: 2, float3: 3, float4: 4 };

/** Every socket type this editor can render SOME typed control for (as opposed to the pre-existing plain `= value` text chip / raw display fallback). Vector types are new as of this task — the pre-existing `LiteralInput` this replaces only ever handled `bool`/`int`/`float`. */
export const EDITABLE_LITERAL_TYPES: ReadonlySet<string> = new Set(["bool", "int", "float", "float2", "float3", "float4"]);

const COMPONENT_LABELS = ["x", "y", "z", "w"] as const;

function BoolEditor({ value, onCommit, testId }: { value: LiteralValue; onCommit: (v: LiteralValue) => void; testId: string }): JSX.Element {
  const checked = value[0] === true || value[0] === "true";
  return (
    <input
      type="checkbox"
      className="gcanvas-literal-input gcanvas-literal-bool"
      checked={checked}
      onChange={(e) => onCommit([e.target.checked])}
      onClick={(e) => e.stopPropagation()}
      data-testid={testId}
    />
  );
}

/** One numeric `<input>` bound to a single component of `value` (index `slot`) — shared by the plain scalar case (`slot=0`, no label) and each row of the grouped vector case (`slot=0..N-1`, `label` set). Buffers text locally (same convention the pre-existing scalar `LiteralInput` used) so an in-progress edit like "-" or "1." isn't clobbered by `Number()` re-formatting on every keystroke; commits the WHOLE array (not just this slot) on blur, since `onCommit` always writes the full literal value. */
function NumberSlot({
  value,
  slot,
  isInt,
  label,
  testId,
  onCommit
}: {
  value: LiteralValue;
  slot: number;
  isInt: boolean;
  label?: string;
  testId: string;
  onCommit: (v: LiteralValue) => void;
}): JSX.Element {
  const initial = value[slot];
  const [text, setText] = useState<string>(() => (initial === undefined ? "" : String(initial)));
  return (
    <span className="gcanvas-literal-vector-slot">
      {label ? <span className="gcanvas-literal-vector-label">{label}</span> : null}
      <input
        type="number"
        className="gcanvas-literal-input"
        value={text}
        step={isInt ? 1 : "any"}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (!Number.isFinite(n)) return;
          const next = value.slice();
          next[slot] = isInt ? Math.trunc(n) : n;
          onCommit(next);
        }}
        data-testid={testId}
      />
    </span>
  );
}

export type TypedLiteralEditorProps = {
  /** The socket's resolved value type (`map-graph.ts`'s `portType`), or `undefined` when unresolved — this component renders nothing for an unresolved type, same as the pre-existing `LiteralInput`'s own `EDITABLE_SCALAR_TYPES` gate did (the caller falls back to the plain `= value` text display). */
  type: ValueType | string | undefined;
  value: LiteralValue;
  /** Set by the caller when this socket is a `pointer/set|interpolate` node's "value" input AND its resolved pointer path is a known color property (`color-field.tsx`'s `colorKindForPointerPath`) — renders a color picker instead of grouped numeric fields. Ignored for scalar types (`bool`/`int`/`float` never render a color picker regardless). */
  colorKind?: ColorKind;
  onCommit: (value: LiteralValue) => void;
  testIdBase: string;
};

/** Renders `undefined` (nothing) for any type not in `EDITABLE_LITERAL_TYPES` — callers gate on that set themselves before deciding whether to render an editor at all vs. a plain status/chip display. */
export function TypedLiteralEditor({ type, value, colorKind, onCommit, testIdBase }: TypedLiteralEditorProps): JSX.Element | null {
  const numericFallback = useNumericFallbackToggle();

  if (type === undefined || !EDITABLE_LITERAL_TYPES.has(type)) return null;

  if (type === "bool") {
    return <BoolEditor value={value} onCommit={onCommit} testId={testIdBase} />;
  }

  const vectorCount = VECTOR_COMPONENT_COUNTS[type];
  if (colorKind && vectorCount !== undefined && !numericFallback.active) {
    // Missing/non-numeric components default to 1 (opaque white, glTF's own baseColorFactor default) rather than 0 (which would render as black/fully transparent) — a color swatch defaulting to invisible black is a worse first impression than opaque white.
    const numeric = Array.from({ length: vectorCount }, (_, i) => (typeof value[i] === "number" ? (value[i] as number) : 1));
    return (
      <ColorField
        value={numeric}
        kind={colorKind}
        onChange={(next) => onCommit(next)}
        numericFallback={numericFallback}
        testIdBase={testIdBase}
      />
    );
  }

  if (vectorCount !== undefined) {
    // Pad to the FULL component count before rendering any slot: a
    // never-before-authored literal starts as `[]` (e.g. a freshly
    // retargeted `pointer/set` node's "value" socket has no `values.value`
    // entry at all yet) — committing slot 0 against a bare `[]` would
    // `slice()`+index-assign a length-1 array (`[2.5]`), not the
    // full-length `[2.5, 0, 0]` a float3 literal must carry. Every
    // `NumberSlot` below shares this SAME padded array, so editing any one
    // slot's `onCommit` always writes back a complete, correctly-sized
    // literal regardless of which slot was touched first.
    const padded = Array.from({ length: vectorCount }, (_, i) => (typeof value[i] === "number" ? value[i] : 0));
    return (
      <span className="gcanvas-literal-vector" data-testid={`${testIdBase}.group`}>
        {Array.from({ length: vectorCount }, (_, slot) => (
          <NumberSlot
            key={slot}
            value={padded}
            slot={slot}
            isInt={false}
            label={COMPONENT_LABELS[slot]}
            testId={`${testIdBase}.${COMPONENT_LABELS[slot]}`}
            onCommit={onCommit}
          />
        ))}
        {colorKind ? (
          <button
            type="button"
            className="gcanvas-color-field-toggle"
            title="Switch to color picker"
            data-testid={`${testIdBase}.toggle`}
            onClick={numericFallback.onToggle}
          >
            ●
          </button>
        ) : null}
      </span>
    );
  }

  // Scalar int/float.
  return <NumberSlot value={value} slot={0} isInt={type === "int"} testId={testIdBase} onCommit={onCommit} />;
}
