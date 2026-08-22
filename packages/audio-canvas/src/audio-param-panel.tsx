// Typed param editor for the SELECTED real audio-graph node (specs/ux-
// audio-graph.md UX-610) — numbers/integers get a numeric `<input>`, enums a
// `<select>`, booleans a checkbox, driven by `audio-node-registry.ts`'s
// per-kind field schema (the ratified `KHR_audio_graph.node.schema.json`
// param shapes). Deliberately its OWN small component rather than a reuse
// of `@gltf-studio/graph-canvas`'s `NodeDetails`/`ConfigEditor` machinery:
// that package's typed literal editors (`op-node.tsx`'s `LiteralInput`)
// commit through `onLiteralCommit(nodeIndex, socket, type, value)`, which is
// for VALUE-SOCKET literals (a `value-in` port with no incoming wire) —
// audio-graph node params are a `{ key: value }` bag on the node itself
// (`KHRGraphNodeSpec.params`), never a connectable port, so they don't fit
// that shape (nor `ConfigEditor`'s `DeclarationSelect`/`TargetNodeSelect`,
// which are specifically about `KHR_interactivity` variable/event/scene-node
// references). Rendered by `AudioGraphCanvas` alongside (not replacing)
// `NodeDetails`, which still shows the node's ports/edges/subtitle exactly
// as it did in v1.
//
// UX-616/UX-618 (M7 gaps-closed pass): two additions beyond the original
// number/integer/boolean/enum set —
//  - a `bypass` row (the node's own top-level field, not a `params` key —
//    see `onSetBypass`'s separate prop) ahead of every param row, always
//    present (every `KHR_audio_graph` node kind supports it).
//  - `type: "curve"`/`"periodic-wave"` fields (a flat `number[]` / a
//    `{real,imag}` array pair) edited as textarea(s) of comma/whitespace-
//    separated numbers, committed on blur rather than per keystroke — an
//    in-progress "1, 2," is a normal typing state a live per-character
//    array commit would otherwise stomp on.
//  - `showIf`-gated fields (`isParamFieldVisible`) are simply not rendered
//    until their controlling field's value matches.
import { useState } from "react";
import { audioNodeSpec, isParamFieldVisible, type AudioParamField } from "./audio-node-registry.js";

export interface AudioParamPanelProps {
  kind: string;
  params: Record<string, unknown>;
  onSetParam: (key: string, value: unknown) => void;
  /** UX-616: the node's top-level `bypass` field (distinct from `params`). Omit to hide the row entirely (e.g. no node selected). */
  bypass?: boolean;
  onSetBypass?: (value: boolean) => void;
}

function currentValue(field: AudioParamField, params: Record<string, unknown>): unknown {
  return params[field.key] ?? field.default;
}

/**
 * Parses a comma/whitespace/newline-separated number list, dropping
 * anything that doesn't parse to a finite number (a stray trailing comma
 * while typing, e.g.). Exported (code review — was previously duplicated
 * verbatim in `packages/app`'s `AudioSection.tsx`'s
 * `OscillatorPeriodicWaveFields`, the oscillator SOURCE's own real/imag
 * textarea pair, since that component has no `AudioParamField`+node-kind
 * lookup to drive `PeriodicWaveField` below with) so both call sites share
 * one implementation.
 */
