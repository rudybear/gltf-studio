import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";

const AXES = ["x", "y", "z"] as const;

/**
 * specs/ux-shell.md's right panel (Inspector tab). Minimal read-only
 * transform of the current selection for now — editing (and the pointer
 * affordance / gizmo integration, specs/ux-inspector.md) is a later
 * milestone; this just proves selection sync (UX-202) end to end.
 */
export function Inspector(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);

  const node = selectedNodeIndex !== null ? (document?.json as GltfJsonShape | undefined)?.nodes?.[selectedNodeIndex] : undefined;

  if (!node) {
    return (
      <div className="inspector-body" data-testid="inspector.panel">
        <div className="empty-note" data-testid="inspector.empty">
          Select a node to inspect its transform.
        </div>
      </div>
    );
  }

  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];

  return (
    <div className="inspector-body" data-testid="inspector.panel">
      <div className="inspector-section" data-testid="inspector.transform.section">
        <h4>Transform (read-only)</h4>
        <div className="content">
          <TransformRow label="P" values={translation} testIdPrefix="inspector.transform.position" />
          <TransformRow label="R" values={rotation.slice(0, 3)} testIdPrefix="inspector.transform.rotation" />
          <TransformRow label="S" values={scale} testIdPrefix="inspector.transform.scale" />
        </div>
      </div>
    </div>
  );
}

function TransformRow({ label, values, testIdPrefix }: { label: string; values: number[]; testIdPrefix: string }): JSX.Element {
  return (
    <div className="xyz-row">
      <span className="axis-label">{label}</span>
      {AXES.map((axis, i) => (
        <input key={axis} className="field" type="number" readOnly value={values[i] ?? 0} data-testid={`${testIdPrefix}-${axis}`} />
      ))}
    </div>
  );
}
