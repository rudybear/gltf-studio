import { useRef } from "react";
import type { EngineKind } from "@gltf-studio/engine-api";
import { useAppStore } from "../../store/app-store";
import { useSystemPrefersDark } from "../../hooks/use-system-theme";
import { HistoryDropdown } from "./HistoryDropdown";

/**
 * specs/ux-shell.md UX-100 (top bar), UX-108 (history dropdown), UX-105
 * (theme toggle), UX-111 (testid overlay toggle), UX-106/UX-113 (play-state
 * chrome + real play-bar wiring against `PlayController` via the store's
 * `startPlay`/`pausePlay`/`resumePlay`/`stopPlay`/`setPlayEngine` actions).
 * Export is real as of M3.
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
  const playState = useAppStore((s) => s.playState);
  const playEngine = useAppStore((s) => s.playEngine);
  const startPlay = useAppStore((s) => s.startPlay);
  const pausePlay = useAppStore((s) => s.pausePlay);
  const resumePlay = useAppStore((s) => s.resumePlay);
  const stopPlay = useAppStore((s) => s.stopPlay);
  const setPlayEngine = useAppStore((s) => s.setPlayEngine);

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

  const topbarTintClass = playState === "playing" ? "topbar-playing" : playState === "paused" ? "topbar-paused" : "";

  return (
    <div id="topbar" className={topbarTintClass || undefined} data-testid="topbar.panel">
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
        <button
          className="btn icon-only"
          data-testid="playbar.play"
          disabled={!hasDocument || playState === "playing"}
          title={!hasDocument ? "Import a .glb first." : playState === "paused" ? "Resume" : "Play"}
          onClick={() => {
            if (playState === "paused") resumePlay();
            else void startPlay();
          }}
        >
          ▶
        </button>
        <button
          className="btn icon-only"
          data-testid="playbar.pause"
          disabled={playState !== "playing"}
          title="Pause"
          onClick={pausePlay}
        >
          ⏸
        </button>
        <button
          className="btn icon-only"
          data-testid="playbar.stop"
          disabled={playState === "stopped"}
          title="Stop"
          onClick={() => {
            void stopPlay();
          }}
        >
          ⏹
        </button>
        <select
          className="field"
          data-testid="playbar.engine-picker"
          disabled={playState !== "stopped"}
          value={playEngine}
          title="Play engine"
          onChange={(e) => setPlayEngine(e.target.value as EngineKind)}
        >
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
