import { useAppStore } from "../store/app-store";
import { SceneTree } from "./scene-tree/SceneTree";
import { AssetBrowser } from "./scene-tree/AssetBrowser";

export function LeftPanel(): JSX.Element {
  const width = useAppStore((s) => s.panelSizes.leftWidth);
  return (
    <div id="left-panel" data-testid="left-panel.panel" style={{ width, flex: `0 0 ${width}px` }}>
      <SceneTree />
      <AssetBrowser />
    </div>
  );
}
