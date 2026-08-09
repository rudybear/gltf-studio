// Dock tab wiring for the behavior-graph canvas (specs/ux-graph-canvas.md):
// mounts @gltf-studio/graph-canvas's <GraphCanvas> for the current document,
// wiring its editing commands into the app store's dispatchCommand/undo
// history and its diagnostics/toasts into the console + toast layer. A
// multi-graph selector appears only when the asset actually declares more
// than one `extensions.KHR_interactivity.graphs[]` entry.
import { useEffect } from "react";
import { GraphCanvas } from "@gltf-studio/graph-canvas";
import { useAppStore } from "../../store/app-store";
import { Placeholder } from "./Placeholder";

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

  useEffect(() => {
    window.__gltfStudioGraphTest = { getDocumentJson: () => document?.json };
    return () => {
      delete window.__gltfStudioGraphTest;
    };
  }, [document]);

  if (!document) {
    return <Placeholder testId="graph.panel" text="Import a .glb/.gltf to edit its behavior graph." />;
  }

  const graphs = (document.json as { extensions?: { KHR_interactivity?: { graphs?: unknown[] } } }).extensions?.KHR_interactivity?.graphs;
  const graphCount = graphs?.length ?? 0;

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
          onAskCopilot={() => setActiveRightTab("copilot")}
          onJumpToData={jumpToDataFromGraph}
          onOpenPointerPicker={openPointerPicker}
        />
      </div>
    </div>
  );
}
