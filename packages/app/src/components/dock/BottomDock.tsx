import { useEffect, useState } from "react";
import { useAppStore } from "../../store/app-store";
import type { DockTab } from "../../store/app-store";
import { ConsolePanel } from "./ConsolePanel";
import { DataTab } from "./DataTab";
import { BehaviorGraphPanel } from "./BehaviorGraphPanel";
import { AudioGraphTabPanel } from "./AudioGraphTabPanel";
import { ScriptTabPanel } from "./ScriptTabPanel";

const TABS: Array<{ key: DockTab; label: string; testid: string }> = [
  { key: "graph", label: "Behavior graph", testid: "dock.tab.graph" },
  { key: "audio-graph", label: "Audio graph", testid: "dock.tab.audio-graph" },
  { key: "script", label: "Script", testid: "dock.tab.script" },
  { key: "console", label: "Console", testid: "dock.tab.console" },
  { key: "data", label: "Data (glTF)", testid: "dock.tab.data" }
];

/** UX-103: exactly five dock tabs, one visible at a time; Behavior graph (M4), Script (M5), Console, Data, and (M7) Audio graph are all real. */
export function BottomDock(): JSX.Element {
  const height = useAppStore((s) => s.panelSizes.dockHeight);
  const active = useAppStore((s) => s.activeDockTab);
  const setActiveDockTab = useAppStore((s) => s.setActiveDockTab);

  // specs/ux-script.md UX-707's lazy-loading strategy (Monaco/ts-morph are
  // heavy — see ScriptTabPanel.tsx/script-panel's parse-client.ts): the
  // Script tab's real panel (and everything it dynamically imports) is
  // never mounted until its FIRST open, tracked here rather than in the
  // store since it's pure one-way UI bookkeeping, not state any other
  // surface needs (DOC-030-style ephemeral, but not even worth
  // cross-component sharing). Kept mounted-but-hidden afterward (same
  // `display: contents|none` treatment BehaviorGraphPanel already gets)
  // so the Monaco buffer/edit-mode state survives a tab-away-and-back per
  // UX-103's general "switching tabs must not reset the tab being left's
  // own state" principle.
  const [scriptEverOpened, setScriptEverOpened] = useState(active === "script");
  useEffect(() => {
    if (active === "script") setScriptEverOpened(true);
  }, [active]);

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
            mounted and merely hidden instead. The Script tab's Monaco buffer/edit-mode is the
            same kind of real local state (once opened at all — `scriptEverOpened` above), so
            it gets the identical mount-but-hide treatment. The remaining tabs are stateless
            placeholders or keep their state in the store (Console/Data), so a plain
            conditional mount is still correct for them. */}
        <div style={{ display: active === "graph" ? "contents" : "none" }}>
          <BehaviorGraphPanel />
        </div>
        {active === "audio-graph" && <AudioGraphTabPanel />}
        {scriptEverOpened && (
          <div style={{ display: active === "script" ? "contents" : "none" }}>
            <ScriptTabPanel />
          </div>
        )}
        {active === "console" && <ConsolePanel />}
        {active === "data" && <DataTab />}
      </div>
    </div>
  );
}
