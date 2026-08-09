import { useAppStore } from "../store/app-store";
import { Inspector } from "./inspector/Inspector";
import { Copilot } from "./copilot/Copilot";

export function RightPanel(): JSX.Element {
  const width = useAppStore((s) => s.panelSizes.rightWidth);
  const activeRightTab = useAppStore((s) => s.activeRightTab);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);

  return (
    <div id="right-panel" data-testid="right-panel.panel" style={{ width, flex: `0 0 ${width}px` }}>
      <div className="right-panel-tabs" data-testid="right-panel.tabs">
        <button className={activeRightTab === "inspector" ? "active" : ""} data-testid="right-panel.tab.inspector" onClick={() => setActiveRightTab("inspector")}>
          Inspector
        </button>
        <button className={activeRightTab === "copilot" ? "active" : ""} data-testid="right-panel.tab.copilot" onClick={() => setActiveRightTab("copilot")}>
          Copilot
        </button>
      </div>
      {activeRightTab === "inspector" ? <Inspector /> : <Copilot />}
    </div>
  );
}
