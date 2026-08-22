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
  /** e2e-only: the CURRENT pan/zoom — lets a test compute a node's on-screen position back into flow-space (e.g. to re-center/zoom on it via `setViewport` for a pixel assertion) without hardcoding this canvas's `fitView` auto-zoom choice. */
  getViewport(): { x: number; y: number; zoom: number };
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
   * Invokes the SAME `onMoveNode` handler a real node-header drag-and-drop
   * triggers (`handleNodeDragStop`), bypassing raw pixel mouse choreography
   * — same rationale/precedent as `simulateConnect` immediately above, found
   * while building `e2e/audio-graph-gaps.spec.ts`'s terminal-node position-
   * persistence coverage: `<ReactFlow fitView minZoom={0.05}>` can zoom a
   * small, widely-ELK-spaced graph out far enough (observed ~0.1x for a
   * 3-node audio graph) that a node card collapses to a few CSS pixels tall
   * on screen, making pixel-precise drag targeting flaky regardless of how
   * carefully a spec zooms back in first (react-flow's own internal
   * zoom/pan-settled bookkeeping has its own debounce, independent of when
   * the rendered bounding box visibly stops moving). Every bit of REAL
   * application logic downstream of a move (`AudioGraphEdit.setNodePosition`/
   * `SceneEdit.setAudioSourceProperty`/`setAudioEmitterProperty`,
   * `dispatchCommand`) still runs; only the physical pointer input and
   * React Flow's own drag-gesture recognition are bypassed.
   */
  simulateMoveNode(nodeId: string, x: number, y: number): void;
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
  /**
   * Bug-fix note (node-click/resize race, see the `nodesRef` doc comment in
   * `GraphViewInner`): a freshly-rendered node's bounding box starts at
   * ELK's ESTIMATED size and is corrected to its real measured DOM size a
   * tick later by React Flow's own ResizeObserver — a `locator.click()`
   * computed against the estimate can land on a child element (e.g. a
   * literal-input row) once the real resize lands, instead of the node's
   * own chrome, silently losing the click. `true` once every currently-
   * rendered node has its final measured size (React Flow's own
   * `node.measured`) — a spec should `expect.poll` this before clicking a
   * node by testid/bounding box, so the click point Playwright computes is
   * never stale.
   */
  nodesDimensionsSettled(): boolean;
}

