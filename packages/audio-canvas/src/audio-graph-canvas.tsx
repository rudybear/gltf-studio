// Top-level audio-graph canvas component (specs/ux-audio-graph.md): reads
// the raw KHR_audio_graph graph out of the document JSON, maps it
// (map-audio-graph.ts), and renders it through @gltf-studio/graph-canvas's
// SHARED GraphView + NodeDetails (UX-600) plus this package's OWN palette
// (audio-palette-panel.tsx, UX-608) and param editor (audio-param-panel.tsx,
// UX-610), a lint banner (UX-602) extended with per-node badges (UX-609),
// and an audition control (UX-611).
//
// EDITABLE (M7 audio-graph editing — supersedes the v1 read-only note this
// file used to carry): every `GraphView` edit callback now translates into
// an `AudioGraphEdit` command via `dispatchCommand`, mirroring
// `@gltf-studio/graph-canvas`'s own `GraphCanvas` — this is the ONLY module
// in this package that calls `AudioGraphEdit` factories. `audio-entity.ts`'s
// `identifyMappedNode` bridges `GraphView`'s mapped node indices back to the
// three real KHR_audio_graph identities (`graph.nodes[]` index, bound
// `KHR_audio_emitter` source index, bound emitter index) those factories
// operate on.
import { useMemo } from "react";
import { GraphView, NodeDetails, type GraphDiagnostic, type GraphViewProps } from "@gltf-studio/graph-canvas";
import { AudioGraphEdit, SceneEdit, applyPatches, getIn, graphPath, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import type { AudioGraphHost, AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { KHRGraph, AudioEmitter, AudioEmitterSource } from "audio-graph-js";
import { mapAudioGraph } from "./map-audio-graph.js";
import { identifyMappedNode, findMappedNode, parseInputSocket, parseOutputSocket } from "./audio-entity.js";
import { buildAudioDiagnosticsByNode } from "./audio-diagnostics.js";
import { AudioPalettePanel } from "./audio-palette-panel.js";
import { AudioParamPanel } from "./audio-param-panel.js";
import { defaultParamsFor } from "./audio-node-registry.js";

export interface AudioGraphCanvasProps {
  document: EditorDocument;
  /** Which `extensions.KHR_audio_graph.graphs[N]` to show/edit. Defaults to 0. */
  graphIndex?: number;
  dispatchCommand: (command: Command) => void;
  /** `extensions.KHR_audio_emitter.emitters`, for the terminal emitter node's display name (UX-607) and, as of UX-617, its persisted canvas position. */
  emitters?: AudioEmitter[];
  /** `extensions.KHR_audio_emitter.sources`, for the terminal source node's persisted canvas position (UX-617). */
  sources?: AudioEmitterSource[];
  /** AudioGraphHost.lint()'s current results for this document. */
  lintResults: AudioGraphLintResult[];
  /** For the audition control (UX-611) — the SAME `AudioGraphJsHost` instance the caller already built `lintResults` from. */
  host?: AudioGraphHost;
  selectedNodeIndex: number | null;
  onSelectNode: (index: number | null) => void;
  onToast?: (text: string) => void;
}

export function AudioGraphCanvas({
  document,
  graphIndex = 0,
  dispatchCommand,
  emitters = [],
  sources = [],
  lintResults,
  host,
  selectedNodeIndex,
  onSelectNode,
  onToast
}: AudioGraphCanvasProps): JSX.Element {
  const graphs = getIn(document.json, ["extensions", "KHR_audio_graph", "graphs"]) as KHRGraph[] | undefined;
  const hasGraph = graphs !== undefined && graphs.length > graphIndex;
  const graph = hasGraph ? graphs![graphIndex] : undefined;

  const mapped = useMemo(
    () => (graph ? mapAudioGraph(graph, graphIndex, emitters, lintResults, sources) : null),
    [graph, graphIndex, emitters, lintResults, sources]
  );

  const diagnosticsByNode: Map<number, GraphDiagnostic[]> = useMemo(
    () => (graph ? buildAudioDiagnosticsByNode(graph, graphIndex, lintResults) : new Map()),
    [graph, graphIndex, lintResults]
  );

  const violations = lintResults.filter((r) => r.graphIndex === graphIndex || r.graphIndex === -1);
  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;

  function resolveTargetDocumentAndGraphIndex(): { workingDocument: EditorDocument; index: number } {
    if (hasGraph) return { workingDocument: document, index: graphIndex };
    const command = AudioGraphEdit.ensureGraph(document, graphIndex);
    if (command.patches.length > 0) dispatchCommand(command);
    const jsonAfter = command.patches.length > 0 ? applyPatches(document.json, command.patches) : document.json;
    return { workingDocument: { ...document, json: jsonAfter }, index: graphIndex };
  }

  function handleAddNode(kind: string) {
    const { workingDocument, index } = resolveTargetDocumentAndGraphIndex();
    const existingCount = (getIn(workingDocument.json, [...graphPath(index), "nodes"]) as unknown[] | undefined)?.length ?? 0;
    const position = { x: 40 + (existingCount % 6) * 24, y: 40 + (existingCount % 6) * 24 };
    const command = AudioGraphEdit.addNode(workingDocument, index, kind, defaultParamsFor(kind), { position });
    dispatchCommand(command);
    onSelectNode(existingCount);
  }

  /** Shared wrapper for the two edit handlers below whose `AudioGraphEdit` call can legitimately throw on an unreachable-via-UI combination (e.g. `connectAudio`'s source-into-emitter rejection) — dispatches on success, surfaces the thrown message as a toast instead of letting it escape as an uncaught exception. */
  function dispatchOrToast(build: () => Command) {
    try {
      dispatchCommand(build());
    } catch (error) {
      onToast?.(error instanceof Error ? error.message : String(error));
    }
  }

  function handleConnectValue(nodeIndex: number, socket: string, sourceNode: number, sourceSocket: string) {
    if (!mapped) return;
    const targetMapped = findMappedNode(mapped, nodeIndex);
    const sourceMapped = findMappedNode(mapped, sourceNode);
    if (!targetMapped || !sourceMapped) return;
    const targetEntity = identifyMappedNode(targetMapped);
    const sourceEntity = identifyMappedNode(sourceMapped);

    // The emitter terminal has no OUTPUT port and the source terminal has no
    // INPUT port (map-audio-graph.ts), so GraphView can never actually offer
    // these as a connection's source/target respectively — defensive, not a
    // reachable UI path.
    if (sourceEntity.type === "emitter") {
      onToast?.("An emitter terminal has no output to connect from.");
      return;
    }
    if (targetEntity.type === "source") {
      onToast?.("A source terminal has no input to connect into.");
      return;
    }
    if (sourceEntity.type === "source" && targetEntity.type === "emitter") {
      onToast?.("Cannot connect a source directly to an emitter — route it through a processing node.");
      return;
    }

    const from = sourceEntity.type === "node" ? { kind: "node" as const, index: sourceEntity.rawIndex, output: parseOutputSocket(sourceSocket) } : { kind: "source" as const, sourceIndex: sourceEntity.sourceIndex };
    const to = targetEntity.type === "node" ? { kind: "node" as const, index: targetEntity.rawIndex, input: parseInputSocket(socket) } : { kind: "emitter" as const, emitterIndex: targetEntity.emitterIndex };

    dispatchOrToast(() => AudioGraphEdit.connectAudio(document, graphIndex, from, to));
  }

  function handleConnectRejected(reason: string) {
    onToast?.(`Connection rejected: ${reason}`);
  }

  function handleDisconnectEdge(nodeIndex: number, socket: string) {
    if (!mapped) return;
    const targetMapped = findMappedNode(mapped, nodeIndex);
    if (!targetMapped) return;
    const entity = identifyMappedNode(targetMapped);
    const to = entity.type === "node" ? { kind: "node" as const, index: entity.rawIndex, input: parseInputSocket(socket) } : entity.type === "emitter" ? { kind: "emitter" as const, emitterIndex: entity.emitterIndex } : null;
    if (!to) {
      onToast?.("Nothing to disconnect there.");
      return;
    }
    dispatchOrToast(() => AudioGraphEdit.disconnectAudio(document, graphIndex, to));
  }

  function handleRemoveNodes(nodeIndices: number[]) {
    if (!mapped) return;
    const realIndices: number[] = [];
    for (const index of nodeIndices) {
      const node = findMappedNode(mapped, index);
      if (!node) continue;
      const entity = identifyMappedNode(node);
      if (entity.type === "node") {
        realIndices.push(entity.rawIndex);
      } else {
        onToast?.(`Can't delete the ${entity.type} terminal node — disconnect it instead.`);
      }
    }
    // Descending order + a locally-advanced JSON copy, same rationale as
    // @gltf-studio/graph-canvas's own handleRemoveNodes: each dispatchCommand
    // only updates the store on its NEXT render.
    const sorted = [...new Set(realIndices)].sort((a, b) => b - a);
    let working = document;
    for (const rawIndex of sorted) {
      const command = AudioGraphEdit.removeNode(working, graphIndex, rawIndex);
      dispatchCommand(command);
      working = { ...working, json: applyPatches(working.json, command.patches) };
    }
    if (selectedNodeIndex !== null && nodeIndices.includes(selectedNodeIndex)) {
      onSelectNode(null);
    }
  }

  /**
   * UX-617 (Track 1 gap closure — supersedes UX-613's original "session-only"
   * note for the two synthetic terminal kinds): a REAL node's position still
   * persists via `AudioGraphEdit.setNodePosition` (DOC-058, this graph's own
   * `graph.nodes[nodeIndex].extras.gltfi`); a source/emitter TERMINAL node is
   * not a `graph.nodes[]` entry, so its position now persists on the
   * underlying `KHR_audio_emitter` registry entry instead, via
   * `SceneEdit.setAudioSourceProperty`/`setAudioEmitterProperty` (DOC-062) —
   * the same `extras.gltfi` convention, one level over rather than one level
   * down.
   */
  function handleMoveNode(nodeIndex: number, x: number, y: number) {
    if (!mapped) return;
    const node = findMappedNode(mapped, nodeIndex);
    if (!node) return;
    const entity = identifyMappedNode(node);
    if (entity.type === "node") {
      dispatchCommand(AudioGraphEdit.setNodePosition(document, graphIndex, entity.rawIndex, x, y));
    } else if (entity.type === "source") {
      dispatchCommand(SceneEdit.setAudioSourceProperty(document, entity.sourceIndex, ["extras", "gltfi"], { x, y }));
    } else {
      dispatchCommand(SceneEdit.setAudioEmitterProperty(document, entity.emitterIndex, ["extras", "gltfi"], { x, y }));
    }
  }

  function handleSetParam(rawIndex: number, key: string, value: unknown) {
    dispatchCommand(AudioGraphEdit.setNodeParam(document, graphIndex, rawIndex, key, value));
  }

  /** UX-616: the node's top-level `bypass` field (distinct from `params` — `AudioGraphEdit.setNodeBypass`, DOC-063). */
  function handleSetBypass(rawIndex: number, value: boolean) {
    dispatchCommand(AudioGraphEdit.setNodeBypass(document, graphIndex, rawIndex, value));
  }

  const graphViewProps: Omit<GraphViewProps, "graph"> = {
    selectedNodeIndex,
    onSelectNode,
    diagnosticsByNode,
    testHookKey: "__gltfStudioAudioGraphCanvasTest",
    onLiteralCommit: () => undefined, // UX-605: no editable value-socket literals on this canvas — params are edited via AudioParamPanel instead
    onPointerTextClick: () => undefined, // UX-606: no pointer-category nodes on this canvas
    onPointerIconClick: () => undefined,
    onConnectValue: handleConnectValue,
    onConnectFlow: () => undefined, // UX-605: no flow ports on this canvas
    onConnectRejected: handleConnectRejected,
    onDisconnectEdge: handleDisconnectEdge,
    onRemoveNodes: handleRemoveNodes,
    onMoveNode: handleMoveNode,
    onDropOp: (kind) => handleAddNode(kind),
    onCreateFromDrop: () => undefined // no scene-tree/animation-clip drop target on this canvas
  };

  const selectedNode = mapped?.nodes.find((n) => n.index === selectedNodeIndex) ?? null;
  const selectedEntity = selectedNode ? identifyMappedNode(selectedNode) : null;
  const selectedRawIndex = selectedEntity?.type === "node" ? selectedEntity.rawIndex : null;
  const selectedRawNode = selectedRawIndex !== null && graph ? graph.nodes[selectedRawIndex] : null;

  const hasErrors = errorCount > 0;
  const auditionTargets = graph?.outputs ?? [];
  function handleAudition() {
    if (!host || !graph) return;
    for (const output of auditionTargets) {
      const label = graph.nodes[output.node]?.label ?? `node_${output.node}`;
      host.audition(label);
    }
  }

  return (
    <div className="acanvas-root" data-testid="acanvas.root">
      <div className="acanvas-toolbar">
        <button
          type="button"
          className="acanvas-audition"
          data-testid="acanvas.audition"
          disabled={!host || !graph || auditionTargets.length === 0 || hasErrors}
          title={hasErrors ? "Fix lint errors before auditioning this graph." : "Play this graph's output through your speakers."}
          onClick={handleAudition}
        >
          ▶ Audition
        </button>
      </div>
      {violations.length > 0 ? (
        <div className="acanvas-lint-banner" data-testid="acanvas.lint-banner" role="alert">
          {violations.map((violation, i) => (
            <div key={i} className={`acanvas-lint-row acanvas-lint-${violation.severity}`} data-testid={`acanvas.lint-row.${i}`}>
              {violation.message}
            </div>
          ))}
        </div>
      ) : null}
      <div className="acanvas-body">
        <AudioPalettePanel onAddNode={handleAddNode} />
        {mapped ? (
          <GraphView graph={mapped} {...graphViewProps} />
        ) : (
          <div className="acanvas-empty-state" data-testid="acanvas.empty">
            <p>No KHR_audio_graph extension on this document. Add a node from the palette to start one.</p>
          </div>
        )}
        {mapped ? (
          <div className="acanvas-details">
            <NodeDetails
              graph={mapped}
              selectedNode={selectedNode}
              collapsed={false}
              onToggleCollapsed={() => undefined}
              diagnosticsByNode={diagnosticsByNode}
              unindexedDiagnostics={[]}
            />
            {selectedRawNode && selectedRawIndex !== null ? (
              <AudioParamPanel
                // Remounts (resetting CurveField/PeriodicWaveField's local
                // uncommitted-text state, audio-param-panel.tsx's own doc
                // comment) whenever the SELECTED node changes, rather than
                // updating in place with a stale previous node's in-progress
                // curve text.
                key={selectedRawIndex}
                kind={selectedRawNode.kind}
                params={selectedRawNode.params ?? {}}
                onSetParam={(key, value) => handleSetParam(selectedRawIndex, key, value)}
                bypass={selectedRawNode.bypass ?? false}
                onSetBypass={(value) => handleSetBypass(selectedRawIndex, value)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div style={{ display: "none" }} data-testid="acanvas.summary">
        {`errors:${errorCount} warnings:${warningCount}`}
      </div>
    </div>
  );
}
