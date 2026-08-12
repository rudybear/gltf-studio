// React Flow canvas for one MappedGraph (specs/ux-graph-canvas.md UX-503,
// UX-506, UX-507, UX-510, plus this task's editing bullets): ELK layout is
// computed off the UI thread by layout-engine.ts; a node's rendered
// position is its authored `extras.gltfi.{x,y}` (DOC-027) when present,
// falling back to the ELK-computed position otherwise (UX-510 — the canvas
// never derives layout from an ephemeral, editor-only store). Reports every
// edit gesture (connect/disconnect/delete/drag/drop) up to graph-canvas.tsx,
// which owns translating them into GraphEdit commands — this component
// itself never calls GraphEdit directly.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnConnect
} from "@xyflow/react";
import type { MappedGraph, MappedNode } from "./map-graph.js";
import { OpNode, type DocNames, type LiteralCommit, type OpNodeData, type OpNodeType } from "./op-node.js";
import { buildElkGraph, type LayoutPositions } from "./elk-layout.js";
import { categoryColor, typeColor } from "./palette.js";
import { LayoutEngine, type LayoutEngineMode } from "./layout-engine.js";
import { validateConnection } from "./validate-connection.js";
import type { GraphDiagnostic } from "./validation.js";
import { OP_DRAG_MIME } from "./palette-panel.js";
import { DropMenu, type DropKind } from "./drop-menu.js";

const nodeTypes = { op: OpNode };

/**
 * specs/ux-scene-tree.md UX-209 / specs/ux-graph-canvas.md UX-508: the
 * `dataTransfer` MIME types a scene-tree row / Animations-tab clip row drag
 * carries (mirroring docs/ux/mockups/mockup-v5.html's own
 * `application/x-scenenode`/`application/x-animclip`) — exported so the
 * app package's SceneTree/AssetBrowser drag SOURCES use the exact same
 * strings this canvas's drop TARGET checks for.
 */
export const SCENE_NODE_DRAG_MIME = "application/x-scenenode";
export const ANIM_CLIP_DRAG_MIME = "application/x-animclip";

type PendingExternalDrop = { kind: DropKind; refId: number; flowPosition: { x: number; y: number }; screenPosition: { x: number; y: number } };

export interface GraphCanvasTestHook {
  setViewport(viewport: { x: number; y: number; zoom: number }): void;
  /**
   * Invokes the SAME `onConnect` handler a real handle-to-handle drag
   * triggers, bypassing raw pixel mouse choreography. Mirrors
   * Viewport.tsx's `simulateGizmoDrag` seam and its documented rationale
   * (e2e/viewport.spec.ts's header comment): React Flow's own connection-
   * drag hit-testing depends on its internal zoom/viewport state in ways
   * that made a handle-to-handle Playwright mouse drag measurably flaky in
   * this compact dock panel across otherwise-identical runs, for
   * comparatively little extra coverage over exercising this handler
   * directly — every bit of REAL application logic downstream of a connect
   * (validateConnection, GraphEdit.connectValue/connectFlow, dispatchCommand)
   * still runs; only the physical pointer input is synthesized.
   */
  simulateConnect(connection: { source: string; sourceHandle: string; target: string; targetHandle: string }): void;
  /**
   * specs/ux-graph-canvas.md UX-508: opens the SAME drop-menu a real HTML5
   * drag-drop of a scene-tree row / Animations-tab clip triggers, at a fixed
   * canvas position — same rationale as `simulateConnect` above: raw
   * `DragEvent`/`DataTransfer` synthesis over Playwright's CDP bridge is the
   * flaky part, not anything this app's own code does with it. The
   * subsequent drop-menu OPTION CLICK stays a real Playwright click against
   * the real rendered `gcanvas.drop-menu.*` button — only the drag gesture
   * itself is synthesized.
   */
  simulateExternalDrop(kind: DropKind, refId: number, flowPosition: { x: number; y: number }): void;
}

declare global {
  interface Window {
    __gltfStudioGraphCanvasTest?: GraphCanvasTestHook;
  }
}

function portNameFromId(portId: string): string {
  const i = portId.indexOf(":");
  return i === -1 ? portId : portId.slice(i + 1);
}

function nodePosition(node: MappedNode, elkPositions: LayoutPositions | null): { x: number; y: number; width: number; height: number } {
  const authored = (node.raw as { extras?: { gltfi?: { x: number; y: number } } }).extras?.gltfi;
  const fallback = elkPositions?.[node.index] ?? { x: 0, y: 0, width: 180, height: 60 };
  return authored ? { x: authored.x, y: authored.y, width: fallback.width, height: fallback.height } : fallback;
}

