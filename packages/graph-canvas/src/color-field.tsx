// Shared color-picker UI (task: "for such cases as input for material when
// we clearly know this is color, we can add color pickers") — used by this
// package's own typed-literal-editors.tsx (graph node literal editing, both
// op-node.tsx's inline card and node-details.tsx's side panel) AND, per that
// task's "reuse the material Base Color picker component from the Inspector
// ... extract/share it rather than duplicate" instruction, by
// packages/app's `MaterialSection.tsx` — this package is the canonical home
// (not packages/app) because packages/app already depends on
// @gltf-studio/graph-canvas (BehaviorGraphPanel.tsx mounts <GraphCanvas>),
// never the reverse; a component graph-canvas itself needs cannot live in a
// package it has no dependency on.
//
// hexToRgb01/rgb01ToHex MIRROR packages/app/src/lib/color.ts's identical
// pair (not imported — same zero-cross-package-dependency rationale as
// this package's other mirrored small sets, e.g. map-graph.ts's
// HANDLER_OPS). `colorKindForPointerPath` similarly mirrors
// packages/app/src/lib/pointer-vocab.ts's canonical definition — see that
// function's own doc comment.
import { useState } from "react";

export type ColorKind = "rgb" | "rgba";

const COLOR_PATH_PATTERNS: ReadonlyArray<{ re: RegExp; kind: ColorKind }> = [
  { re: /\/pbrMetallicRoughness\/baseColorFactor$/, kind: "rgba" },
  { re: /\/materials\/\d+\/emissiveFactor$/, kind: "rgb" },
  { re: /\/extensions\/KHR_lights_punctual\/lights\/\d+\/color$/, kind: "rgb" }
];

/** Mirrors `packages/app/src/lib/pointer-vocab.ts`'s `colorKindForPointerPath` — see that function's doc comment for the canonical definition and the "known gaps" it documents. */
export function colorKindForPointerPath(pointerPath: string): ColorKind | undefined {
  for (const { re, kind } of COLOR_PATH_PATTERNS) {
    if (re.test(pointerPath)) return kind;
  }
  return undefined;
}

/** `<input type="color">` works in hex (`#rrggbb`, 0-255/channel, no alpha); glTF color factors are `[r,g,b(,a)]` linear-ish floats in [0,1]. Mirrors packages/app/src/lib/color.ts's identical pair. */
export function hexToRgb01(hex: string): [number, number, number] {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const clean = match ? match[1]! : "ffffff";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}

export function rgb01ToHex([r, g, b]: readonly [number, number, number] | number[]): string {
  const toByte = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export type ColorFieldProps = {
  /** 3 (RGB) or 4 (RGBA) components in [0,1]; a 4th component beyond RGB is treated as alpha and rendered as a separate numeric slider, never folded into the `<input type="color">` itself (that element has no alpha channel). */
  value: number[];
  kind: ColorKind;
  onChange: (next: number[]) => void;
  /** Task ("a color picker (with numeric fallback toggle)"): a small link that swaps this field for `children` (the caller's own grouped-numeric-fields editor) — omitted (no toggle rendered) when the caller has no numeric fallback to offer (e.g. Inspector's simpler always-color usage). */
  numericFallback?: { active: boolean; onToggle: () => void };
  testIdBase: string;
};

/** A `<input type="color">` (+ an alpha slider for RGBA) bound to a `[0,1]`-float component array, with an optional numeric-fallback toggle. Every edit calls `onChange` with a full, correctly-sized array — callers never need to merge partial updates themselves. */
export function ColorField({ value, kind, onChange, numericFallback, testIdBase }: ColorFieldProps): JSX.Element {
  const rgb: [number, number, number] = [value[0] ?? 1, value[1] ?? 1, value[2] ?? 1];
  const alpha = kind === "rgba" ? (value[3] ?? 1) : undefined;

  return (
    <span className="gcanvas-color-field">
      <input
        type="color"
        value={rgb01ToHex(rgb)}
        data-testid={`${testIdBase}.swatch`}
        onChange={(e) => {
          const [r, g, b] = hexToRgb01(e.target.value);
          onChange(alpha === undefined ? [r, g, b] : [r, g, b, alpha]);
        }}
      />
      {alpha !== undefined ? (
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          title={`alpha: ${alpha}`}
          data-testid={`${testIdBase}.alpha`}
          onChange={(e) => onChange([...rgb, Number(e.target.value)])}
        />
      ) : null}
      {numericFallback ? (
        <button
          type="button"
          className="gcanvas-color-field-toggle"
          title={numericFallback.active ? "Switch to color picker" : "Switch to numeric fields"}
          data-testid={`${testIdBase}.toggle`}
          onClick={numericFallback.onToggle}
        >
          #
        </button>
      ) : null}
    </span>
  );
}

/** Small local hook mirroring the "toggle between color picker and numeric fallback" bit of state every caller of `ColorField`'s `numericFallback` prop needs — factored out so `op-node.tsx`/`node-details.tsx` don't each re-declare it. Defaults to the color picker (`false` = not showing numeric fallback). */
export function useNumericFallbackToggle(): { active: boolean; onToggle: () => void } {
  const [active, setActive] = useState(false);
  return { active, onToggle: () => setActive((v) => !v) };
}
