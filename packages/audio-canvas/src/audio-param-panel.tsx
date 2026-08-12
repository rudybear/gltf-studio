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
import { audioNodeSpec, type AudioParamField } from "./audio-node-registry.js";

export interface AudioParamPanelProps {
  kind: string;
  params: Record<string, unknown>;
  onSetParam: (key: string, value: unknown) => void;
}

function currentValue(field: AudioParamField, params: Record<string, unknown>): unknown {
  return params[field.key] ?? field.default;
}

export function AudioParamPanel({ kind, params, onSetParam }: AudioParamPanelProps): JSX.Element {
  const spec = audioNodeSpec(kind);

  if (!spec) {
    return (
      <div className="acanvas-param-panel" data-testid="acanvas.param-panel">
        <p className="acanvas-param-panel-unregistered">
          Unregistered audio-node kind "{kind}" — no typed param editor available. Raw params: {JSON.stringify(params)}
        </p>
      </div>
    );
  }

  return (
    <div className="acanvas-param-panel" data-testid="acanvas.param-panel">
      {spec.params.map((field) => {
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
