// Top-level audio-graph canvas component (specs/ux-audio-graph.md): reads
// the raw KHR_audio_graph graph out of the document JSON, maps it
// (map-audio-graph.ts), and renders it through @gltf-studio/graph-canvas's
// SHARED GraphView + NodeDetails (UX-600) plus a lint banner (UX-602) above
// the canvas.
//
// READ-ONLY IN V1 (UX-604: no node-creation palette either): every
// GraphView editing callback below reports the gesture up via `onToast`/
// `onLog` rather than dispatching a command — see this package's README
// note (and the M7 PR description) for why an `AudioGraphEdit` command
// factory did not land: `KHR_audio_graph`'s document-level JSON shape would
// map cleanly onto editor-core's patch model in principle, but wiring real
// add-node/connect commands through GraphEdit-equivalent machinery, plus
// the synthetic source/emitter terminal nodes this projection introduces
// (map-audio-graph.ts's doc comment) needing their OWN non-trivial
// edit semantics (what does "connect a new node to the emitter terminal"
// even mean structurally — insert into `graph.outputs[]` and rewire the
// previous producer?), was judged to exceed this milestone's scope. Node
// selection/details (this component) and the lint banner are real.
import { useMemo } from "react";
import { GraphView, NodeDetails, type GraphViewProps } from "@gltf-studio/graph-canvas";
import type { AudioGraphLintResult } from "@gltf-studio/engine-api";
import type { KHRGraph, AudioEmitter } from "audio-graph-js";
import { mapAudioGraph } from "./map-audio-graph.js";

export interface AudioGraphCanvasProps {
  /** `extensions.KHR_audio_graph.graphs[N]`, or `undefined` when the document has none (AGH-001's "reports empty gracefully"). */
  graph: KHRGraph | undefined;
  graphIndex?: number;
  /** `extensions.KHR_audio_emitter.emitters`, for the terminal emitter node's display name (UX-607). */
  emitters?: AudioEmitter[];
  /** AudioGraphHost.lint()'s current results for this document. */
  lintResults: AudioGraphLintResult[];
  selectedNodeIndex: number | null;
  onSelectNode: (index: number | null) => void;
  onToast?: (text: string) => void;
}

const NOT_EDITABLE_MESSAGE = "Audio-graph editing isn't available yet — v1 is read-only (selection/details + lint only).";

export function AudioGraphCanvas({
  graph,
  graphIndex = 0,
  emitters = [],
  lintResults,
  selectedNodeIndex,
  onSelectNode,
  onToast
}: AudioGraphCanvasProps): JSX.Element {
  const mapped = useMemo(
    () => (graph ? mapAudioGraph(graph, graphIndex, emitters, lintResults) : null),
    [graph, graphIndex, emitters, lintResults]
  );

  const violations = lintResults.filter((r) => r.graphIndex === graphIndex || r.graphIndex === -1);
  const errorCount = violations.filter((v) => v.severity === "error").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;

  const notEditable = () => onToast?.(NOT_EDITABLE_MESSAGE);

  const graphViewProps: Omit<GraphViewProps, "graph"> = {
    selectedNodeIndex,
    onSelectNode,
    diagnosticsByNode: new Map(),
    onLiteralCommit: () => notEditable(),
    onPointerTextClick: () => notEditable(),
    onPointerIconClick: () => notEditable(),
    onConnectValue: () => notEditable(),
    onConnectFlow: () => notEditable(),
    onConnectRejected: () => notEditable(),
    onDisconnectEdge: () => notEditable(),
    onRemoveNodes: () => notEditable(),
    onMoveNode: () => notEditable(),
    onDropOp: () => notEditable(),
    onCreateFromDrop: () => notEditable()
  };

  const selectedNode = mapped?.nodes.find((n) => n.index === selectedNodeIndex) ?? null;

  return (
    <div className="acanvas-root" data-testid="acanvas.root">
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
        {mapped ? (
          <GraphView graph={mapped} {...graphViewProps} />
        ) : (
          <div className="acanvas-empty-state" data-testid="acanvas.empty">
            <p>No KHR_audio_graph extension on this document.</p>
          </div>
        )}
        {mapped ? (
          <NodeDetails
            graph={mapped}
            selectedNode={selectedNode}
            collapsed={false}
            onToggleCollapsed={() => undefined}
            diagnosticsByNode={new Map()}
            unindexedDiagnostics={[]}
          />
        ) : null}
      </div>
      <div style={{ display: "none" }} data-testid="acanvas.summary">
        {`errors:${errorCount} warnings:${warningCount}`}
      </div>
    </div>
  );
}
