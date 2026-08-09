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
import { createDocument, HistoryStack, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import { IndexedDBStorage } from "@gltf-studio/storage";
import type { ProjectMeta, StorageProvider } from "@gltf-studio/engine-api";

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

  // -- selection (DOC-030: ephemeral only) --
  selectedNodeIndex: number | null;

  // -- scene tree / asset browser ephemeral UI (UX-2xx) --
  collapsedNodes: Set<number>;
  showIndices: boolean; // UX-203/204: session-only, always starts off
  activeAssetTab: AssetTab;
  selectedAsset: { tab: AssetTab; index: number } | null;

  // -- data tab (UX-8xx) --
  dataPointer: string; // e.g. "/nodes/0"; "" when nothing to show

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
  toggleCollapsed(nodeIndex: number): void;
  toggleShowIndices(): void;
  setActiveAssetTab(tab: AssetTab): void;
  selectAsset(tab: AssetTab, index: number, containerPointer: string): void;
  /** UX-805/UX-800: passive Data-tab update — never switches `activeDockTab` (unlike `selectAsset`). */
  navigateData(pointer: string): void;
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

  selectedNodeIndex: null,

  collapsedNodes: new Set(),
  showIndices: false,
  activeAssetTab: "meshes",
  selectedAsset: null,

  dataPointer: "",

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
        selectedNodeIndex: null,
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
    set({ document: history.document, projectDirty: true });
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
    set({ document: history.document, projectDirty: true });
  },

  redo() {
    const { history } = get();
    if (!history || !history.canRedo()) return;
    history.redo();
    set({ document: history.document, projectDirty: true });
  },

  historyEntries() {
    // HistoryStack does not expose its log directly (only canUndo/canRedo +
    // the current document) — v1 has no UI path that pushes commands yet
    // (UX-206: the add-menu is a stub), so there is nothing to enumerate.
    // This returns an empty list honestly rather than fabricating entries;
    // the dropdown renders "No history yet." for an empty list.
    return [];
  },

  selectNode(index) {
    set({ selectedNodeIndex: index, selectedAsset: null });
    if (index !== null) {
      // UX-202/UX-805: passive update — does not force-switch the dock tab.
      get().navigateData(`/nodes/${index}`);
    }
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
