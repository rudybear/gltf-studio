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

/**
 * NaN UX (spec alignment: float-typed defaults are NaN — an omitted literal
 * `value` in an imported document, an unwired float input). A non-finite
 * component is represented as an OMITTED entry (`[]`/short array) or, in a
 * partially-NaN vector, as the strings "NaN"/"Infinity"/"-Infinity" (the
 * encoding @gltfi/kernel's `parseScalar` decodes and the exporter writes; JSON
 * cannot carry NaN). These editors must (a) SHOW that state explicitly
 * ("NaN" placeholder, never a fake 0 / white swatch), (b) never write 0 just
 * because a field was focused and blurred untouched, and (c) let the user type
 * a real number.
 */
export function decodeLiteralComponent(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "NaN") return Number.NaN;
  if (v === "Infinity") return Number.POSITIVE_INFINITY;
  if (v === "-Infinity") return Number.NEGATIVE_INFINITY;
  return undefined;
}

/** Inverse of `decodeLiteralComponent` for JSON: finite numbers pass through; NaN/±Infinity become their string spelling (a bare `NaN` number would serialize to `null`). */
export function encodeLiteralComponent(n: number): number | string {
  if (Number.isFinite(n)) return n;
  return Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity";
}

export function isFiniteLiteralComponent(v: unknown): v is number {
  const n = decodeLiteralComponent(v);
  return n !== undefined && Number.isFinite(n);
}

/** `true` when any of the first `count` components is missing/NaN/Infinity/non-numeric — i.e. the literal is (partly) non-finite. */
export function literalHasNaN(value: LiteralValue, count: number): boolean {
  for (let i = 0; i < count; i++) if (!isFiniteLiteralComponent(value[i])) return true;
  return false;
}

/** Placeholder text for a non-finite float component: "NaN" (omitted/NaN) or the infinity's spelling. */
function nonFiniteLabel(v: unknown): string {
  const n = decodeLiteralComponent(v);
  if (n === undefined || Number.isNaN(n)) return "NaN";
  return n > 0 ? "Infinity" : "-Infinity";
}

/** Display text for a literal on a card/status line: an omitted float literal reads `NaN` (or `[NaN, NaN, NaN]`), not `[]`. */
export function formatLiteralDisplay(value: LiteralValue, type?: string): string {
  const isFloat = type === "float" || (type !== undefined && VECTOR_COMPONENT_COUNTS[type] !== undefined);
  const count = type === "float" ? 1 : type !== undefined ? (VECTOR_COMPONENT_COUNTS[type] ?? 0) : 0;
  const shown: Array<number | boolean | string> = isFloat
    ? Array.from({ length: count }, (_, i) => (isFiniteLiteralComponent(value[i]) ? value[i]! : nonFiniteLabel(value[i])))
    : value;
  return shown.length === 1 ? String(shown[0]) : `[${shown.map(String).join(", ")}]`;
}

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
  // A non-finite component (NaN/omitted/Infinity) has no representation in a number input: start blank and show the placeholder.
  const initialText = isFiniteLiteralComponent(initial) ? String(initial) : "";
  const [text, setText] = useState<string>(() => initialText);
  // A float component that is omitted/NaN shows an explicit "NaN" placeholder (an int's default is 0, never NaN).
  const showNaN = !isInt && !isFiniteLiteralComponent(initial);
  return (
    <span className="gcanvas-literal-vector-slot">
      {label ? <span className="gcanvas-literal-vector-label">{label}</span> : null}
      <input
        type="number"
        className="gcanvas-literal-input"
        value={text}
        placeholder={showNaN ? nonFiniteLabel(initial) : undefined}
        data-nan={showNaN && text === "" ? "true" : undefined}
        step={isInt ? 1 : "any"}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // Untouched (focus + blur) or blank: commit NOTHING. `Number("")` is 0, which would silently turn an omitted/NaN literal into a real 0.
          if (text === initialText || text.trim() === "") return;
          const n = Number(text);
          if (!Number.isFinite(n)) return;
          const next = value.slice();
          next[slot] = isInt ? Math.trunc(n) : n;
          // A vector literal must be complete in JSON: components still NaN/Infinity keep that value, spelled as a string ("NaN"), never silently 0.
          onCommit(next.map((c) => (typeof c === "number" ? encodeLiteralComponent(c) : c)));
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
  const nanVector = vectorCount !== undefined && literalHasNaN(value, vectorCount);
  if (colorKind && vectorCount !== undefined && !numericFallback.active && !nanVector) {
    // Missing/non-numeric components default to 1 (opaque white, glTF's own baseColorFactor default) rather than 0 (which would render as black/fully transparent) — a color swatch defaulting to invisible black is a worse first impression than opaque white.
    const numeric = Array.from({ length: vectorCount }, (_, i) => (isFiniteLiteralComponent(value[i]) ? decodeLiteralComponent(value[i])! : 1));
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
    // Missing components stay NaN (displayed as a "NaN" placeholder, see NumberSlot) rather than being faked as 0.
    const padded = Array.from({ length: vectorCount }, (_, i) => decodeLiteralComponent(value[i]) ?? Number.NaN);
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
        {colorKind && nanVector ? (
          // A NaN color has no honest swatch (white would be a lie): offer an explicit way to start from opaque white and pick.
          <button
            type="button"
            className="gcanvas-color-field-toggle"
            title="Set a color (starts at white)"
            data-testid={`${testIdBase}.init-color`}
            onClick={() => onCommit(Array.from({ length: vectorCount }, () => 1))}
          >
            ●
          </button>
        ) : colorKind ? (
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
