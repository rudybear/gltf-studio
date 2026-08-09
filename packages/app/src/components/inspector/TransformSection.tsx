import { SceneEdit, type EditorDocument, type TransformFields } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfNodeJson } from "../../lib/gltf-scene";
import { eulerDegToQuat, quatToEulerDeg, type EulerDeg, type Quat } from "../../lib/transform-math";
import { PointerButton } from "./PointerButton";

const AXES = ["x", "y", "z"] as const;

/**
 * specs/ux-inspector.md UX-404: Position/Rotation/Scale as three rows of
 * three editable numeric fields, each with a `◈` pointer-shortcut button.
 * Writes go through `SceneEdit.setTransform` — one command per row per
 * change, coalescing (DOC-010/015) while the same row is being typed/dragged
 * (`SceneEdit.setTransform`'s `coalesceKey` is keyed per node AND per field),
 * so a continuous edit session collapses into one history entry but editing
 * a DIFFERENT row (or node) always starts a fresh one. See
 * lib/transform-math.ts for the Euler<->quaternion note the Rotation row
 * needs (the document stores `rotation` as a quaternion; this row edits it
 * as Euler degrees).
 */
export function TransformSection({
  nodeIndex,
  node,
  document
}: {
  nodeIndex: number;
  node: GltfNodeJson;
  document: EditorDocument;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);

  const translation = (node.translation ?? [0, 0, 0]) as [number, number, number];
  const rotationQuat = (node.rotation ?? [0, 0, 0, 1]) as Quat;
  const scale = (node.scale ?? [1, 1, 1]) as [number, number, number];
  const rotationDeg = quatToEulerDeg(rotationQuat);

  function commit(fields: TransformFields): void {
    dispatchCommand(SceneEdit.setTransform(document, nodeIndex, fields));
  }

  function onPositionChange(axis: 0 | 1 | 2, raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const next = translation.slice() as [number, number, number];
    next[axis] = value;
    commit({ translation: next });
  }

  function onScaleChange(axis: 0 | 1 | 2, raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const next = scale.slice() as [number, number, number];
    next[axis] = value;
    commit({ scale: next });
  }

  function onRotationChange(axis: 0 | 1 | 2, raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const next = rotationDeg.slice() as EulerDeg;
    next[axis] = value;
    commit({ rotation: eulerDegToQuat(next) });
  }

  return (
    <div className="inspector-section" data-testid="inspector.transform.section">
      <h4>Transform</h4>
      <div className="content">
        <div className="xyz-row">
          <span className="axis-label">P</span>
          {AXES.map((axis, i) => (
            <input
              key={axis}
              className="field"
              type="number"
              step="0.1"
              value={roundForDisplay(translation[i])}
              data-testid={`inspector.transform.position-${axis}`}
              onChange={(e) => onPositionChange(i as 0 | 1 | 2, e.target.value)}
            />
          ))}
          <PointerButton propKey="translation" path={`/nodes/${nodeIndex}/translation`} signature="float3" />
        </div>
        <div className="xyz-row">
          <span className="axis-label">R</span>
          {AXES.map((axis, i) => (
            <input
              key={axis}
              className="field"
              type="number"
              step="0.1"
              value={roundForDisplay(rotationDeg[i])}
              data-testid={`inspector.transform.rotation-${axis}`}
              onChange={(e) => onRotationChange(i as 0 | 1 | 2, e.target.value)}
            />
          ))}
          <PointerButton propKey="rotation" path={`/nodes/${nodeIndex}/rotation`} signature="float4" />
        </div>
        <div className="xyz-row">
          <span className="axis-label">S</span>
          {AXES.map((axis, i) => (
            <input
              key={axis}
              className="field"
              type="number"
              step="0.1"
              value={roundForDisplay(scale[i])}
              data-testid={`inspector.transform.scale-${axis}`}
              onChange={(e) => onScaleChange(i as 0 | 1 | 2, e.target.value)}
            />
          ))}
          <PointerButton propKey="scale" path={`/nodes/${nodeIndex}/scale`} signature="float3" />
        </div>
      </div>
    </div>
  );
}

/** Trims float noise (e.g. from a quaternion->Euler round trip) to a display-friendly precision without touching the underlying document value. */
function roundForDisplay(n: number): number {
  return Math.round(n * 1000) / 1000;
}
