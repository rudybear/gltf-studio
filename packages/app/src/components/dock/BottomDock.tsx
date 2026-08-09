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
        {active === "graph" && <BehaviorGraphPanel />}
        {active === "audio-graph" && <Placeholder testId="audio-graph.panel" text="Audio graph canvas arrives in a later milestone." />}
        {active === "script" && <Placeholder testId="script.panel" text="Script view arrives in a later milestone." />}
        {active === "console" && <ConsolePanel />}
        {active === "data" && <DataTab />}
      </div>
    </div>
  );
}
