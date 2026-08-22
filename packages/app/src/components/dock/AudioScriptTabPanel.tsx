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
import { runAudioDebugAudition } from "../../lib/audio-debug-audition.js";
import { Placeholder } from "./Placeholder";

const LazyAudioScriptPanel = lazy(() => import("@gltf-studio/audio-script-panel").then((m) => ({ default: m.AudioScriptPanel })));

interface AudioGraphJsonShape {
  extensions?: {
    KHR_audio_graph?: { graphs?: KHRGraph[] };
    KHR_audio_emitter?: { emitters?: AudioEmitter[]; sources?: AudioEmitterSource[] };
  };
}

/**
 * D3 (specs/ux-debugger.md UX-1508/UX-1509): "Debug audition" always
 * addresses `KHR_audio_graph.graphs[0]` — same "always graph 0" scope
 * `AudioScriptTabPanel`'s own `graphIndex={0}` prop below already documents
 * (`ux-audio-script.md`'s `OPEN(UX-audio-script-multigraph-tbd)`), so
 * breakpoints for this tab need no per-graph indirection.
 */
const AUDIO_DEBUG_GRAPH_INDEX = 0;

export function AudioScriptTabPanel(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const selectedAudioGraphNodeIndex = useAppStore((s) => s.selectedAudioGraphNodeIndex);
  const jumpAudioScriptNodeToGraph = useAppStore((s) => s.jumpAudioScriptNodeToGraph);
  const log = useAppStore((s) => s.log);
  const pushToast = useAppStore((s) => s.pushToast);
  const audioScriptBreakpoints = useAppStore((s) => s.audioScriptBreakpoints);
  const toggleAudioScriptBreakpoint = useAppStore((s) => s.toggleAudioScriptBreakpoint);

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
          breakpoints={audioScriptBreakpoints[AUDIO_DEBUG_GRAPH_INDEX]}
          onToggleBreakpoint={(line) => toggleAudioScriptBreakpoint(AUDIO_DEBUG_GRAPH_INDEX, line)}
          onDebugAudition={(code, breakpointLines) => {
            // D3: fire-and-forget from this component's perspective —
            // success/failure both surface via the SAME toast+console-log
            // channel every other action in this dock layer already uses
            // (mirrors ScriptTabPanel.tsx's `onLog`/`onToast` wiring
            // convention), rather than inventing a new UI affordance for a
            // one-shot construction run.
            runAudioDebugAudition(code, AUDIO_DEBUG_GRAPH_INDEX, breakpointLines)
              .then((result) => {
                const nodeCount = Array.isArray((result.graph as { nodes?: unknown[] }).nodes) ? (result.graph as { nodes: unknown[] }).nodes.length : 0;
                pushToast(`Debug audition: constructed ${nodeCount} node(s)${result.sources.length > 0 ? `, ${result.sources.length} oscillator source(s)` : ""}.`);
                log("info", "Debug audition: audio script executed successfully.");
              })
              .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                pushToast(`Debug audition failed: ${message}`);
                log("error", `Debug audition: ${message}`);
              });
          }}
        />
      </Suspense>
    </div>
  );
}
