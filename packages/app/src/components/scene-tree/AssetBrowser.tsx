import { useAppStore } from "../../store/app-store";
import type { AssetTab } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { NodeIcon } from "./NodeIcon";

const TABS: Array<{ key: AssetTab; label: string; testid: string }> = [
  { key: "meshes", label: "Meshes", testid: "asset-browser.tab.meshes" },
  { key: "materials", label: "Materials", testid: "asset-browser.tab.materials" },
  { key: "audio", label: "Audio Clips", testid: "asset-browser.tab.audio-clips" },
  { key: "animations", label: "Animations", testid: "asset-browser.tab.animations" }
];

/**
 * specs/ux-scene-tree.md UX-210/UX-211: the document's actual owned
 * meshes/materials/animations arrays (each entry listed once, never once
 * per referencing scene node). The Audio Clips tab intentionally stays
 * empty/unwired — OPEN(UX-asset-audio-tab-tbd) notes clip assets aren't
 * part of the glTF node/mesh/material/accessor addressing model the Data
 * tab resolves.
 */
export function AssetBrowser(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const activeAssetTab = useAppStore((s) => s.activeAssetTab);
  const setActiveAssetTab = useAppStore((s) => s.setActiveAssetTab);
  const selectedAsset = useAppStore((s) => s.selectedAsset);
  const selectAsset = useAppStore((s) => s.selectAsset);
  const showIndices = useAppStore((s) => s.showIndices);
  const flashTarget = useAppStore((s) => s.flashTarget);

  const json = document?.json as GltfJsonShape | undefined;
  const rowsFor = (tab: AssetTab): string[] => {
    if (tab === "meshes") return (json?.meshes ?? []).map((m, i) => m.name ?? `Mesh ${i}`);
    if (tab === "materials") return (json?.materials ?? []).map((m, i) => m.name ?? `Material ${i}`);
    if (tab === "animations") return (json?.animations ?? []).map((a, i) => a.name ?? `Animation ${i}`);
    return [];
  };
  const rows = rowsFor(activeAssetTab);

  return (
    <div id="asset-browser-section" className="panel-section" data-testid="asset-browser.panel">
      <div className="panel-header">
        <span>Assets</span>
      </div>
      <div className="asset-tabs" data-testid="asset-browser.tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={activeAssetTab === tab.key ? "active" : ""}
            data-testid={tab.testid}
            onClick={() => setActiveAssetTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {activeAssetTab === "audio" ? (
          <div className="empty-note" data-testid="asset-browser.audio-clips.empty">
            Audio clip assets aren't wired up yet.
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-note" data-testid={`asset-browser.${activeAssetTab}.empty`}>
            {document ? "None in this document." : "Import a .glb first."}
          </div>
        ) : (
          <div className="asset-list">
            {rows.map((name, i) => {
              const flashed = flashTarget?.kind === "asset-row" && flashTarget.tab === activeAssetTab && flashTarget.index === i;
              return (
              <div
                key={i}
                className={`asset-item${selectedAsset?.tab === activeAssetTab && selectedAsset.index === i ? " selected" : ""}${flashed ? " flash-highlight" : ""}`}
                data-testid={`asset-browser.${activeAssetTab}.${i}`}
                onClick={() => selectAsset(activeAssetTab, i, `/${activeAssetTab}/${i}`)}
              >
                <NodeIcon type={activeAssetTab === "materials" ? "group" : "mesh"} />
                <span>
                  {showIndices ? `#${i} ` : ""}
                  {name}
                </span>
                {activeAssetTab === "animations" && (
                  <button
                    className="btn small icon-only"
                    data-testid={`asset-browser.animations.${i}.preview`}
                    title="Playback arrives with the animation runtime."
                    disabled
                    onClick={(e) => e.stopPropagation()}
                  >
                    ▶
                  </button>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
