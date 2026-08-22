// Dock tab wiring for the Audio Script tab (specs/ux-audio-script.md
// UX-1400): mounts @gltf-studio/audio-script-panel's <AudioScriptPanel> for
// the current document, wiring its Apply -> Audio graph command into the
// app store's dispatchCommand/undo history — same wiring shape as
// ScriptTabPanel.tsx for the (interactivity) Script tab.
//
// Selection resolution: the audio-graph canvas's own selection
// (`selectedAudioGraphNodeIndex`, a `@gltf-studio/audio-canvas` `MappedNode
// .index` — a dense index over ALL THREE entity kinds combined, not
// directly a `graph.nodes[]` index) is resolved here, via the SAME
// `mapAudioGraph`/`identifyMappedNode` utilities `AudioGraphCanvas` itself
// uses internally, into the two separate primitives `AudioScriptPanel`
// actually wants (`selectedNodeIndex`/`selectedSourceIndex`) — done in THIS
// dock-wiring layer (not inside `@gltf-studio/audio-script-panel` itself) so
// that package takes no dependency on `@gltf-studio/audio-canvas`.
import { useMemo, lazy, Suspense } from "react";
import { mapAudioGraph, identifyMappedNode, findMappedNode } from "@gltf-studio/audio-canvas";
import type { AudioEmitter, AudioEmitterSource, KHRGraph } from "audio-graph-js";
import { useAppStore } from "../../store/app-store";
import { Placeholder } from "./Placeholder";

const LazyAudioScriptPanel = lazy(() => import("@gltf-studio/audio-script-panel").then((m) => ({ default: m.AudioScriptPanel })));

interface AudioGraphJsonShape {
  extensions?: {
    KHR_audio_graph?: { graphs?: KHRGraph[] };
    KHR_audio_emitter?: { emitters?: AudioEmitter[]; sources?: AudioEmitterSource[] };
  };
}

export function AudioScriptTabPanel(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const selectedAudioGraphNodeIndex = useAppStore((s) => s.selectedAudioGraphNodeIndex);
  const jumpAudioScriptNodeToGraph = useAppStore((s) => s.jumpAudioScriptNodeToGraph);
  const log = useAppStore((s) => s.log);
  const pushToast = useAppStore((s) => s.pushToast);

  const json = document?.json as AudioGraphJsonShape | undefined;
  const graph = json?.extensions?.KHR_audio_graph?.graphs?.[0];

  const selection = useMemo(() => {
    if (!graph || selectedAudioGraphNodeIndex === null) return null;
    const mapped = mapAudioGraph(graph, 0, json?.extensions?.KHR_audio_emitter?.emitters ?? [], [], json?.extensions?.KHR_audio_emitter?.sources ?? []);
    const node = findMappedNode(mapped, selectedAudioGraphNodeIndex);
    return node ? identifyMappedNode(node) : null;
  }, [graph, json, selectedAudioGraphNodeIndex]);

  if (!document) {
    return <Placeholder testId="audio-script.panel" text="Import a .glb/.gltf to view its generated audio script." />;
  }

  return (
    <div className="audio-script-tab-wrap" data-testid="audio-script.tab-wrap">
      <Suspense fallback={<Placeholder testId="audio-script.panel.loading" text="Loading audio script editor…" />}>
        <LazyAudioScriptPanel
          document={document}
          graphIndex={0}
          dispatchCommand={dispatchCommand}
          selectedNodeIndex={selection?.type === "node" ? selection.rawIndex : null}
          selectedSourceIndex={selection?.type === "source" ? selection.sourceIndex : null}
          onLog={log}
          onToast={pushToast}
          onJumpToAudioGraphNode={jumpAudioScriptNodeToGraph}
        />
      </Suspense>
    </div>
  );
}
