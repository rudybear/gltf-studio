// Dock tab wiring for the behavior-graph canvas (specs/ux-graph-canvas.md):
// mounts @gltf-studio/graph-canvas's <GraphCanvas> for the current document,
// wiring its editing commands into the app store's dispatchCommand/undo
// history and its diagnostics/toasts into the console + toast layer. A
// multi-graph selector appears only when the asset actually declares more
// than one `extensions.KHR_interactivity.graphs[]` entry.
import { useCallback, useEffect, useMemo } from "react";
import { GraphCanvas } from "@gltf-studio/graph-canvas";
import type { Graph as IrGraph } from "@gltfi/ir";
import { useAppStore } from "../../store/app-store";
import { buildBreakpointEmitView, computeBreakpointNodeIndices, resolveBreakpointLine } from "../../lib/script-breakpoints.js";
import { Placeholder } from "./Placeholder";

const EMPTY_BREAKPOINT_LINES: readonly number[] = [];

/**
 * Test-only seam (no UX-### requirement covers it — same pattern as
 * Viewport.tsx's `window.__gltfStudioTest`): e2e/graph-canvas.spec.ts has no
 * other way to read `extensions.KHR_interactivity` out of the live document
 * (the Data tab's breadcrumb navigation is scoped to DOC-038's canonical
 * splice roots, not a general-purpose pointer inspector). Attached/detached
 * alongside this panel's own mount — BottomDock.tsx keeps this component
 * mounted (merely hidden via CSS) across dock-tab switches per UX-103, so in
 * practice this only unmounts when the whole app does; still installed via
 * an effect (not eagerly) so it never outlives an unmount some future
 * BottomDock change might reintroduce.
 */
export interface GltfStudioGraphTestHook {
  getDocumentJson(): unknown;
}

declare global {
  interface Window {
    __gltfStudioGraphTest?: GltfStudioGraphTestHook;
  }
}

