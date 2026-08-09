// The app's single zustand store: wraps editor-core's EditorDocument/
// HistoryStack, ephemeral UI state (selection, panel sizes, dock/tab
// choice, theme override, testid overlay, session-only show-indices —
// DOC-030), and the StorageProvider instance persistence goes through
// (SP-001). See specs/document-model.md DOC-028..031 for which state lives
// where: graph-node positions in `json` (editor-core's concern, not this
// store's), panel layout/camera bookmarks in a per-project sidecar
// (persisted via StorageProvider, not implemented as an editable surface
// yet at M2 — no panel-layout-affecting UI beyond resize exists to save),
// and selection/hover/play-mode here, ephemeral, never written to `json`
// or the sidecar.
import { create } from "zustand";
import { parseContainer } from "@gltfi/gltf";
import { createDocument, GraphEdit, HistoryStack, save, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import { IndexedDBStorage } from "@gltf-studio/storage";
import type { GizmoMode, ProjectMeta, StorageProvider } from "@gltf-studio/engine-api";
import { triggerBrowserDownload, trySaveFilePicker } from "../lib/export.js";

export type ThemeOverride = "light" | "dark" | null;
export type DockTab = "graph" | "audio-graph" | "script" | "console" | "data";
export type RightTab = "inspector" | "copilot";
export type AssetTab = "meshes" | "materials" | "audio" | "animations";

export interface ConsoleLine {
  level: "info" | "warn" | "error";
  text: string;
  ts: string;
}

export interface ToastMessage {
  id: number;
  text: string;
}

export interface HistoryEntryView {
  index: number;
  label: string;
  isCurrent: boolean;
}

export interface PanelSizes {
  leftWidth: number;
  rightWidth: number;
  dockHeight: number;
}

/**
 * specs/ux-inspector.md UX-403/UX-409: a transient "you found it" pointer,
 * cleared automatically ~900ms after being set (matching the approved
 * mockup's `flashHighlight` timing) — ephemeral only (DOC-030), never
 * written to `json`/the sidecar. `inspector-section` drives the Inspector's
 * own section flash (UX-403's mesh/extensions identity chips); `asset-row`
 * drives the asset browser's row flash (UX-409's mesh-primitive material
 * link).
 */
export type FlashTarget = { kind: "inspector-section"; id: string } | { kind: "asset-row"; tab: AssetTab; index: number };

export const PANEL_BOUNDS = {
  left: { min: 190, max: 480, default: 260 },
  right: { min: 220, max: 480, default: 300 },
  dock: { min: 140, default: 300 } // max is 70vh, computed against window height where used
};

export interface AppState {
  // -- project / document (SP-001, DOC-001..031) --
  storage: StorageProvider;
  projectId: string | null;
  projectName: string;
  projectDirty: boolean;
  history: HistoryStack | null;
  document: EditorDocument | null;
  journalSinceRev: number;
  // `HistoryStack.canUndo()`/`canRedo()` read a mutable class instance, not
  // reactive state on their own — mirrored into real store fields (updated
  // wherever `history` mutates: dispatchCommand/undo/redo) so a component
  // that doesn't otherwise re-render on that particular mutation (e.g.
  // TopBar, which doesn't subscribe to `document`, and whose `projectDirty`
  // may already be `true`) still sees the current value rather than a stale
  // one from its last unrelated re-render.
  canUndo: boolean;
  canRedo: boolean;

  // -- selection (DOC-030: ephemeral only) --
  selectedNodeIndex: number | null;
  // -- viewport hover + gizmo mode (DOC-030: ephemeral only; specs/ux-viewport.md UX-301/UX-304) --
  hoveredNodeIndex: number | null;
  gizmoMode: GizmoMode;

  // -- scene tree / asset browser ephemeral UI (UX-2xx) --
  collapsedNodes: Set<number>;
  showIndices: boolean; // UX-203/204: session-only, always starts off
  activeAssetTab: AssetTab;
  selectedAsset: { tab: AssetTab; index: number } | null;

  // -- data tab (UX-8xx) --
  dataPointer: string; // e.g. "/nodes/0"; "" when nothing to show

  // -- inspector (UX-4xx: ephemeral only, DOC-030) --
  flashTarget: FlashTarget | null;

  // -- shell chrome (UX-1xx) --
  themeOverride: ThemeOverride;
  testIdOverlay: boolean;
  activeDockTab: DockTab;
  activeRightTab: RightTab;
  historyDropdownOpen: boolean;
  panelSizes: PanelSizes;

  // -- console + toasts --
  consoleLines: ConsoleLine[];
  toasts: ToastMessage[];

  // -- actions --
  importGlb(file: { name: string; bytes: Uint8Array }): Promise<void>;
  dispatchCommand(command: Command): void;
  undo(): void;
  redo(): void;
  historyEntries(): HistoryEntryView[];
  selectNode(index: number | null): void;
  setHover(index: number | null): void;
  setGizmoMode(mode: GizmoMode): void;
  toggleCollapsed(nodeIndex: number): void;
  toggleShowIndices(): void;
  setActiveAssetTab(tab: AssetTab): void;
  selectAsset(tab: AssetTab, index: number, containerPointer: string): void;
  /** UX-805/UX-800: passive Data-tab update — never switches `activeDockTab` (unlike `selectAsset`). */
  navigateData(pointer: string): void;
  /** UX-409: switches the asset browser to Materials and briefly flashes that row — does NOT force-switch the bottom dock (unlike `selectAsset`/UX-211). */
  selectMaterialContext(materialIndex: number): void;
  /** UX-403/UX-409: sets a transient flash target, auto-clearing itself after ~900ms. */
  triggerFlash(target: FlashTarget): void;
  /** UX-402/UX-411: best-effort clipboard copy of a pointer path, confirmed via a toast (UX-109). */
  copyPointerPath(path: string): void;
  /**
   * UX-411/UX-412: creates a `pointer/set`/`pointer/interpolate` node in the
   * behavior graph pre-configured against `pointerPath`, scaffolding the
   * graph first if none exists yet (`GraphEdit.ensureGraph`, DOC-041), as one
   * undoable command; switches the bottom dock to the Behavior graph tab.
   */
  addPointerGraphNode(kind: "set" | "interpolate", pointerPath: string, signature: string): void;
  /**
   * M3: real export — `editor-core`'s byte-preserving `save()` -> a browser
   * download (or a File-System-Access save-to-handle when the current
   * `StorageProvider` reports `capabilities.fileHandles`); toasts a summary
   * of the save report (spliced roots / reserialized, DOC-026).
   */
  exportProject(): Promise<void>;
  setThemeOverride(theme: ThemeOverride): void;
  toggleThemeOverride(systemPrefersDark: boolean): void;
  toggleTestIdOverlay(): void;
  setActiveDockTab(tab: DockTab): void;
  setActiveRightTab(tab: RightTab): void;
  setHistoryDropdownOpen(open: boolean): void;
  setPanelSize(which: keyof PanelSizes, value: number): void;
  log(level: ConsoleLine["level"], text: string): void;
  pushToast(text: string): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  storage: new IndexedDBStorage(),
  projectId: null,
  projectName: "Untitled Project",
  projectDirty: false,
  history: null,
  document: null,
  journalSinceRev: 0,
  canUndo: false,
  canRedo: false,

  selectedNodeIndex: null,
  hoveredNodeIndex: null,
  gizmoMode: "translate",

  collapsedNodes: new Set(),
  showIndices: false,
  activeAssetTab: "meshes",
  selectedAsset: null,

  dataPointer: "",
  flashTarget: null,

  themeOverride: null,
  testIdOverlay: false,
  activeDockTab: "graph",
  activeRightTab: "inspector",
  historyDropdownOpen: false,
  panelSizes: {
    leftWidth: PANEL_BOUNDS.left.default,
    rightWidth: PANEL_BOUNDS.right.default,
    dockHeight: PANEL_BOUNDS.dock.default
  },

  consoleLines: [],
  toasts: [],

  async importGlb(file) {
    const { storage, log, pushToast } = get();
    try {
      const container = parseContainer(file.bytes);
      const document = createDocument(container);
      const history = new HistoryStack(document);

      const now = new Date().toISOString();
      const name = file.name.replace(/\.(glb|gltf)$/i, "");
      const meta: ProjectMeta = await storage.create({ name, createdAt: now, updatedAt: now });
      await storage.save(meta.id, { meta, container: file.bytes, sidecar: null });

      set({
        projectId: meta.id,
        projectName: name,
        projectDirty: false,
        history,
        document,
        journalSinceRev: document.rev,
        canUndo: false,
        canRedo: false,
        selectedNodeIndex: null,
        hoveredNodeIndex: null,
        selectedAsset: null,
        dataPointer: "",
        collapsedNodes: new Set()
      });
      log("info", `Imported "${file.name}" (${file.bytes.byteLength.toLocaleString()} bytes).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `Import failed: ${message}`);
      pushToast(`Import failed: ${message}`);
    }
  },

  dispatchCommand(command) {
    const { history, storage, projectId, journalSinceRev, log } = get();
    if (!history || !projectId) return;
    history.push(command);
    set({ document: history.document, projectDirty: true, canUndo: history.canUndo(), canRedo: history.canRedo() });
    // SP-004/SP-014: autosave journal wiring — every applied command's
    // forward patches are appended to the project's journal so a crash
    // mid-session can replay back to the same state (SP-015).
    storage.autosaveJournal(projectId, journalSinceRev, command.patches).catch((error: unknown) => {
      log("error", `Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  },

  undo() {
    const { history } = get();
    if (!history || !history.canUndo()) return;
    history.undo();
    set({ document: history.document, projectDirty: true, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },

  redo() {
    const { history } = get();
    if (!history || !history.canRedo()) return;
    history.redo();
    set({ document: history.document, projectDirty: true, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },

  historyEntries() {
    // DOC-039: HistoryStack.entries()/currentIndex() are real as of the M2
    // viewport-integration PR (gizmo commits, SceneEdit.setTransform, are
    // the first UI path that pushes a Command — UX-206's scene-tree
    // add-menu remains a stub deferred to M8's structural scene editing).
    const { history } = get();
    if (!history) return [];
    const current = history.currentIndex();
    return history.entries().map((entry) => ({ ...entry, isCurrent: entry.index === current }));
  },

  selectNode(index) {
    set({ selectedNodeIndex: index, selectedAsset: null });
    if (index !== null) {
      // UX-202/UX-805: passive update — does not force-switch the dock tab.
      get().navigateData(`/nodes/${index}`);
    }
  },

  setHover(index) {
    set({ hoveredNodeIndex: index });
  },

  setGizmoMode(mode) {
    set({ gizmoMode: mode });
  },

  toggleCollapsed(nodeIndex) {
    set((state) => {
      const next = new Set(state.collapsedNodes);
      if (next.has(nodeIndex)) next.delete(nodeIndex);
      else next.add(nodeIndex);
      return { collapsedNodes: next };
    });
  },

  toggleShowIndices() {
    set((state) => ({ showIndices: !state.showIndices }));
  },

  setActiveAssetTab(tab) {
    set({ activeAssetTab: tab });
  },

  selectAsset(tab, index, containerPointer) {
    // UX-211/UX-806: a deliberate "inspect this" action — force-switches the dock to Data.
    set({ selectedAsset: { tab, index }, activeAssetTab: tab, activeDockTab: "data", dataPointer: containerPointer });
  },

  navigateData(pointer) {
    set({ dataPointer: pointer });
  },

  selectMaterialContext(materialIndex) {
    set({ activeAssetTab: "materials" });
    get().triggerFlash({ kind: "asset-row", tab: "materials", index: materialIndex });
  },

  triggerFlash(target) {
    set({ flashTarget: target });
    setTimeout(() => {
      // Only clear if nothing newer has replaced it in the meantime.
      set((state) => (state.flashTarget === target ? { flashTarget: null } : {}));
    }, 900);
  },

  copyPointerPath(path) {
    try {
      void navigator.clipboard?.writeText(path);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — still toast;
      // the toast is the user-visible confirmation either way.
    }
    get().pushToast(`Copied ${path}`);
  },

  addPointerGraphNode(kind, pointerPath, signature) {
    const { history, dispatchCommand, setActiveDockTab, pushToast } = get();
    if (!history) return;
    const command = GraphEdit.addPointerNode(history.document, 0, kind, pointerPath, signature);
    dispatchCommand(command);
    setActiveDockTab("graph");
    pushToast(`Added ${kind === "set" ? "pointer/set" : "pointer/interpolate"} node for ${pointerPath}.`);
  },

  async exportProject() {
    const { history, storage, projectName, log, pushToast } = get();
    if (!history) return;

    try {
      const result = save(history.document);
      const isGlb = result.document.container.kind === "glb";
      const filename = `${(projectName || "untitled").trim() || "untitled"}.${isGlb ? "glb" : "gltf"}`;
      const blob = new Blob([result.report.bytes as BlobPart], { type: isGlb ? "model/gltf-binary" : "model/gltf+json" });

      const savedViaHandle = storage.capabilities.fileHandles ? await trySaveFilePicker(blob, filename) : "unsupported";
      if (savedViaHandle === "cancelled") return; // user backed out of the native picker — not a failure, no toast.
      if (savedViaHandle === "unsupported") {
        await triggerBrowserDownload(blob, filename);
      }

      set({ projectDirty: false });
      const report = result.report;
      const summary = report.reserialized
        ? "Export complete (full reserialize)."
        : report.splicedRoots.length > 0
          ? `Export complete (spliced ${report.splicedRoots.length} root${report.splicedRoots.length === 1 ? "" : "s"}).`
          : "Export complete (no changes since import).";
      pushToast(summary);
      log("info", `Exported "${filename}": ${JSON.stringify(report.splicedRoots)}, reserialized=${report.reserialized}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `Export failed: ${message}`);
      pushToast(`Export failed: ${message}`);
    }
  },

  setThemeOverride(theme) {
    set({ themeOverride: theme });
  },

  toggleThemeOverride(systemPrefersDark) {
    const { themeOverride } = get();
    const current = themeOverride ?? (systemPrefersDark ? "dark" : "light");
    set({ themeOverride: current === "dark" ? "light" : "dark" });
  },

  toggleTestIdOverlay() {
    set((state) => ({ testIdOverlay: !state.testIdOverlay }));
  },

  setActiveDockTab(tab) {
    set({ activeDockTab: tab });
  },

  setActiveRightTab(tab) {
    set({ activeRightTab: tab });
  },

  setHistoryDropdownOpen(open) {
    set({ historyDropdownOpen: open });
  },

  setPanelSize(which, value) {
    set((state) => ({ panelSizes: { ...state.panelSizes, [which]: value } }));
  },

  log(level, text) {
    set((state) => ({
      consoleLines: [...state.consoleLines, { level, text, ts: new Date().toLocaleTimeString() }]
    }));
  },

  pushToast(text) {
    const id = ++toastSeq;
    set((state) => ({ toasts: [...state.toasts, { id, text }] }));
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  }
}));