export type GraphViewProps = {
  graph: MappedGraph;
  selectedNodeIndex: number | null;
  onSelectNode: (index: number | null) => void;
  diagnosticsByNode: Map<number, GraphDiagnostic[]>;
  onLiteralCommit: LiteralCommit;
  onPointerTextClick: (nodeIndex: number) => void;
  onPointerIconClick: (nodeIndex: number) => void;
  onConnectValue: (nodeIndex: number, socket: string, sourceNode: number, sourceSocket: string) => void;
  onConnectFlow: (fromNode: number, fromSocket: string, toNode: number, toSocket: string) => void;
  onConnectRejected: (reason: string) => void;
  onDisconnectEdge: (nodeIndex: number, socket: string, kind: "value" | "flow") => void;
  onRemoveNodes: (nodeIndices: number[]) => void;
  onMoveNode: (nodeIndex: number, x: number, y: number) => void;
  onDropOp: (op: string, position: { x: number; y: number }) => void;
  /** UX-508: a drop-menu option was chosen for an externally-dragged scene node/animation clip. */
  onCreateFromDrop: (kind: DropKind, refId: number, optionKey: string, position: { x: number; y: number }) => void;
  onRendered?: (info: { nodeCount: number; layout: LayoutEngineMode }) => void;
  /**
   * UX-1107 (specs/ux-usage-mapping.md): a programmatic "center the canvas
   * on this node" request from OUTSIDE the canvas (the Inspector's "Used in
   * behavior" → Graph jump has no other way to reach a node that isn't
   * already on-screen) — same cross-component-signal shape as
   * `packages/app`'s own `frameRequest` (a bumped `seq` so re-requesting
   * the SAME node twice in a row still re-triggers the effect below).
   */
  focusRequest?: { nodeIndex: number; seq: number } | null;
  /** Task ("handler nodes show their target"): scene-node/animation name lookups for OpNode's target chip + clip-name row — see op-node.ts's `DocNames` doc comment. Omitted by `@gltf-studio/audio-canvas`'s reuse of this component (no document-level scene/animation concept there). */
  docNames?: DocNames;
  /** The target chip's click handler — selects the resolved scene node, same store action a scene-tree row click makes. Omitted (chip renders inert) when the host has no scene selection to drive. */
  onTargetChipClick?: (sceneNodeIndex: number) => void;
};

