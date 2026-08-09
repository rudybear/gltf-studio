import { useAppStore } from "../../store/app-store";
import type { DockTab } from "../../store/app-store";
import { Placeholder } from "./Placeholder";
import { ConsolePanel } from "./ConsolePanel";
import { DataTab } from "./DataTab";
import { BehaviorGraphPanel } from "./BehaviorGraphPanel";

const TABS: Array<{ key: DockTab; label: string; testid: string }> = [
  { key: "graph", label: "Behavior graph", testid: "dock.tab.graph" },
  { key: "audio-graph", label: "Audio graph", testid: "dock.tab.audio-graph" },
  { key: "script", label: "Script", testid: "dock.tab.script" },
  { key: "console", label: "Console", testid: "dock.tab.console" },
  { key: "data", label: "Data (glTF)", testid: "dock.tab.data" }
];

/** UX-103: exactly five dock tabs, one visible at a time; Behavior graph (M4), Console, and Data are real, Audio graph/Script remain placeholders. */
export function BottomDock(): JSX.Element {
  const height = useAppStore((s) => s.panelSizes.dockHeight);
  const active = useAppStore((s) => s.activeDockTab);
  const setActiveDockTab = useAppStore((s) => s.setActiveDockTab);

  return (
    <div id="bottom-dock" data-testid="dock.panel" style={{ height, flex: `0 0 ${height}px` }}>
      <div className="dock-tabs" data-testid="dock.tabs">
        {TABS.map((tab) => (
          <button key={tab.key} className={active === tab.key ? "active" : ""} data-testid={tab.testid} onClick={() => setActiveDockTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="dock-content">
        {/* UX-103: switching tabs must not reset the tab being left's own state (e.g.
            "graph canvas scroll position" is UX-103's own example) — the behavior-graph
            canvas has real local view state (React Flow pan/zoom, palette search/collapse)
            that a conditional-mount/unmount would discard on every tab switch, so it's kept
            mounted and merely hidden instead. The other tabs are stateless placeholders or
            keep their state in the store (Console/Data), so a plain conditional mount is
            still correct for them. */}
        <div style={{ display: active === "graph" ? "contents" : "none" }}>
          <BehaviorGraphPanel />
        </div>
        {active === "audio-graph" && <Placeholder testId="audio-graph.panel" text="Audio graph canvas arrives in a later milestone." />}
        {active === "script" && <Placeholder testId="script.panel" text="Script view arrives in a later milestone." />}
        {active === "console" && <ConsolePanel />}
        {active === "data" && <DataTab />}
      </div>
    </div>
  );
}
