// Dock tab wiring for the audio-graph canvas (specs/ux-audio-graph.md,
// specs/ux-shell.md): owns one AudioGraphJsHost instance for the current
// document (AGH-001), rebuilds/relints it whenever the document changes,
// and mounts @gltf-studio/audio-canvas's editable <AudioGraphCanvas> with
// the result — wiring the app store's `dispatchCommand`/undo history the
// same way BehaviorGraphPanel.tsx wires the behavior graph's `GraphCanvas`.
// Node selection here is local (not the store's `selectedGraphNodeIndex`,
// which is the BEHAVIOR graph canvas's own field, per BehaviorGraphPanel.tsx
// — a second, independent canvas must not fight over the same selection
// slot) — matching this project's ephemeral-UI-state convention (DOC-030)
// without widening the shared store for a value nothing else needs to read.
import { useEffect, useMemo, useState } from "react";
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
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);

  const host = useMemo(() => new AudioGraphJsHost(), []);
  useEffect(() => () => host.close(), [host]);

  // M7 audio-graph editing: reset selection when a genuinely NEW project
  // loads, not on every in-place edit — `document.container` ("the pristine
  // parse of the last successful save", document.ts's own doc comment)
  // stays referentially stable across `dispatchCommand`-driven edits within
  // one project, unlike `document` itself (a fresh object every edit), so
  // keying on it here is what lets a just-added/just-selected node's
  // selection SURVIVE the very AudioGraphEdit command that created it.
  useEffect(() => {
    setSelectedNodeIndex(null);
  }, [document?.container]);

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