export function parseNumberList(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** See `parseNumberList`'s doc comment — exported for the same reason. */
export function formatNumberList(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

/** `type: "curve"` field: a flat `number[]`, textarea-edited, committed on blur. */
function CurveField({ field, params, onSetParam, testId }: { field: AudioParamField; params: Record<string, unknown>; onSetParam: (key: string, value: unknown) => void; testId: string }): JSX.Element {
  const [text, setText] = useState(() => formatNumberList(currentValue(field, params)));
  return (
    <textarea
      id={testId}
      data-testid={testId}
      className="acanvas-param-curve"
      rows={2}
      placeholder="comma or space separated numbers"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onSetParam(field.key, parseNumberList(text))}
    />
  );
}

/** `type: "periodic-wave"` field: the oscillator's `{ real: number[]; imag: number[] }` Fourier-coefficient pair (gap-analysis G2's payload) — two `CurveField`-style textareas committed together as one nested object. */
function PeriodicWaveField({ field, params, onSetParam, testId }: { field: AudioParamField; params: Record<string, unknown>; onSetParam: (key: string, value: unknown) => void; testId: string }): JSX.Element {
  const current = (currentValue(field, params) ?? {}) as { real?: unknown; imag?: unknown };
  const [realText, setRealText] = useState(() => formatNumberList(current.real));
  const [imagText, setImagText] = useState(() => formatNumberList(current.imag));
  function commit(nextRealText: string, nextImagText: string) {
    onSetParam(field.key, { real: parseNumberList(nextRealText), imag: parseNumberList(nextImagText) });
  }
  return (
    <div className="acanvas-param-periodic-wave">
      <label htmlFor={`${testId}.real`}>
        real
        <textarea
          id={`${testId}.real`}
          data-testid={`${testId}.real`}
          rows={2}
          value={realText}
          onChange={(e) => setRealText(e.target.value)}
          onBlur={() => commit(realText, imagText)}
        />
      </label>
      <label htmlFor={`${testId}.imag`}>
        imag
        <textarea
          id={`${testId}.imag`}
          data-testid={`${testId}.imag`}
          rows={2}
          value={imagText}
          onChange={(e) => setImagText(e.target.value)}
          onBlur={() => commit(realText, imagText)}
        />
      </label>
    </div>
  );
}

export function AudioParamPanel({ kind, params, onSetParam, bypass, onSetBypass }: AudioParamPanelProps): JSX.Element {
  const spec = audioNodeSpec(kind);

  const bypassRow =
    onSetBypass !== undefined ? (
      <label className="acanvas-param-row acanvas-param-row-bypass" htmlFor="acanvas.param.bypass">
        <span className="acanvas-param-label">Bypass</span>
        <input
          id="acanvas.param.bypass"
          data-testid="acanvas.param.bypass"
          type="checkbox"
          checked={Boolean(bypass)}
          onChange={(e) => onSetBypass(e.target.checked)}
        />
      </label>
    ) : null;

  if (!spec) {
    return (
      <div className="acanvas-param-panel" data-testid="acanvas.param-panel">
        {bypassRow}
        <p className="acanvas-param-panel-unregistered">
          Unregistered audio-node kind "{kind}" — no typed param editor available. Raw params: {JSON.stringify(params)}
        </p>
      </div>
    );
  }

  return (
    <div className="acanvas-param-panel" data-testid="acanvas.param-panel">
      {bypassRow}
      {spec.params.map((field) => {
        if (!isParamFieldVisible(spec, field, params)) return null;
        const value = currentValue(field, params);
        const testId = `acanvas.param.${kind}.${field.key}`;
        return (
          <label key={field.key} className="acanvas-param-row" htmlFor={testId}>
            <span className="acanvas-param-label">{field.label}</span>
            {field.type === "enum" ? (
              <select id={testId} data-testid={testId} value={String(value)} onChange={(e) => onSetParam(field.key, e.target.value)}>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <input
                id={testId}
                data-testid={testId}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onSetParam(field.key, e.target.checked)}
              />
            ) : field.type === "curve" ? (
              <CurveField field={field} params={params} onSetParam={onSetParam} testId={testId} />
            ) : field.type === "periodic-wave" ? (
              <PeriodicWaveField field={field} params={params} onSetParam={onSetParam} testId={testId} />
            ) : (
              <input
                id={testId}
                data-testid={testId}
                type="number"
                step={field.step ?? (field.type === "integer" ? 1 : "any")}
                min={field.min}
                max={field.max}
                value={typeof value === "number" ? value : Number(value) || 0}
                onChange={(e) => {
                  const raw = e.target.valueAsNumber;
                  const next = Number.isNaN(raw) ? field.default : field.type === "integer" ? Math.round(raw) : raw;
                  onSetParam(field.key, next);
                }}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
