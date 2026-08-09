import { useEffect } from "react";
import { useAppStore, PANEL_BOUNDS } from "./store/app-store";
import { TopBar } from "./components/topbar/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { CenterColumn } from "./components/CenterColumn";
import { RightPanel } from "./components/RightPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { TestIdOverlay } from "./components/TestIdOverlay";
import { ToastLayer } from "./components/ToastLayer";

export function App(): JSX.Element {
  const themeOverride = useAppStore((s) => s.themeOverride);
  const setPanelSize = useAppStore((s) => s.setPanelSize);

  // UX-104/UX-105: no explicit override on first load (CSS's own
  // prefers-color-scheme media query handles that live); once the user
  // toggles, an explicit data-theme attribute wins over the media query and
  // persists across further OS-theme changes until toggled back.
  useEffect(() => {
    if (themeOverride) {
      document.documentElement.setAttribute("data-theme", themeOverride);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [themeOverride]);

  return (
    <div id="app">
      <TopBar />
      <div id="workspace">
        <LeftPanel />
        <ResizeHandle
          orientation="vertical"
          testId="left-panel.resize-handle"
          onDrag={(delta) => {
            // Reads the live store value (not a render-closed-over variable) so
            // rapid successive move events within one drag gesture each apply
            // their delta on top of the LATEST width rather than all
            // recomputing from the width at drag-start (which would silently
            // discard every intermediate step but the last).
            const current = useAppStore.getState().panelSizes.leftWidth;
            const next = Math.min(PANEL_BOUNDS.left.max, Math.max(PANEL_BOUNDS.left.min, current + delta));
            setPanelSize("leftWidth", next);
          }}
        />
        <CenterColumn />
        <ResizeHandle
          orientation="vertical"
          testId="right-panel.resize-handle"
          onDrag={(delta) => {
            const current = useAppStore.getState().panelSizes.rightWidth;
            const next = Math.min(PANEL_BOUNDS.right.max, Math.max(PANEL_BOUNDS.right.min, current - delta));
            setPanelSize("rightWidth", next);
          }}
        />
        <RightPanel />
      </div>
      <TestIdOverlay />
      <ToastLayer />
    </div>
  );
}
