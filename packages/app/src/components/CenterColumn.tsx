import { useAppStore, PANEL_BOUNDS } from "../store/app-store";
import { Viewport } from "./viewport/Viewport";
import { BottomDock } from "./dock/BottomDock";
import { ResizeHandle } from "./ResizeHandle";

export function CenterColumn(): JSX.Element {
  const setPanelSize = useAppStore((s) => s.setPanelSize);

  return (
    <div id="center-column">
      <Viewport />
      <ResizeHandle
        orientation="horizontal"
        testId="dock.resize-handle"
        onDrag={(delta) => {
          // See App.tsx's left/right resize handlers for why this reads
          // live store state rather than a render-closed-over variable.
          const current = useAppStore.getState().panelSizes.dockHeight;
          const maxHeight = window.innerHeight * 0.7;
          const next = Math.min(maxHeight, Math.max(PANEL_BOUNDS.dock.min, current - delta));
          setPanelSize("dockHeight", next);
        }}
      />
      <BottomDock />
    </div>
  );
}