function GraphViewInner(props: GraphViewProps) {
  const { graph, selectedNodeIndex, onSelectNode, diagnosticsByNode, onLiteralCommit, onPointerTextClick, onPointerIconClick } = props;
  const { onConnectValue, onConnectFlow, onConnectRejected, onDisconnectEdge, onRemoveNodes, onMoveNode, onDropOp, onCreateFromDrop, onRendered, focusRequest } = props;
  const { docNames, onTargetChipClick } = props;

  const engineRef = useRef<LayoutEngine | null>(null);
  const [elkPositions, setElkPositions] = useState<LayoutPositions | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutEngineMode>("elk");
  const [nodes, setNodes, onNodesChange] = useNodesState<OpNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [pendingDrop, setPendingDrop] = useState<PendingExternalDrop | null>(null);
  const reactFlow = useReactFlow();
  // Always-current handler ref so the test-hook effect below (installed
  // once) never closes over a stale `handleConnect` from an earlier render.
  const handleConnectRef = useRef<OnConnect>(() => {});

  // Bug fix (hidden-mount `fitView`, same class as the Script tab's Monaco
  // sizing bug — see specs/ux-shell.md's follow-up note): BottomDock.tsx
  // keeps the Behavior graph tab's whole subtree permanently mounted, only
  // `display: none`-hiding it while another dock tab is active (UX-103's
  // "don't reset the tab being left" contract). `<ReactFlow fitView>`
  // computes its initial fit ONCE, synchronously on this component's first
  // real layout pass — if that pass happens to land while the container is
  // `display: none` (e.g. a document is imported/re-imported while parked
  // on the Data or Script tab), it fits against a 0x0 box, leaving the
  // canvas permanently zoomed/positioned wrong even after the tab becomes
  // visible (nodes rendered pinned to one corner at the wrong scale).
  // `ReactFlow`'s own internal pane ResizeObserver repositions the SVG
  // viewBox on later size changes but never re-runs `fitView` itself, so
  // this doesn't self-heal.
  //
  // Fix: watch this component's own root for its first-ever NON-zero size
  // and re-run `fitView()` at that point — deliberately gated to fire at
  // most once (`didInitialRealFitRef`), not on every subsequent resize/
  // show, so a later legitimate tab-away-and-back (where the container was
  // already sized correctly before hiding) does NOT reset the user's own
  // pan/zoom — that would silently violate UX-103's own "graph canvas
  // scroll position" example of state a tab switch must preserve. When the
  // very first layout already happened at a real size (the common case:
  // the graph tab is active when a document loads), this still fires once
  // and simply re-applies the same already-correct fit — a harmless no-op
  // rerun, not a visible change.
  // A callback ref (not a plain useRef) on purpose: the component returns
  // an ELK-pending placeholder `<div>` (below) until `elkPositions`
  // resolves, so the real `.gcanvas-canvas-inner` node this observer needs
  // doesn't exist during this component's first render(s) — a plain
  // `useRef` + a `[reactFlow]`-only effect would attach its observer too
  // early (against a null ref) and never retry once the real node mounts.
  // Tracking the node in state instead makes the effect below re-run
  // exactly when that node actually appears.
  const [canvasRootEl, setCanvasRootEl] = useState<HTMLDivElement | null>(null);
  const didInitialRealFitRef = useRef(false);
  useEffect(() => {
    if (!canvasRootEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      if (didInitialRealFitRef.current) return;
      const { width, height } = entries[0].contentRect;
      if (width > 1 && height > 1) {
        didInitialRealFitRef.current = true;
        reactFlow.fitView();
      }
    });
    observer.observe(canvasRootEl);
    return () => observer.disconnect();
  }, [canvasRootEl, reactFlow]);

  // UX-1107: an external focus request (Inspector "→ Graph" jump) pans/
  // zooms the canvas to the requested node, same as clicking it would
  // visually center it — but without changing selection itself (the
  // caller already calls `onSelectNode` separately; this effect only
  // handles the "isn't already on-screen" half a plain selection-state
  // change can't do on its own, see graph-canvas.tsx's `NodeDetails`
  // still opening from selection alone regardless of this effect).
  useEffect(() => {
    if (!focusRequest) return;
    reactFlow.fitView({ nodes: [{ id: String(focusRequest.nodeIndex) }], duration: 400, maxZoom: 1.2 });
  }, [focusRequest, reactFlow]);

  // One long-lived LayoutEngine for the mounted GraphView's whole lifetime.
  useEffect(() => {
    const engine = new LayoutEngine({
      onResult: (_graphIndex, positions) => {
        setLayoutError(null);
        setElkPositions(positions);
      },
      onError: (_graphIndex, message) => setLayoutError(message),
      onModeChange: (mode) => setLayoutMode(mode)
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Re-run ELK whenever the graph's node/edge SHAPE changes (node count,
  // port layout) — not on every position tweak, since ELK output is only
  // ever used as a fallback for nodes lacking an authored position anyway.
  const layoutSignature = useMemo(
    () => JSON.stringify({ n: graph.nodes.map((n) => ({ i: n.index, p: n.ports.map((p) => p.id) })), e: graph.edges.map((e) => e.id) }),
    [graph]
  );
  useEffect(() => {
    const elkGraph = buildElkGraph(graph);
    engineRef.current?.requestLayout(graph.graphIndex, elkGraph);
  }, [layoutSignature]);

  const connectedValueInPorts = useMemo(() => {
    const byNode = new Map<number, Set<string>>();
    for (const edge of graph.edges) {
      if (edge.kind !== "value") continue;
      let set = byNode.get(edge.targetNode);
      if (!set) {
        set = new Set();
        byNode.set(edge.targetNode, set);
      }
      set.add(edge.targetPort);
    }
    return byNode;
  }, [graph]);

  useEffect(() => {
    const rfNodes: OpNodeType[] = graph.nodes.map((node) => {
      const pos = nodePosition(node, elkPositions);
      const data: OpNodeData = {
        node,
        connectedValueInPorts: connectedValueInPorts.get(node.index) ?? new Set(),
        diagnostics: diagnosticsByNode.get(node.index) ?? [],
        onLiteralCommit,
        onPointerTextClick,
        onPointerIconClick,
        docNames,
        onTargetChipClick
      };
      return {
        id: String(node.index),
        type: "op",
        position: { x: pos.x, y: pos.y },
        style: { width: pos.width, minHeight: pos.height },
        data,
        selected: node.index === selectedNodeIndex,
        deletable: true,
        connectable: true
      };
    });

    const rfEdges: Edge[] = graph.edges.map((edge) => ({
      id: edge.id,
      source: String(edge.sourceNode),
      sourceHandle: edge.sourcePort,
      target: String(edge.targetNode),
      targetHandle: edge.targetPort,
      deletable: true,
      focusable: true,
      selectable: true,
      animated: edge.kind === "flow",
      style: {
        stroke: edge.kind === "flow" ? "var(--gcanvas-flow-color, #e0a458)" : typeColor(edge.type),
        strokeWidth: edge.kind === "flow" ? 2.5 : 1.5,
        // UX-603 (audio-graph canvas): an edge lint flags stays at its normal
        // geometric position with a dashed stroke, never hidden/omitted.
        // Always undefined (no dash) for the behavior-graph canvas, whose
        // `MappedEdge`s never set `invalid`.
        strokeDasharray: edge.invalid ? "6 4" : undefined
      },
      data: { kind: edge.kind, targetNode: edge.targetNode, targetPort: edge.targetPort }
    }));

    setNodes(rfNodes);
    setEdges(rfEdges);
    onRendered?.({ nodeCount: graph.nodeCount, layout: layoutMode });
    // `docNames` (scene-node/animation names) can change WITHOUT `graph`
    // itself changing (e.g. renaming a scene node elsewhere in the editor
    // never touches this graph's own JSON) — included explicitly so a
    // handler's target chip / animation clip-name row never goes stale.
  }, [graph, elkPositions, diagnosticsByNode, connectedValueInPorts, selectedNodeIndex, docNames, onTargetChipClick]);

  const nodeColor = useMemo(
    () => (n: Node) => {
      const data = n.data as OpNodeData | undefined;
      return data ? categoryColor(data.node.category) : "#8a8a8a";
    },
    []
  );

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    onSelectNode(Number(node.id));
  };

  const handleNodeDragStop = (_event: MouseEvent | TouchEvent, node: OpNodeType) => {
    onMoveNode(Number(node.id), Math.round(node.position.x), Math.round(node.position.y));
  };

  const findPort = (nodeIndex: number, portId: string | null | undefined) => {
    if (!portId) return undefined;
    return graph.nodes.find((n) => n.index === nodeIndex)?.ports.find((p) => p.id === portId);
  };

  const handleConnect: OnConnect = (connection: Connection) => {
    const sourceIndex = Number(connection.source);
    const targetIndex = Number(connection.target);
    const sourcePort = findPort(sourceIndex, connection.sourceHandle);
    const targetPort = findPort(targetIndex, connection.targetHandle);
    if (!sourcePort || !targetPort) {
      onConnectRejected("Could not resolve one of the connection's ports.");
      return;
    }
    const result = validateConnection(sourcePort, targetPort);
    if (!result.ok) {
      onConnectRejected(result.reason);
      return;
    }
    if (sourcePort.kind === "flow-out") {
      onConnectFlow(sourceIndex, portNameFromId(sourcePort.id), targetIndex, portNameFromId(targetPort.id));
    } else {
      onConnectValue(targetIndex, portNameFromId(targetPort.id), sourceIndex, portNameFromId(sourcePort.id));
    }
  };
  handleConnectRef.current = handleConnect;

  // Test-only seam (no UX-### requirement covers it — same pattern as the
  // app's own `window.__gltfStudioTest` for the 3D viewport, see
  // `GraphCanvasTestHook`'s doc comment above for the `simulateConnect`
  // rationale). Installed once; both methods read current state via refs/
  // the live `reactFlow` instance, never a stale render's closure.
  useEffect(() => {
    window.__gltfStudioGraphCanvasTest = {
      setViewport: (v) => reactFlow.setViewport(v),
      simulateConnect: (connection) => handleConnectRef.current(connection),
      simulateExternalDrop: (kind, refId, flowPosition) => {
        const screen = reactFlow.flowToScreenPosition(flowPosition);
        setPendingDrop({ kind, refId, flowPosition, screenPosition: screen });
      }
    };
    return () => {
      delete window.__gltfStudioGraphCanvasTest;
    };
  }, [reactFlow]);

  // Combines the node- and edge-delete decision into ONE callback (rather
  // than React Flow's separate onNodesDelete/onEdgesDelete, which both fire
  // for a single Delete-key press whenever a deleted node's own edges cascade
  // along with it): deleting a node already implies its edges' references
  // vanish with it (removeNode's own fixupReferences pass, DOC-019), so a
  // cascade edge must NOT also get an independent `disconnect` call against
  // a node that's about to be removed anyway — only a standalone edge
  // deletion (neither endpoint's node is also being deleted) should.
  const handleBeforeDelete = async ({ nodes: deletingNodes, edges: deletingEdges }: { nodes: Node[]; edges: Edge[] }): Promise<boolean> => {
    const deletingNodeIds = new Set(deletingNodes.map((n) => n.id));
    for (const edge of deletingEdges) {
      if (deletingNodeIds.has(edge.source) || deletingNodeIds.has(edge.target)) continue;
      const data = edge.data as { kind: "value" | "flow"; targetNode: number; targetPort: string } | undefined;
      if (!data) continue;
      onDisconnectEdge(data.targetNode, portNameFromId(data.targetPort), data.kind);
    }
    if (deletingNodes.length > 0) {
      onRemoveNodes(deletingNodes.map((n) => Number(n.id)));
    }
    // graph-canvas.tsx re-derives `nodes`/`edges` from the next `graph` prop
    // once its dispatched command(s) land — React Flow's own local removal
    // (this return value allows it to proceed) is harmless in the meantime.
    return true;
  };

  const handleDrop: React.DragEventHandler = (event) => {
    event.preventDefault();
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const flowPosition = { x: Math.round(position.x), y: Math.round(position.y) };

    const op = event.dataTransfer.getData(OP_DRAG_MIME);
    if (op) {
      onDropOp(op, flowPosition);
      return;
    }
    const sceneNode = event.dataTransfer.getData(SCENE_NODE_DRAG_MIME);
    if (sceneNode) {
      setPendingDrop({ kind: "node", refId: Number(sceneNode), flowPosition, screenPosition: { x: event.clientX, y: event.clientY } });
      return;
    }
    const animClip = event.dataTransfer.getData(ANIM_CLIP_DRAG_MIME);
    if (animClip) {
      setPendingDrop({ kind: "anim", refId: Number(animClip), flowPosition, screenPosition: { x: event.clientX, y: event.clientY } });
    }
  };

  const handleDragOver: React.DragEventHandler = (event) => {
    const types = event.dataTransfer.types;
    if (types.includes(OP_DRAG_MIME) || types.includes(SCENE_NODE_DRAG_MIME) || types.includes(ANIM_CLIP_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  function handleDropMenuChoose(optionKey: string) {
    if (!pendingDrop) return;
    onCreateFromDrop(pendingDrop.kind, pendingDrop.refId, optionKey, pendingDrop.flowPosition);
    setPendingDrop(null);
  }

  if (layoutError && !elkPositions) {
    return <div className="gcanvas-layout-pending gcanvas-layout-error">Layout failed: {layoutError}</div>;
  }
  if (!elkPositions) {
    return <div className="gcanvas-layout-pending">Laying out {graph.nodeCount} nodes…</div>;
  }

  return (
    <div className="gcanvas-canvas-inner" ref={setCanvasRootEl} onDrop={handleDrop} onDragOver={handleDragOver} data-testid="gcanvas.canvas">
      {layoutMode === "fallback" ? (
        <div className="gcanvas-banner gcanvas-banner-warning gcanvas-canvas-overlay-banner">
          Layout worker unavailable — laid out on the main thread instead. The graph is fully usable; layout may be slower to update for
          very large graphs.
        </div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => onSelectNode(null)}
        onConnect={handleConnect}
        onBeforeDelete={handleBeforeDelete}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        minZoom={0.05}
        connectionRadius={40}
        nodeClickDistance={5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {/* `pointer-events: none` (graph-canvas.css) — a fixed-corner overlay
            with real hit-testing reliably ends up on top of a port handle for
            small graphs in the dock's compact height, stealing the mouseup a
            handle-to-handle connect/disconnect drag needs (found building
            this canvas's e2e coverage — a real hazard for users too, not just
            tests). Kept for its overview value; not pannable/zoomable/clickable. */}
        <MiniMap nodeColor={nodeColor} />
        {/* No <Controls/>: same hazard, and it adds nothing pointer-events:none
            couldn't already give via the mouse wheel (zoom) and pane drag (pan). */}
      </ReactFlow>
      {pendingDrop ? (
        <DropMenu
          kind={pendingDrop.kind}
          screenPosition={pendingDrop.screenPosition}
          onChoose={handleDropMenuChoose}
          onDismiss={() => setPendingDrop(null)}
        />
      ) : null}
    </div>
  );
}

/** Public wrapper: provides the ReactFlowProvider GraphViewInner's own useReactFlow() (drop-position projection) needs in scope. */
export function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
