// Dock tab wiring for the audio-graph canvas (specs/ux-audio-graph.md,
// specs/ux-shell.md): owns one AudioGraphJsHost instance for the current
// document (AGH-001), rebuilds/relints it whenever the document changes,
// and mounts @gltf-studio/audio-canvas's editable <AudioGraphCanvas> with
// the result — wiring the app store's `dispatchCommand`/undo history the
// same way BehaviorGraphPanel.tsx wires the behavior graph's `GraphCanvas`.
// Node selection lives in the store's OWN `selectedAudioGraphNodeIndex` slot
// (not `selectedGraphNodeIndex`, the BEHAVIOR graph canvas's own field — a
// second, independent canvas must not fight over the same selection slot),
// matching this project's ephemeral-UI-state convention (DOC-030) — lifted
// out of local component state (specs/ux-audio-script.md UX-1400) so the
// Audio Script tab, a separate mounted component, can read the same
// selection for its own → identifier cross-highlight.
import { useEffect, useMemo } from "react";
import { AudioGraphJsHost } from "@gltf-studio/audio-graph";
import { AudioGraphCanvas } from "@gltf-studio/audio-canvas";
import type { AudioEmitter, AudioEmitterSource, KHRGraph } from "audio-graph-js";
import { useAppStore } from "../../store/app-store";
import { Placeholder } from "./Placeholder";

interface AudioGraphJsonShape {
  extensions?: {
    KHR_audio_graph?: { graphs?: KHRGraph[] };
    KHR_audio_emitter?: { emitters?: AudioEmitter[]; sources?: AudioEmitterSource[] };
  };
}

/**
 * Test-only seam (no UX-### requirement covers it — same pattern as
 * BehaviorGraphPanel.tsx's `window.__gltfStudioGraphTest`): M7 audio-graph
 * editing's e2e spec needs a way to read `extensions.KHR_audio_graph` out of
 * the live document. Installed/removed alongside this panel's own mount —
 * this tab is plain conditionally-mounted (unlike the Behavior graph/Script
 * tabs, which BottomDock.tsx keeps mounted-but-hidden per UX-103 — see
 * e2e/audio.spec.ts's own note on this), so this hook only exists while the
 * Audio graph tab is actually active.
 */
export interface GltfStudioAudioGraphTestHook {
  getDocumentJson(): unknown;
}

declare global {
  interface Window {
    __gltfStudioAudioGraphTest?: GltfStudioAudioGraphTestHook;
  }
}

export function AudioGraphTabPanel(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const pushToast = useAppStore((s) => s.pushToast);
  const selectedNodeIndex = useAppStore((s) => s.selectedAudioGraphNodeIndex);
  const setSelectedNodeIndex = useAppStore((s) => s.selectAudioGraphNode);

  const host = useMemo(() => new AudioGraphJsHost(), []);
  useEffect(() => () => host.close(), [host]);

  // M7 audio-graph editing: selection resets on a genuinely NEW project load
  // via the STORE's own `installProject` (`selectedAudioGraphNodeIndex: null`
  // alongside `selectedGraphNodeIndex`/etc there), not a per-mount effect
  // here — now that selection lives in the shared store (specs/ux-audio-
  // script.md UX-1400, lifted out of local component state so the Audio
  // Script tab can read it too), THIS component itself mounts/unmounts on
  // every dock-tab switch (it is plain conditionally-mounted, this file's
  // own header comment), so a `document.container`-keyed reset effect here
  // would fire on every tab-switch-back-to-Audio-graph — including one
  // driven BY a just-set cross-tab selection (e.g. the Audio Script tab's
  // "→ Audio graph" jump) — silently clobbering it moments after it was set.

  useEffect(() => {
    window.__gltfStudioAudioGraphTest = { getDocumentJson: () => document?.json };
    return () => {
      delete window.__gltfStudioAudioGraphTest;
    };
  }, [document]);

  const json = document?.json as AudioGraphJsonShape | undefined;

  // `buildGraph`/`lint` are both synchronous and side-effect-free w.r.t.
  // React (no AudioContext creation — see AudioGraphJsHost.buildGraph's own
  // doc comment) — computed directly during render via useMemo rather than
  // an effect, so `lintResults` is always in sync with the CURRENT
  // `document.json` on the same render (an effect here would compute one
  // render late, showing stale — here, ALWAYS EMPTY — lint results on the
  // very first paint after any document change).
  const lintResults = useMemo(() => {
    if (document) {
      host.buildGraph(document.json);
    }
    return host.lint();
  }, [document, host]);

  if (!document) {
    return <Placeholder testId="audio-graph.panel" text="Import a .glb/.gltf to inspect its audio graph." />;
  }

  return (
    <div className="audio-graph-panel-wrap" data-testid="audio-graph.panel">
      <AudioGraphCanvas
        document={document}
        dispatchCommand={dispatchCommand}
        emitters={json?.extensions?.KHR_audio_emitter?.emitters}
        sources={json?.extensions?.KHR_audio_emitter?.sources}
        lintResults={lintResults}
        host={host}
        selectedNodeIndex={selectedNodeIndex}
        onSelectNode={setSelectedNodeIndex}
        onToast={pushToast}
      />
    </div>
  );
}
