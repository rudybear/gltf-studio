import { useRef } from "react";
import type { EngineKind } from "@gltf-studio/engine-api";
import { useAppStore } from "../../store/app-store";
import { useSystemPrefersDark } from "../../hooks/use-system-theme";
import { HistoryDropdown } from "./HistoryDropdown";
import { filesFromDataTransfer } from "../../lib/file-drop.js";
import { useTourState } from "../../tour/tour-state";
import { useSettingsState } from "../../settings/settings-state.js";

// `window.showOpenFilePicker` isn't declared in TypeScript's bundled `dom`
// lib (same reason `packages/app/src/lib/export.ts`'s own
// `ShowSaveFilePicker`, and `MissingFilesDialog.tsx`'s own
// `ShowDirectoryPicker`, are local structural types rather than real File
// System Access DOM types) — a small local shape covers exactly what this
// file calls; a real `FileSystemFileHandle.getFile()` returns a genuine
// `File`, which `importFiles` already accepts.
interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}
interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
}
type ShowOpenFilePicker = (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandleLike[]>;

function getShowOpenFilePicker(): ShowOpenFilePicker | undefined {
  return (window as unknown as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;
}

/**
 * specs/ux-shell.md UX-100 (top bar), UX-108 (history dropdown), UX-105
 * (theme toggle), UX-111 (testid overlay toggle), UX-106/UX-113 (play-state
 * chrome + real play-bar wiring against `PlayController` via the store's
 * `startPlay`/`pausePlay`/`resumePlay`/`stopPlay`/`setPlayEngine` actions),
 * UX-130 (`playbar.debug-toggle` — enabled only for the compiled engine
 * while stopped; its checked state becomes `PlayStartOptions.debug`, PC-009,
 * the next time Play starts; full behavior contract in specs/ux-debugger.md's
 * UX-1500 block),
 * UX-121 (`topbar.tour-start` — a distinct glyph from UX-111's `?`, starts
 * `specs/ux-tour.md`'s tour at step 1 regardless of prior state), UX-129
 * (`topbar.settings` — opens `specs/ux-settings.md`'s settings dialog).
 * Export is real as of M3.
 */
const SAVE_STATUS_LABEL: Record<"saved" | "saving" | "unsaved", string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes"
};

export function TopBar(): JSX.Element {
  const projectName = useAppStore((s) => s.projectName);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const importFiles = useAppStore((s) => s.importFiles);
  const exportProject = useAppStore((s) => s.exportProject);
  const openProjectManager = useAppStore((s) => s.openProjectManager);
  const openShareDialog = useAppStore((s) => s.openShareDialog);
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
  const startTour = useTourState((s) => s.start);
  const openSettings = useSettingsState((s) => s.open);
  const playState = useAppStore((s) => s.playState);
  const playEngine = useAppStore((s) => s.playEngine);
  const playDebug = useAppStore((s) => s.playDebug);
  const startPlay = useAppStore((s) => s.startPlay);
  const pausePlay = useAppStore((s) => s.pausePlay);
  const resumePlay = useAppStore((s) => s.resumePlay);
  const stopPlay = useAppStore((s) => s.stopPlay);
  const setPlayEngine = useAppStore((s) => s.setPlayEngine);
  const setPlayDebug = useAppStore((s) => s.setPlayDebug);

  const systemPrefersDark = useSystemPrefersDark();
  const effectiveDark = themeOverride ? themeOverride === "dark" : systemPrefersDark;

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length === 0) return;
    await importFiles(files);
  }

  // specs/ux-shell.md UX-118: when the browser supports it (Chrome/Edge),
  // clicking Import uses `showOpenFilePicker` (a native multi-select dialog)
  // instead of the hidden `<input>` -- one step fewer than click -> hidden
  // `<input>` -> OS dialog, though it still can't grant directory access on
  // its own (a single `.gltf` picked this way with unresolved references
  // still surfaces the UX-117 missing-files dialog same as the `<input>`
  // path). Falls back to the `<input>` automatically when unsupported, or if
  // the picker throws for any reason other than the user cancelling it.
  async function onImportClick(): Promise<void> {
    const showOpenFilePicker = getShowOpenFilePicker();
    if (showOpenFilePicker) {
      try {
        const handles = await showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: "glTF/GLB assets",
              accept: {
                "model/gltf-binary": [".glb"],
                "model/gltf+json": [".gltf"],
                "application/octet-stream": [".bin"],
                "image/*": [".png", ".jpg", ".jpeg", ".webp"],
                "audio/*": [".mp3", ".wav", ".ogg"]
              }
            }
          ]
        });
        const files = await Promise.all(handles.map((h) => h.getFile()));
        if (files.length > 0) await importFiles(files);
        return;
      } catch (err) {
        // AbortError: the user dismissed the native picker -- same as
        // closing the `<input>` dialog with nothing picked, do nothing more.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Anything else (the API exists but threw for some other reason):
        // fall through to the always-available `<input>` fallback below.
      }
    }
    fileInputRef.current?.click();
  }

  // Drag-and-drop onto the Import control: a multi-file .gltf + siblings
  // (or a single .glb), OR an entire dropped FOLDER (UX-118,
  // `filesFromDataTransfer`'s directory-entry traversal), goes through the
  // exact same `importFiles` path as a multi-select via the file input, per
  // specs/ux-shell.md's import requirements. `stopPropagation` keeps
  // App.tsx's whole-window drop handler from ALSO importing the same drop a
  // second time.
  function onImportDragOver(e: React.DragEvent<HTMLButtonElement>): void {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }

  async function onImportDrop(e: React.DragEvent<HTMLButtonElement>): Promise<void> {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length > 0) await importFiles(files);
  }

  const topbarTintClass = playState === "playing" ? "topbar-playing" : playState === "paused" ? "topbar-paused" : "";

  return (
    <div id="topbar" className={topbarTintClass || undefined} data-testid="topbar.panel">
      <span className="app-name" data-testid="topbar.app-name">
        gltf-studio
      </span>
      <span className="project-name" data-testid="topbar.project-name">
        {projectName}
      </span>
      {hasDocument && (
        <span className={`save-status save-status-${saveStatus}`} data-testid="topbar.save-status">
          {SAVE_STATUS_LABEL[saveStatus]}
        </span>
      )}
      <div className="topbar-group">
        <button className="btn" data-testid="topbar.projects" title="Open the project manager" onClick={openProjectManager}>
          Projects
        </button>
        <button
          className="btn"
          data-testid="topbar.import"
          title="Import a .glb, or a .gltf together with its .bin/texture/audio siblings — select them together, or drag-and-drop a whole folder at once."
          onClick={() => {
            void onImportClick();
          }}
          onDragOver={onImportDragOver}
          onDrop={(e) => {
            void onImportDrop(e);
          }}
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.mp3,.wav,.ogg"
          multiple
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
        <button
          className="btn"
          data-testid="topbar.share"
          disabled={!hasDocument}
          title={hasDocument ? "Share this project" : "Import a .glb first."}
          onClick={() => {
            void openShareDialog();
          }}
        >
          Share
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
        <button
          className={`btn icon-only${playDebug ? " active" : ""}`}
          data-testid="playbar.debug-toggle"
          disabled={playEngine !== "compiled" || playState !== "stopped"}
          title={
            playEngine !== "compiled"
              ? "Debugging needs the compiled engine — switch engine to enable."
              : "Debug: show this graph's compiled script in your browser's DevTools (Sources → gltf-studio://)"
          }
          onClick={() => setPlayDebug(!playDebug)}
        >
          🐞
        </button>
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
        <button
          className="btn icon-only"
          data-testid="topbar.tour-start"
          title="Take the tour"
          onClick={startTour}
        >
          ◎
        </button>
        <button className="btn icon-only" data-testid="topbar.settings" title="Settings" onClick={openSettings}>
          ⚙
        </button>
      </div>
    </div>
  );
}
