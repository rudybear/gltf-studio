// Dock tab wiring for the audio-graph canvas (specs/ux-audio-graph.md):
// owns one AudioGraphJsHost instance for the current document (AGH-001),
// rebuilds/relints it whenever the document changes, and mounts
// @gltf-studio/audio-canvas's read-only <AudioGraphCanvas> with the result.
// Node selection here is local (not the store's `selectedGraphNodeIndex`,
// which is the BEHAVIOR graph canvas's own field, per BehaviorGraphPanel.tsx
// — a second, independent canvas must not fight over the same selection
// slot) — matching this project's ephemeral-UI-state convention (DOC-030)
// without widening the shared store for a value nothing else needs to read.
import { useEffect, useMemo, useState } from "react";
import { AudioGraphJsHost } from "@gltf-studio/audio-graph";
import { AudioGraphCanvas } from "@gltf-studio/audio-canvas";
import type { AudioEmitter, KHRGraph } from "audio-graph-js";
import { useAppStore } from "../../store/app-store";
import { Placeholder } from "./Placeholder";

interface AudioGraphJsonShape {
  extensions?: {
    KHR_audio_graph?: { graphs?: KHRGraph[] };
    KHR_audio_emitter?: { emitters?: AudioEmitter[] };
  };
}

export function AudioGraphTabPanel(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const pushToast = useAppStore((s) => s.pushToast);
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);

  const host = useMemo(() => new AudioGraphJsHost(), []);
  useEffect(() => () => host.close(), [host]);

  useEffect(() => {
    setSelectedNodeIndex(null);
  }, [document]);

  const json = document?.json as AudioGraphJsonShape | undefined;
  const graphs = json?.extensions?.KHR_audio_graph?.graphs;
  const graph = graphs?.[0];

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
        graph={graph}
        emitters={json?.extensions?.KHR_audio_emitter?.emitters}
        lintResults={lintResults}
        selectedNodeIndex={selectedNodeIndex}
        onSelectNode={setSelectedNodeIndex}
        onToast={pushToast}
      />
    </div>
  );
}
