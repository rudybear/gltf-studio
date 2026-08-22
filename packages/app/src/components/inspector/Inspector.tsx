import { useEffect, useRef } from "react";
import { SceneEdit } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { uniqueMaterialIndices } from "../../lib/mesh-info";
import { TransformSection } from "./TransformSection";
import { MeshSection } from "./MeshSection";
import { MaterialSections } from "./MaterialSection";
import { AudioSection } from "./AudioSection";
import { AudioEnvironmentSection } from "./AudioEnvironmentSection";
import { LightSection } from "./LightSection";
import { CameraSection } from "./CameraSection";
import { UsageSection } from "./UsageSection";

/**
 * specs/ux-inspector.md UX-4xx: identity strip, Transform/Mesh & Primitives/
 * Material/Audio Emitter/Light/Camera sections, and the empty state — the
 * current selection's full editable view. `history.document` (not the store's own
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
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);
  const selectNode = useAppStore((s) => s.selectNode);
  const copyPointerPath = useAppStore((s) => s.copyPointerPath);
  const triggerFlash = useAppStore((s) => s.triggerFlash);
  const flashTarget = useAppStore((s) => s.flashTarget);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);
  const addCopilotContextChip = useAppStore((s) => s.addCopilotContextChip);
  const requestCopilotComposerFocus = useAppStore((s) => s.requestCopilotComposerFocus);

  const meshSectionRef = useRef<HTMLDivElement>(null);
  const audioSectionRef = useRef<HTMLDivElement>(null);
  // UX-1116 (specs/ux-usage-mapping.md): the scene tree/asset browser's ⚡
  // badge click flashes+scrolls to this section from OUTSIDE the Inspector
  // (unlike the identity strip's own chips, which scroll via their local
  // `scrollAndFlash` call below) — see the `flashTarget` effect further
  // down that reacts to an externally-set flash the same way.
  const usageSectionRef = useRef<HTMLDivElement>(null);

  // UX-1116: a flash targeting THIS section that originated OUTSIDE the
  // Inspector (the scene tree/asset browser's ⚡ badge, which selects the
  // node and triggers the flash directly — it has no `usageSectionRef` of
  // its own to scroll with) still scrolls the section into view here, the
  // same end result `scrollAndFlash` below gives the identity-chip case.
  // MUST run unconditionally (before the early-return guard below) — every
  // hook in a component must run on every render regardless of which branch
  // that render takes, or React throws (a real regression this fix caught:
  // "Rendered fewer hooks than expected" the instant selection changes).
  const usageFlashed = flashTarget?.kind === "inspector-section" && flashTarget.id === "usage";
  useEffect(() => {
    if (usageFlashed) usageSectionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [usageFlashed]);

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
  // Multi-emitter-per-node (closing PR #48's documented gap): a node's
  // `KHR_audio_emitter` binding may be the original singular `.emitter`
  // field OR the array-valued `.emitters` field `SceneEdit.addEmitterToNode`
  // introduces on a SECOND emitter — normalized to one list here the same
  // way `WebAudioHost` itself already reads both shapes interchangeably
  // (`web-audio-host.ts`'s own `Array.isArray(ext.emitters) ? ext.emitters
  // : ... [ext.emitter]` fallback).
  const audioExt = node.extensions?.KHR_audio_emitter;
  const emitterIndices = Array.isArray(audioExt?.emitters) ? audioExt.emitters : typeof audioExt?.emitter === "number" ? [audioExt.emitter] : [];
  const lightIndex = node.extensions?.KHR_lights_punctual?.light;
  const cameraIndex = node.camera;
  const materialIndices = meshIndex !== undefined && json?.meshes?.[meshIndex] ? uniqueMaterialIndices(json.meshes[meshIndex]) : [];

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
          {/*
            specs/ux-copilot.md UX-1009/UX-1000: switches to the Copilot tab
            and attaches an EXPLICIT chip naming this selection -- redundant
            with the auto-selection chip `sendCopilotPrompt` adds (AG-012),
            but UX-1009 asks for exactly that: an inline "✦" affordance's own
            visible, removable chip, not a substitute for auto-population.
          */}
          <button
            className="btn icon-only small"
            data-testid="inspector.identity.ask-copilot"
            title="Ask Copilot about this node"
            onClick={() => {
              const label = `Node #${selectedNodeIndex}`;
              setActiveRightTab("copilot");
              addCopilotContextChip({ kind: "explicit", label, pointer: pointerPath }, label);
              requestCopilotComposerFocus();
            }}
          >
            ✦
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

      {json && (
        <div ref={audioSectionRef} className={audioFlashed ? "flash-highlight" : undefined}>
          {emitterIndices.map((idx) => (
            <AudioSection key={idx} emitterIndex={idx} nodeIndex={selectedNodeIndex} json={json} document={editorDocument} />
          ))}
          <button
            className="btn small"
            data-testid="inspector.audio.add-emitter"
            onClick={() => dispatchCommand(SceneEdit.addEmitterToNode(editorDocument, selectedNodeIndex).command)}
          >
            + Add audio emitter
          </button>
        </div>
      )}

      {lightIndex !== undefined && json && <LightSection lightIndex={lightIndex} json={json} document={editorDocument} />}
      {cameraIndex !== undefined && json && (
        <CameraSection cameraIndex={cameraIndex} nodeIndex={selectedNodeIndex} json={json} document={editorDocument} />
      )}

      {json && <AudioEnvironmentSection nodeIndex={selectedNodeIndex} json={json} document={editorDocument} />}

      {json && (
        <div ref={usageSectionRef} className={usageFlashed ? "flash-highlight" : undefined}>
          <UsageSection nodeIndex={selectedNodeIndex} json={json} />
        </div>
      )}
    </div>
  );
}
