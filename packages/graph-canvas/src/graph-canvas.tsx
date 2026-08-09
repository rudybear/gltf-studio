// Top-level behavior-graph canvas component (specs/ux-graph-canvas.md):
// reads the raw KHR_interactivity graph out of `document.json`, maps it
// (map-graph.ts), and wires the palette/canvas/details three-pane layout
// together with full editing — every edit gesture GraphView/PalettePanel
// report is translated here into a GraphEdit (or graph-edit-ext/ensure-graph)
// Command and handed to `dispatchCommand`; this is the ONLY module in the
// package that calls those command factories.
import { useEffect, useMemo, useRef, useState } from "react";
import { GraphEdit, applyPatches, getIn, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import type { ValueType } from "@gltfi/kernel";
import { mapGraph, type InteractivityGraph, type MappedGraph } from "./map-graph.js";
import { GraphView } from "./graph-view.js";
import { PalettePanel } from "./palette-panel.js";
import { NodeDetails } from "./node-details.js";
import { validateInteractivityGraph, type ValidationResult } from "./validation.js";
import { setLiteralValue } from "./graph-edit-ext.js";
import { ensureGraphScaffold } from "./ensure-graph.js";

const VALIDATION_DEBOUNCE_MS = 300;

const EMPTY_VALIDATION: ValidationResult = { ok: true, diagnostics: [], byNodeIndex: new Map(), unindexed: [] };

export type GraphCanvasProps = {
  document: EditorDocument;
  /** Which `extensions.KHR_interactivity.graphs[N]` to show/edit. Defaults to 0. */
  graphIndex?: number;
  dispatchCommand: (command: Command) => void;
  selectedNodeIndex: number | null;
  onSelectNode: (index: number | null) => void;
  onLog?: (level: "info" | "warn" | "error", text: string) => void;
  onToast?: (text: string) => void;
  onAskCopilot?: () => void;
};

export function GraphCanvas({
  document,
  graphIndex = 0,
  dispatchCommand,
  selectedNodeIndex,
  onSelectNode,
  onLog,
  onToast,
  onAskCopilot
}: GraphCanvasProps): JSX.Element {
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [validation, setValidation] = useState<ValidationResult>(EMPTY_VALIDATION);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoggedKey = useRef<string>("");

  const graphs = getIn(document.json, ["extensions", "KHR_interactivity", "graphs"]) as unknown[] | undefined;
  const hasGraph = graphs !== undefined && graphs.length > graphIndex;
  const rawGraph = hasGraph ? (graphs![graphIndex] as InteractivityGraph) : undefined;

  const mapped: MappedGraph | null = useMemo(() => (rawGraph ? mapGraph(rawGraph, graphIndex) : null), [rawGraph, graphIndex]);

  // UX-506: validation runs debounced on graph changes, joined by node index.
  useEffect(() => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
    if (!rawGraph) {
      setValidation(EMPTY_VALIDATION);
      return;
    }
    validationTimer.current = setTimeout(() => {
      const result = validateInteractivityGraph(rawGraph);
      setValidation(result);
      const errorKey = result.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => `${d.nodeIndex ?? "-"}:${d.code}`)
        .sort()
        .join(",");
      if (errorKey !== lastLoggedKey.current) {
        lastLoggedKey.current = errorKey;
        if (errorKey) {
          const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;
          onLog?.("error", `Behavior graph ${graphIndex}: ${errorCount} validation error(s) — see the graph canvas for details.`);
        }
      }
    }, VALIDATION_DEBOUNCE_MS);
    return () => {
      if (validationTimer.current) clearTimeout(validationTimer.current);
    };
  }, [rawGraph, graphIndex]);

  function resolveTargetDocumentAndGraphIndex(): { workingDocument: EditorDocument; index: number } {
    if (hasGraph) return { workingDocument: document, index: graphIndex };
    const scaffold = ensureGraphScaffold(document);
    if (scaffold.command) dispatchCommand(scaffold.command);
    return { workingDocument: scaffold.documentAfter, index: scaffold.graphIndex };
  }

  function handleAddNode(op: string, position?: { x: number; y: number }) {
    const { workingDocument, index } = resolveTargetDocumentAndGraphIndex();
    // Cascade a small offset per existing node so repeated click-to-add
    // (no drop point available) doesn't stack every new node exactly on
    // top of the last one.
    const existingCount = (getIn(workingDocument.json, ["extensions", "KHR_interactivity", "graphs", index, "nodes"]) as unknown[] | undefined)?.length ?? 0;
    const fallbackPosition = { x: 40 + (existingCount % 6) * 24, y: 40 + (existingCount % 6) * 24 };
    const command = GraphEdit.addNode(workingDocument, index, op, { position: position ?? fallbackPosition });
    dispatchCommand(command);
    onSelectNode(existingCount);
  }

  function handleConnectValue(nodeIndex: number, socket: string, sourceNode: number, sourceSocket: string) {
    dispatchCommand(GraphEdit.connectValue(document, graphIndex, nodeIndex, socket, sourceNode, sourceSocket));
  }

  function handleConnectFlow(fromNode: number, fromSocket: string, toNode: number, toSocket: string) {
    dispatchCommand(GraphEdit.connectFlow(document, graphIndex, fromNode, fromSocket, toNode, toSocket));
  }

  function handleConnectRejected(reason: string) {
    onToast?.(`Connection rejected: ${reason}`);
    onLog?.("warn", `Behavior graph ${graphIndex}: rejected connection — ${reason}`);
  }

  function handleDisconnectEdge(nodeIndex: number, socket: string, kind: "value" | "flow") {
    dispatchCommand(GraphEdit.disconnect(document, graphIndex, nodeIndex, socket, kind));
  }

  function handleRemoveNodes(nodeIndices: number[]) {
    // Removed in descending index order, threading the JSON locally between
    // dispatches: each dispatchCommand only updates the app store's document
    // on its NEXT render, so computing every removal in this same
    // synchronous handler against a shared, locally-advanced copy is what
    // keeps fixupReferences (DOC-019) correct for a multi-select delete.
    const sorted = [...new Set(nodeIndices)].sort((a, b) => b - a);
    let working = document;
    for (const nodeIndex of sorted) {
      const command = GraphEdit.removeNode(working, graphIndex, nodeIndex);
      dispatchCommand(command);
      working = { ...working, json: applyPatches(working.json, command.patches) };
    }
    if (selectedNodeIndex !== null && sorted.includes(selectedNodeIndex)) {
      onSelectNode(null);
    }
  }

  function handleMoveNode(nodeIndex: number, x: number, y: number) {
    dispatchCommand(GraphEdit.setNodePosition(document, graphIndex, nodeIndex, x, y));
  }

  function handleLiteralCommit(nodeIndex: number, socket: string, type: ValueType, value: Array<number | boolean | string>) {
    dispatchCommand(setLiteralValue(document, graphIndex, nodeIndex, socket, type, value));
  }

  function handlePointerTextClick(nodeIndex: number) {
    // UX-509 (Data-tab jump on pointer config text click) is out of scope
    // for this package — it reaches into the Data tab, owned elsewhere.
    onLog?.("info", `Pointer node ${nodeIndex}: jump-to-Data-tab is not wired yet (UX-509).`);
  }

  function handlePointerIconClick(nodeIndex: number) {
    // UX-509's pointer-picker dialog (specs/ux-pointer-picker.md) likewise
    // out of scope here — stubbed so the two click targets stay structurally
    // distinct (UX-505/UX-508) without faking functionality that isn't wired.
    onLog?.("info", `Pointer node ${nodeIndex}: retarget dialog is not wired yet (UX-509).`);
  }

  const selectedNode = mapped?.nodes.find((n) => n.index === selectedNodeIndex) ?? null;

  return (
    <div className="gcanvas-root" data-testid="gcanvas.root">
      <PalettePanel onAddNode={(op) => handleAddNode(op)} onAskCopilot={onAskCopilot} />
      {mapped ? (
        <GraphView
          graph={mapped}
          selectedNodeIndex={selectedNodeIndex}
          onSelectNode={onSelectNode}
          diagnosticsByNode={validation.byNodeIndex}
          onLiteralCommit={handleLiteralCommit}
          onPointerTextClick={handlePointerTextClick}
          onPointerIconClick={handlePointerIconClick}
          onConnectValue={handleConnectValue}
          onConnectFlow={handleConnectFlow}
          onConnectRejected={handleConnectRejected}
          onDisconnectEdge={handleDisconnectEdge}
          onRemoveNodes={handleRemoveNodes}
          onMoveNode={handleMoveNode}
          onDropOp={handleAddNode}
        />
      ) : (
        <div className="gcanvas-empty-state" data-testid="gcanvas.empty">
          <p>No interactivity graph — add the first node from the palette to get started.</p>
        </div>
      )}
      {mapped ? (
        <NodeDetails
          graph={mapped}
          selectedNode={selectedNode}
          collapsed={detailsCollapsed}
          onToggleCollapsed={() => setDetailsCollapsed((v) => !v)}
          diagnosticsByNode={validation.byNodeIndex}
          unindexedDiagnostics={validation.unindexed}
        />
      ) : null}
    </div>
  );
}