export function BehaviorGraphPanel(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const selectedGraphNodeIndex = useAppStore((s) => s.selectedGraphNodeIndex);
  const selectGraphNode = useAppStore((s) => s.selectGraphNode);
  const selectedGraphIndex = useAppStore((s) => s.selectedGraphIndex);
  const setSelectedGraphIndex = useAppStore((s) => s.setSelectedGraphIndex);
  const log = useAppStore((s) => s.log);
  const pushToast = useAppStore((s) => s.pushToast);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);
  const jumpToDataFromGraph = useAppStore((s) => s.jumpToDataFromGraph);
  const openPointerPicker = useAppStore((s) => s.openPointerPicker);
  const addCopilotContextChip = useAppStore((s) => s.addCopilotContextChip);
  const requestCopilotComposerFocus = useAppStore((s) => s.requestCopilotComposerFocus);
  const graphNodeFocusRequest = useAppStore((s) => s.graphNodeFocusRequest);
  const revealSceneNodeInViewport = useAppStore((s) => s.revealSceneNodeInViewport);
  const selectNode = useAppStore((s) => s.selectNode);
  const scriptBreakpoints = useAppStore((s) => s.scriptBreakpoints);
  const setScriptBreakpoint = useAppStore((s) => s.setScriptBreakpoint);

  useEffect(() => {
    window.__gltfStudioGraphTest = { getDocumentJson: () => document?.json };
    return () => {
      delete window.__gltfStudioGraphTest;
    };
  }, [document]);

  const graphs = (document?.json as { extensions?: { KHR_interactivity?: { graphs?: unknown[] } } } | undefined)?.extensions?.KHR_interactivity?.graphs;
  const graphCount = graphs?.length ?? 0;
  const effectiveGraphIndex = graphCount > 1 ? selectedGraphIndex : 0;
  const rawGraph = (graphs?.[effectiveGraphIndex] as IrGraph | undefined) ?? undefined;

  // D2 (specs/ux-debugger.md UX-1505 block): the graph-canvas breakpoint
  // badges (UX-1506) and "Break here" node-details action (UX-1507) both
  // resolve node<->line through the SAME EmitView — built once per
  // [rawGraph, effectiveGraphIndex] change and reused by both, rather than
  // re-running importGraph+emitModule per lookup.
  const emitView = useMemo(() => (rawGraph ? buildBreakpointEmitView(rawGraph, effectiveGraphIndex) : null), [rawGraph, effectiveGraphIndex]);
  const graphBreakpointLines = scriptBreakpoints[effectiveGraphIndex] ?? EMPTY_BREAKPOINT_LINES;
  const breakpointNodeIndices = useMemo(
    () => (rawGraph && emitView ? computeBreakpointNodeIndices(rawGraph, emitView, graphBreakpointLines) : undefined),
    [rawGraph, emitView, graphBreakpointLines]
  );
  const canBreakHereForNode = useCallback(
    (nodeIndex: number): boolean => !!rawGraph && !!emitView && resolveBreakpointLine(rawGraph, emitView, nodeIndex) !== null,
    [rawGraph, emitView]
  );
  const handleBreakHere = useCallback(
    (nodeIndex: number) => {
      if (!rawGraph || !emitView) return;
      const line = resolveBreakpointLine(rawGraph, emitView, nodeIndex);
      if (line === null) return; // NodeDetails' own `canBreakHere` disabled state already prevents this in practice — defensive no-op, not a silent lie.
      setScriptBreakpoint(effectiveGraphIndex, line);
    },
    [rawGraph, emitView, effectiveGraphIndex, setScriptBreakpoint]
  );

  if (!document) {
    return <Placeholder testId="graph.panel" text="Import a .glb/.gltf to edit its behavior graph." />;
  }

  return (
    <div className="graph-panel-wrap" data-testid="graph.panel">
      {graphCount > 1 ? (
        <div className="graph-panel-toolbar" data-testid="graph.panel.graph-selector-row">
          <label htmlFor="graph-panel-graph-select" className="dim">
            Graph
          </label>
          <select
            id="graph-panel-graph-select"
            className="field"
            value={selectedGraphIndex}
            onChange={(e) => setSelectedGraphIndex(Number(e.target.value))}
            data-testid="graph.panel.graph-select"
          >
            {Array.from({ length: graphCount }, (_, i) => (
              <option key={i} value={i}>
                Graph {i}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="graph-panel-canvas">
        <GraphCanvas
          document={document}
          graphIndex={graphCount > 1 ? selectedGraphIndex : 0}
          dispatchCommand={dispatchCommand}
          selectedNodeIndex={selectedGraphNodeIndex}
          onSelectNode={selectGraphNode}
          onLog={log}
          onToast={pushToast}
          onAskCopilot={() => {
            // specs/ux-graph-canvas.md UX-511: the tab-switch half already
            // worked (PalettePanel's own `onAskCopilot` callback) -- this
            // adds the context-chip half naming the CURRENT graph (per
            // `selectedGraphIndex`, which is what the canvas actually shows
            // when `graphCount > 1`; `0` otherwise, matching the `graphIndex`
            // prop passed to `<GraphCanvas>` below).
            const graphIndex = graphCount > 1 ? selectedGraphIndex : 0;
            setActiveRightTab("copilot");
            addCopilotContextChip(
              { kind: "explicit", label: `Graph ${graphIndex}`, pointer: `/extensions/KHR_interactivity/graphs/${graphIndex}` },
              `Graph ${graphIndex}`
            );
            requestCopilotComposerFocus();
          }}
          onJumpToData={jumpToDataFromGraph}
          onOpenPointerPicker={openPointerPicker}
          focusRequest={graphNodeFocusRequest}
          onRevealInViewport={revealSceneNodeInViewport}
          onSelectSceneNode={selectNode}
          breakpointNodeIndices={breakpointNodeIndices}
          canBreakHere={selectedGraphNodeIndex !== null ? canBreakHereForNode(selectedGraphNodeIndex) : false}
          onBreakHere={handleBreakHere}
        />
      </div>
    </div>
  );
}
