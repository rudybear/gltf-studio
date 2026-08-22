import { ANIM_CLIP_DRAG_MIME } from "@gltf-studio/graph-canvas";
import type { UsageRef } from "@gltf-studio/usage-index";
import { useAppStore } from "../../store/app-store";
import type { AssetTab } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { useUsageIndexes } from "../../hooks/use-usage-indexes";
import { NodeIcon } from "./NodeIcon";
import { UsageBadge } from "../UsageBadge";
import { AudioClipsPanel } from "./AudioClipsPanel";

const TABS: Array<{ key: AssetTab; label: string; testid: string }> = [
  { key: "meshes", label: "Meshes", testid: "asset-browser.tab.meshes" },
  { key: "materials", label: "Materials", testid: "asset-browser.tab.materials" },
  { key: "audio", label: "Audio Clips", testid: "asset-browser.tab.audio-clips" },
  { key: "animations", label: "Animations", testid: "asset-browser.tab.animations" }
];

/**
 * specs/ux-scene-tree.md UX-210/UX-211/UX-218..222: the document's actual
 * owned meshes/materials/animations arrays (each entry listed once, never
 * once per referencing scene node), PLUS a real Audio Clips tab (clip
 * management: import/embed/add-by-reference/delete-blocked/preview,
 * `AudioClipsPanel.tsx`) — closing this file's former OPEN(UX-asset-audio-
 * tab-tbd): see `specs/ux-scene-tree.md`'s own updated note for why clip
 * rows still don't force-switch to the Data tab the way a Meshes/Materials/
 * Animations row does (UX-211) — the Audio Clips tab IS the clip inspector
 * now, richer than the Data tab's read-only view would be.
 */
export function AssetBrowser(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const activeAssetTab = useAppStore((s) => s.activeAssetTab);
  const setActiveAssetTab = useAppStore((s) => s.setActiveAssetTab);
  const selectedAsset = useAppStore((s) => s.selectedAsset);
  const selectAsset = useAppStore((s) => s.selectAsset);
  const showIndices = useAppStore((s) => s.showIndices);
  const showUsageBadges = useAppStore((s) => s.showUsageBadges);
  const jumpUsageRefToGraph = useAppStore((s) => s.jumpUsageRefToGraph);
  const flashTarget = useAppStore((s) => s.flashTarget);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const audioFolderHandle = useAppStore((s) => s.audioFolderHandle);
  const grantAudioFolder = useAppStore((s) => s.grantAudioFolder);
  const pushToast = useAppStore((s) => s.pushToast);
  // UX-1116 (specs/ux-usage-mapping.md): shares the SAME toggle state
  // `SceneTree.tsx`'s header button owns — one app-wide "show badges"
  // setting across both surfaces, the same way `showIndices` already has
  // exactly one toggle button (also in `SceneTree.tsx`) governing both.
  const usageIndexes = useUsageIndexes(document?.json);

  const json = document?.json as GltfJsonShape | undefined;
  const rowsFor = (tab: AssetTab): string[] => {
    if (tab === "meshes") return (json?.meshes ?? []).map((m, i) => m.name ?? `Mesh ${i}`);
    if (tab === "materials") return (json?.materials ?? []).map((m, i) => m.name ?? `Material ${i}`);
    if (tab === "animations") return (json?.animations ?? []).map((a, i) => a.name ?? `Animation ${i}`);
    return [];
  };
  const rows = rowsFor(activeAssetTab);
  /** UX-1116: the active tab's own asset-usage map, or `null` for a tab this index doesn't cover (Audio Clips — unwired per this file's own header note). */
  const usageRefsFor = (index: number): UsageRef[] | undefined => {
    if (activeAssetTab === "materials") return usageIndexes.assets.materials.get(index);
    if (activeAssetTab === "meshes") return usageIndexes.assets.meshes.get(index);
    if (activeAssetTab === "animations") return usageIndexes.assets.animations.get(index);
    return undefined;
  };

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
          document ? (
            <AudioClipsPanel
              document={document}
              dispatchCommand={dispatchCommand}
              audioFolderHandle={audioFolderHandle}
              grantAudioFolder={grantAudioFolder}
              showIndices={showIndices}
              pushToast={pushToast}
            />
          ) : (
            <div className="empty-note" data-testid="asset-browser.audio-clips.empty">
              Import a .glb first.
            </div>
          )
        ) : rows.length === 0 ? (
          <div className="empty-note" data-testid={`asset-browser.${activeAssetTab}.empty`}>
            {document ? "None in this document." : "Import a .glb first."}
          </div>
        ) : (
          <div className="asset-list">
            {rows.map((name, i) => {
              const flashed = flashTarget?.kind === "asset-row" && flashTarget.tab === activeAssetTab && flashTarget.index === i;
              const usageRefs = usageRefsFor(i);
              return (
              <div
                key={i}
                className={`asset-item${selectedAsset?.tab === activeAssetTab && selectedAsset.index === i ? " selected" : ""}${flashed ? " flash-highlight" : ""}`}
                data-testid={`asset-browser.${activeAssetTab}.${i}`}
                onClick={() => selectAsset(activeAssetTab, i, `/${activeAssetTab}/${i}`)}
                draggable={activeAssetTab === "animations"}
                onDragStart={
                  activeAssetTab === "animations"
                    ? (e) => {
                        // specs/ux-graph-canvas.md UX-508: dragged onto the
                        // canvas, opens a drop-menu offering animation/start|stop.
                        e.dataTransfer.setData(ANIM_CLIP_DRAG_MIME, String(i));
                        e.dataTransfer.setData("text/plain", String(i));
                        e.dataTransfer.effectAllowed = "copy";
                      }
                    : undefined
                }
              >
                <NodeIcon type={activeAssetTab === "materials" ? "group" : "mesh"} />
                <span>
                  {showIndices ? `#${i} ` : ""}
                  {name}
                </span>
                {showUsageBadges && usageRefs && usageRefs.length > 0 && (
                  <UsageBadge
                    count={usageRefs.length}
                    testId={`asset-browser.${activeAssetTab}.${i}.usage-badge`}
                    onClick={() => {
                      // UX-1116: an asset entity has no Inspector "Used in
                      // behavior" section of its own (unlike a scene node,
                      // UX-1106) — jumps to its FIRST reference in the
                      // Behavior graph instead, reusing UX-1108's own
                      // →Graph jump verbatim.
                      jumpUsageRefToGraph(usageRefs[0]!);
                    }}
                  />
                )}
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