declare global {
  interface Window {
    __gltfStudioGraphCanvasTest?: GraphCanvasTestHook;
    /** M7 audio-graph editing: `AudioGraphCanvas`'s own instance of this same hook, under its own key (see `GraphViewProps.testHookKey`'s doc comment). */
    __gltfStudioAudioGraphCanvasTest?: GraphCanvasTestHook;
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
  /** D2 (specs/ux-debugger.md UX-1506): `graph.nodes[]` indices whose resolved emitted-script line currently holds a session breakpoint — drives OpNode's red breakpoint badge (op-node.ts's `hasBreakpoint`). Omitted (no badges) when the host has no script-breakpoint concept (e.g. `@gltf-studio/audio-canvas`'s reuse of this same component). */
  breakpointNodeIndices?: ReadonlySet<number>;
  /**
   * M7 audio-graph editing: the `window` key this instance's test hook
   * (`GraphCanvasTestHook`, below) installs itself under. Defaults to
   * `"__gltfStudioGraphCanvasTest"` (the behavior graph's own long-standing
   * key). `@gltf-studio/audio-canvas`'s `AudioGraphCanvas` passes a
   * DIFFERENT key (`"__gltfStudioAudioGraphCanvasTest"`) because
   * `specs/ux-shell.md`'s UX-103 keeps the Behavior graph tab
   * mounted-but-hidden while the Audio graph tab is active — two `GraphView`
   * instances are live at once, and without this, whichever one's mount
   * effect ran last would silently steal the shared global key out from
   * under `e2e/graph-canvas.spec.ts`'s existing `simulateConnect` calls.
   */
  testHookKey?: string;
};

function GraphViewInner(props: GraphViewProps) {
  const { graph, selectedNodeIndex, onSelectNode, diagnosticsByNode, onLiteralCommit, onPointerTextClick, onPointerIconClick } = props;
  const { onConnectValue, onConnectFlow, onConnectRejected, onDisconnectEdge, onRemoveNodes, onMoveNode, onDropOp, onCreateFromDrop, onRendered, focusRequest } = props;
  const { docNames, onTargetChipClick, breakpointNodeIndices, testHookKey = "__gltfStudioGraphCanvasTest" } = props;

  const engineRef = useRef<LayoutEngine | null>(null);
  const [elkPositions, setElkPositions] = useState<LayoutPositions | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutEngineMode>("elk");
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<OpNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [pendingDrop, setPendingDrop] = useState<PendingExternalDrop | null>(null);
  const reactFlow = useReactFlow();
  // Always-current handler ref so the test-hook effect below (installed
  // once) never closes over a stale `handleConnect` from an earlier render.
  const handleConnectRef = useRef<OnConnect>(() => {});
  // Same always-current rationale for `simulateMoveNode` — `onMoveNode` is a
  // plain prop (a fresh closure every render in every caller, never
  // memoized), so the test-hook effect below needs the same ref indirection
  // `handleConnectRef` already established, not a direct closure over it.
  const onMoveNodeRef = useRef(onMoveNode);
  onMoveNodeRef.current = onMoveNode;
  // Bug-fix note (node-click/resize race, found stabilizing
  // e2e/graph-canvas.spec.ts under artificial CI-like CPU contention): a
  // freshly-rendered node is first laid out at ELK's ESTIMATED width/height
  // (`nodePosition`'s fallback / `NODE_METRICS`), then React Flow's own
  // internal ResizeObserver measures its REAL rendered DOM size a tick
  // later and reports it via `onNodesChange`'s `"dimensions"` change —
  // visibly two (sometimes three, for a config-row-bearing node) separate
  // size updates per node. Because a node's `x`/`y` is a fixed top-left
  // anchor, that resize moves the node's on-screen geometric CENTER.
  // Playwright's `locator.click()` computes its target point from the
  // element's bounding-box CENTER once its own actionability/"stability"
  // check passes, then dispatches the real mousedown/mouseup a tick later —
  // under heavy scheduling contention (a saturated 4-vCPU CI runner is
  // exactly this), that gap can straddle the SECOND (real) resize: the
  // click fires at a screen point computed for the smaller estimate box,
  // but by the time the browser processes it the node has already grown,
  // so that pixel can land on a CHILD element instead of the node's own
  // chrome — concretely, `op-node.tsx`'s literal-value `<input>`, whose
  // `onClick={(e) => e.stopPropagation()}` (there so editing a literal
  // doesn't ALSO reselect the node) then silently swallows the click before
  // it ever reaches React Flow's node-click delegation. No exception, no
  // slow-but-eventually-correct behavior — `onSelectNode` simply never
  // fires, forever, however long a test waits afterward (this is why
  // widening this file's assertion timeouts up to 120000ms never actually
  // fixed the flake it was chasing).
  //
  // `nodesDimensionsSettled` below is the real fix: a live readiness check
  // (not a longer timeout) a test can poll BEFORE clicking a node by
  // testid/bounding box, so Playwright only ever computes a click point
  // once every currently-rendered node's box is at its FINAL, measured
  // size. `nodesRef` mirrors `nodes` on every render so the test-hook
  // effect (installed once, below) never reads a stale snapshot.
  //
  // A node's `measured.width`/`.height` is already non-zero at the FIRST
  // (estimate) measurement, not only once the real one lands — so "is
  // measured non-zero" alone doesn't distinguish "mid-cascade" from
  // "actually done" (confirmed the hard way: an earlier version of this
  // fix that only checked non-zero `measured` still reproduced the click
  // race under CPU contention, just far more rarely). What DOES
  // distinguish them is TIME: every real dimensions cascade observed
  // (offline, under artificial contention) lands as a tight burst of
  // `"dimensions"` changes a few animation frames apart, then goes
  // completely quiet — so `nodesDimensionsSettled` reports true only once
  // no `"dimensions"` change has landed for `DIMENSIONS_QUIET_MS`, an
  // adaptive debounce (it keeps waiting exactly as long as real resizing
  // keeps happening, how long real resizing was), not a fixed guess.
  const nodesRef = useRef<OpNodeType[]>([]);
  nodesRef.current = nodes;
  const DIMENSIONS_QUIET_MS = 300;
  const lastDimensionsChangeAtRef = useRef<number>(performance.now());
  const onNodesChange: typeof onNodesChangeRaw = (changes) => {
    if (changes.some((c) => c.type === "dimensions")) {
      lastDimensionsChangeAtRef.current = performance.now();
    }
    onNodesChangeRaw(changes);
  };

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
    // Bug-fix note (deflake, systemic e2e CI stability pass — a THIRD
    // mechanism behind the node-click/resize race `nodesDimensionsSettled`
    // exists to guard against, found stabilizing e2e/graph-canvas.spec.ts's
    // ALREADY-`waitForNodesSettled`-guarded "deleting a node" test under
    // artificial CPU contention): this effect's own `setNodes(rfNodes)`
    // call below — not just React Flow's internal ResizeObserver, which is
    // all `onNodesChange`'s "dimensions"-change tracking (above) sees — can
    // itself move a node whenever `elkPositions` resolves, since EVERY
    // node's position/size is recomputed here (`nodePosition`'s ELK
    // fallback), not just a newly-added node's own. ELK's layout worker is
    // asynchronous; under heavy contention its result can arrive well AFTER
    // `nodesDimensionsSettled()` already reported true from the initial
    // paint settling, silently moving a node out from under a Playwright
    // bounding box computed in between — no ResizeObserver fires for a
    // pure position change (only a size change does), so the existing
    // debounce alone never saw this update. Comparing this effect's own
    // OUTPUT against the previous render's committed nodes (`nodesRef`) and
    // bumping the SAME debounce timestamp whenever this effect itself
    // changes any node's geometry closes that gap without a second,
    // separate readiness signal for callers to juggle.
    const previousById = new Map(nodesRef.current.map((n) => [n.id, n]));
    let geometryChangedByThisEffect = false;
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
        onTargetChipClick,
        hasBreakpoint: breakpointNodeIndices?.has(node.index) ?? false
      };
      const id = String(node.index);
      const previous = previousById.get(id);
      if (!previous || previous.position.x !== pos.x || previous.position.y !== pos.y || previous.style?.width !== pos.width || previous.style?.minHeight !== pos.height) {
        geometryChangedByThisEffect = true;
      }
      return {
        id,
        type: "op",
        position: { x: pos.x, y: pos.y },
        style: { width: pos.width, minHeight: pos.height },
        data,
        selected: node.index === selectedNodeIndex,
        deletable: true,
        connectable: true
      };
    });
    if (geometryChangedByThisEffect) {
      lastDimensionsChangeAtRef.current = performance.now();
    }

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
  }, [graph, elkPositions, diagnosticsByNode, connectedValueInPorts, selectedNodeIndex, docNames, onTargetChipClick, breakpointNodeIndices]);

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
    const hookWindow = window as unknown as Record<string, GraphCanvasTestHook | undefined>;
    hookWindow[testHookKey] = {
      setViewport: (v) => reactFlow.setViewport(v),
      getViewport: () => reactFlow.getViewport(),
      simulateConnect: (connection) => handleConnectRef.current(connection),
      simulateMoveNode: (nodeId, x, y) => onMoveNodeRef.current(Number(nodeId), x, y),
      simulateExternalDrop: (kind, refId, flowPosition) => {
        const screen = reactFlow.flowToScreenPosition(flowPosition);
        setPendingDrop({ kind, refId, flowPosition, screenPosition: screen });
      },
      nodesDimensionsSettled: () =>
        nodesRef.current.length > 0 &&
        nodesRef.current.every((n) => (n.measured?.width ?? 0) > 0 && (n.measured?.height ?? 0) > 0) &&
        performance.now() - lastDimensionsChangeAtRef.current > DIMENSIONS_QUIET_MS
    };
    return () => {
      delete hookWindow[testHookKey];
    };
  }, [reactFlow, testHookKey]);

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
