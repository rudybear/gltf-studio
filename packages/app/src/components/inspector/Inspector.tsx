import { useRef } from "react";
import { useAppStore } from "../../store/app-store";
import { iconForNode, type GltfJsonShape } from "../../lib/gltf-scene";
import { uniqueMaterialIndices } from "../../lib/mesh-info";
import { TransformSection } from "./TransformSection";
import { MeshSection } from "./MeshSection";
import { MaterialSections } from "./MaterialSection";
import { AudioSection } from "./AudioSection";

/**
 * specs/ux-inspector.md UX-4xx: identity strip, Transform/Mesh & Primitives/
 * Material/Audio Emitter sections, and the empty state — the current
 * selection's full editable view. `history.document` (not the store's own
 * `document` field) is what every write reads/writes against, mirroring
 * Viewport.tsx's own convention: `history` is the single always-current
 * source of truth `SceneEdit`/`GraphEdit` command factories are built
 * against; the store's `document` field mirrors it for rendering (they only
 * ever differ in `container`/`dirtyRoots`, never in `json`, so reading
 * either is equivalent for display purposes here).
 */
export function Inspector(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const history = useAppStore((s) => s.history);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);
  const selectNode = useAppStore((s) => s.selectNode);
  const copyPointerPath = useAppStore((s) => s.copyPointerPath);
  const triggerFlash = useAppStore((s) => s.triggerFlash);
  const flashTarget = useAppStore((s) => s.flashTarget);

  const meshSectionRef = useRef<HTMLDivElement>(null);
  const audioSectionRef = useRef<HTMLDivElement>(null);

  const json = document?.json as GltfJsonShape | undefined;
  const node = selectedNodeIndex !== null ? json?.nodes?.[selectedNodeIndex] : undefined;

  if (!document || !history || selectedNodeIndex === null || !node) {
    return (
      <div className="inspector-body" data-testid="inspector.panel">
        <div className="empty-note" data-testid="inspector.empty">
          Nothing selected.
        </div>
      </div>
    );
  }

  const editorDocument = history.document;
  const pointerPath = `/nodes/${selectedNodeIndex}`;
  const meshIndex = node.mesh;
  const children = node.children ?? [];
  const extensionKeys = node.extensions ? Object.keys(node.extensions) : [];
  const meshName = meshIndex !== undefined ? (json?.meshes?.[meshIndex]?.name ?? `Mesh ${meshIndex}`) : undefined;
  const emitterIndex = node.extensions?.KHR_audio_emitter?.emitter;
  const materialIndices = meshIndex !== undefined && json?.meshes?.[meshIndex] ? uniqueMaterialIndices(json.meshes[meshIndex]) : [];
  const nodeType = iconForNode(node);

  function scrollAndFlash(ref: React.RefObject<HTMLDivElement>, id: string): void {
    if (!ref.current) return;
    ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
    triggerFlash({ kind: "inspector-section", id });
  }

  const meshFlashed = flashTarget?.kind === "inspector-section" && flashTarget.id === "mesh";
  const audioFlashed = flashTarget?.kind === "inspector-section" && flashTarget.id === "audio";

  return (
    <div className="inspector-body" data-testid="inspector.panel">
      <div className="identity-strip" data-testid="inspector.identity">
        <div className="identity-line1">
          Node #{selectedNodeIndex} · <span className="mono">{pointerPath}</span>
          <button
            className="btn icon-only small"
            data-testid="inspector.identity.copy"
            title="Copy pointer path"
            onClick={() => copyPointerPath(pointerPath)}
          >
            ⧉
          </button>
        </div>
        {(meshIndex !== undefined || children.length > 0 || extensionKeys.length > 0) && (
          <div className="identity-chips">
            {meshIndex !== undefined && (
              <button
                className="identity-chip"
                data-testid="inspector.identity.ref.mesh"
                onClick={() => scrollAndFlash(meshSectionRef, "mesh")}
              >
                mesh: #{meshIndex} {meshName}
              </button>
            )}
            {children.length > 0 && (
              // UX-403/OPEN(UX-inspector-children-multi-tbd): jump to the
              // first child for a multi-child node, per the approved
              // mockup's own judgment call.
              <button
                className="identity-chip"
                data-testid="inspector.identity.ref.children"
                onClick={() => selectNode(children[0])}
              >
                children: [{children.map((c) => `#${c}`).join(", ")}]
              </button>
            )}
            {extensionKeys.length > 0 && (
              <button
                className="identity-chip"
                data-testid="inspector.identity.ref.extensions"
                onClick={() => scrollAndFlash(audioSectionRef, "audio")}
              >
                extensions: {extensionKeys.join(", ")}
              </button>
            )}
          </div>
        )}
      </div>

      <TransformSection nodeIndex={selectedNodeIndex} node={node} document={editorDocument} />

      {meshIndex !== undefined && json && (
        <div ref={meshSectionRef} className={meshFlashed ? "flash-highlight" : undefined}>
          <MeshSection nodeIndex={selectedNodeIndex} meshIndex={meshIndex} json={json} />
        </div>
      )}

      {materialIndices.length > 0 && json && (
        <MaterialSections materialIndices={materialIndices} json={json} document={editorDocument} />
      )}

      {emitterIndex !== undefined && json && (
        <div ref={audioSectionRef} className={audioFlashed ? "flash-highlight" : undefined}>
          <AudioSection emitterIndex={emitterIndex} json={json} document={editorDocument} />
        </div>
      )}

      {nodeType === "light" && (
        <div className="empty-note" data-testid="inspector.light.note">
          Light-specific properties (color, intensity, type) are edited here in a later iteration.
        </div>
      )}
      {nodeType === "camera" && (
        <div className="empty-note" data-testid="inspector.camera.note">
          Camera-specific properties (FOV, clipping) are edited here in a later iteration.
        </div>
      )}
    </div>
  );
}
