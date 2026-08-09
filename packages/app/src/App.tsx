import { useEffect } from "react";
import { useAppStore, PANEL_BOUNDS } from "./store/app-store";
import { TopBar } from "./components/topbar/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { CenterColumn } from "./components/CenterColumn";
import { RightPanel } from "./components/RightPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { TestIdOverlay } from "./components/TestIdOverlay";
import { ToastLayer } from "./components/ToastLayer";

/**
 * Test-only seam (no UX-### requirement covers it — same rationale as
 * Viewport.tsx's own `window.__gltfStudioTest`): the bottom dock's Behavior
 * graph tab is still a placeholder (no real canvas yet), so an e2e test
 * asserting `specs/ux-inspector.md`'s `UX-412` ("Add pointer/set|interpolate
 * to graph" creates a real `KHR_interactivity` graph node) has no UI path to
 * inspect `extensions.KHR_interactivity` short of reading the live document.
 * Installed here (App.tsx), not Viewport.tsx, since it's a whole-document
 * concern rather than a RenderHost one.
 */
export interface GltfStudioDocumentTestHook {
  getJson(): unknown;
}

declare global {
  interface Window {
    __gltfStudioDocumentTest?: GltfStudioDocumentTestHook;
  }
}

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

  useEffect(() => {
    window.__gltfStudioDocumentTest = {
      getJson: () => useAppStore.getState().document?.json ?? null
    };
    return () => {
      delete window.__gltfStudioDocumentTest;
    };
  }, []);

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
