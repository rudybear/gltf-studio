// Dock tab wiring for the Script tab (specs/ux-script.md UX-7xx): mounts
// @gltf-studio/script-panel's <ScriptPanel> for the current document,
// wiring its Apply -> Graph command into the app store's
// dispatchCommand/undo history and its diagnostics/toasts into the
// console + toast layer — same wiring shape as BehaviorGraphPanel.tsx for
// the Behavior graph tab, including reuse of that tab's own
// selectedGraphIndex/selectedGraphNodeIndex store fields (no new store
// state needed: both tabs show/react to the same graph selection).
//
// `React.lazy` here (not just script-panel's own internal dynamic import of
// monaco-setup.ts) is the outer half of the "Monaco loads only once the
// Script tab is first opened" strategy: BottomDock.tsx only mounts this
// component at all after the Script tab's first click (see its own
// `scriptEverOpened` gate), so `import("@gltf-studio/script-panel")` here
// never runs before then either.
import { lazy, Suspense } from "react";
import { useAppStore } from "../../store/app-store";
import { Placeholder } from "./Placeholder";

const LazyScriptPanel = lazy(() => import("@gltf-studio/script-panel").then((m) => ({ default: m.ScriptPanel })));

export function ScriptTabPanel(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const selectedGraphNodeIndex = useAppStore((s) => s.selectedGraphNodeIndex);
  const selectedGraphIndex = useAppStore((s) => s.selectedGraphIndex);
  const setSelectedGraphIndex = useAppStore((s) => s.setSelectedGraphIndex);
  const scriptNodeFocusRequest = useAppStore((s) => s.scriptNodeFocusRequest);
  const jumpScriptPointerToScene = useAppStore((s) => s.jumpScriptPointerToScene);
  const log = useAppStore((s) => s.log);
  const pushToast = useAppStore((s) => s.pushToast);

  if (!document) {
    return <Placeholder testId="script.panel" text="Import a .glb/.gltf to view its generated script." />;
  }

  const graphs = (document.json as { extensions?: { KHR_interactivity?: { graphs?: unknown[] } } }).extensions?.KHR_interactivity?.graphs;
  const graphCount = graphs?.length ?? 0;

  return (
    <div className="script-tab-wrap" data-testid="script.tab-wrap">
      {graphCount > 1 ? (
        <div className="script-tab-toolbar" data-testid="script.graph-selector-row">
          <label htmlFor="script-tab-graph-select" className="dim">
            Graph
          </label>
          <select
            id="script-tab-graph-select"
            className="field"
            value={selectedGraphIndex}
            onChange={(e) => setSelectedGraphIndex(Number(e.target.value))}
            data-testid="script.graph-select"
          >
            {Array.from({ length: graphCount }, (_, i) => (
              <option key={i} value={i}>
                Graph {i}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Suspense fallback={<Placeholder testId="script.panel.loading" text="Loading script editor…" />}>
        <LazyScriptPanel
          document={document}
          graphIndex={graphCount > 1 ? selectedGraphIndex : 0}
          dispatchCommand={dispatchCommand}
          selectedNodeIndex={selectedGraphNodeIndex}
          focusRequest={scriptNodeFocusRequest}
          onLog={log}
          onToast={pushToast}
          onPointerLinkClick={(pointerPath) => jumpScriptPointerToScene(pointerPath, graphCount > 1 ? selectedGraphIndex : 0)}
        />
      </Suspense>
    </div>
  );
}
