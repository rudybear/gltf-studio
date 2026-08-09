import { useRef } from "react";
import { useAppStore } from "../../store/app-store";
import { useSystemPrefersDark } from "../../hooks/use-system-theme";
import { HistoryDropdown } from "./HistoryDropdown";

/**
 * specs/ux-shell.md UX-100 (top bar), UX-108 (history dropdown), UX-105
 * (theme toggle), UX-111 (testid overlay toggle). Export and the play bar
 * are stubs (disabled, with a tooltip) until later milestones (M3 export;
 * the play milestone for playbar) — UX-100/UX-106/UX-107's play-state
 * chrome has no state machine to drive yet, so it isn't rendered at all
 * rather than faked.
 */
export function TopBar(): JSX.Element {
  const projectName = useAppStore((s) => s.projectName);
  const projectDirty = useAppStore((s) => s.projectDirty);
  const importGlb = useAppStore((s) => s.importGlb);
  const exportProject = useAppStore((s) => s.exportProject);
  const hasDocument = useAppStore((s) => s.document !== null);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const historyDropdownOpen = useAppStore((s) => s.historyDropdownOpen);
  const setHistoryDropdownOpen = useAppStore((s) => s.setHistoryDropdownOpen);
  const themeOverride = useAppStore((s) => s.themeOverride);
  const toggleThemeOverride = useAppStore((s) => s.toggleThemeOverride);
  const testIdOverlay = useAppStore((s) => s.testIdOverlay);
  const toggleTestIdOverlay = useAppStore((s) => s.toggleTestIdOverlay);

  const systemPrefersDark = useSystemPrefersDark();
  const effectiveDark = themeOverride ? themeOverride === "dark" : systemPrefersDark;

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await importGlb({ name: file.name, bytes });
  }

  return (
    <div id="topbar" data-testid="topbar.panel">
      <span className="app-name" data-testid="topbar.app-name">
        gltf-studio
      </span>
      <span className="project-name" data-testid="topbar.project-name">
        {projectName}
        {projectDirty ? "*" : ""}
      </span>
      <div className="topbar-group">
        <button className="btn" data-testid="topbar.import" onClick={() => fileInputRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf"
          data-testid="topbar.import-input"
          style={{ display: "none" }}
          onChange={(e) => {
            void onFilePicked(e);
          }}
        />
        <button
          className="btn"
          data-testid="topbar.export"
          disabled={!hasDocument}
          title={hasDocument ? "Export the current document" : "Import a .glb first."}
          onClick={() => {
            void exportProject();
          }}
        >
          Export .glb
        </button>
      </div>
      <div className="topbar-spacer" />
      <div className="playbar" data-testid="playbar.panel">
        <button className="btn icon-only" data-testid="playbar.play" disabled title="Play mode arrives in a later milestone.">
          ▶
        </button>
        <button className="btn icon-only" data-testid="playbar.pause" disabled title="Play mode arrives in a later milestone.">
          ⏸
        </button>
        <button className="btn icon-only" data-testid="playbar.stop" disabled title="Play mode arrives in a later milestone.">
          ⏹
        </button>
        <select className="field" data-testid="playbar.engine-picker" disabled title="Play mode arrives in a later milestone.">
          <option value="interpreter">interpreter</option>
          <option value="compiled">compiled</option>
        </select>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-group">
        <button className="btn icon-only" data-testid="topbar.undo" title="Undo" disabled={!canUndo} onClick={undo}>
          ↶
        </button>
        <button className="btn icon-only" data-testid="topbar.redo" title="Redo" disabled={!canRedo} onClick={redo}>
          ↷
        </button>
        <div className="history-wrap">
          <button
            className="btn small"
            data-testid="topbar.history-toggle"
            onClick={() => setHistoryDropdownOpen(!historyDropdownOpen)}
          >
            History ▾
          </button>
          {historyDropdownOpen && <HistoryDropdown />}
        </div>
        <button
          className="btn icon-only"
          data-testid="topbar.theme-toggle"
          title="Toggle theme"
          onClick={() => toggleThemeOverride(systemPrefersDark)}
        >
          {effectiveDark ? "◐" : "◑"}
        </button>
        <button
          className={`btn icon-only${testIdOverlay ? " active" : ""}`}
          data-testid="topbar.testid-toggle"
          title="Show UX test IDs"
          onClick={toggleTestIdOverlay}
        >
          ?
        </button>
      </div>
    </div>
  );
}
