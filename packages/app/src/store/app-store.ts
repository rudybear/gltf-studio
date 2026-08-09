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
import {
  createDocument,
  DocumentFrozenError,
  GraphEdit,
  HistoryStack,
  save,
  type Command,
  type EditorDocument
} from "@gltf-studio/editor-core";
import { setPointerConfig } from "@gltf-studio/graph-canvas";
import { IndexedDBStorage } from "@gltf-studio/storage";
import { createPlayController } from "@gltf-studio/play";
import type { AudioHost, EngineKind, GizmoMode, PlayController, ProjectMeta, RenderHost, StorageProvider } from "@gltf-studio/engine-api";
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

/**
 * specs/ux-pointer-picker.md: which graph node's `✎` icon (UX-505/UX-508)
 * opened the dialog, and (UX-907) what it's currently pointing at, if
 * anything, so the dialog can preselect that tree item/property/component.
 */
export interface PointerPickerRequest {
  nodeIndex: number;
  graphIndex: number;
  currentPath?: string;
  currentType?: string;
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
  // `HistoryStack.canUndo()`/`canRedo()` read a mutable class instance, not
  // reactive state on their own — mirrored into real store fields (updated
  // wherever `history` mutates: dispatchCommand/undo/redo) so a component
  // that doesn't otherwise re-render on that particular mutation (e.g.
  // TopBar, which doesn't subscribe to `document`, and whose `projectDirty`
  // may already be `true`) still sees the current value rather than a stale
  // one from its last unrelated re-render.
  canUndo: boolean;
  canRedo: boolean;

  // -- play mode (DOC-031/DOC-045, specs/ux-shell.md UX-106/UX-113,
  // specs/ux-viewport.md UX-309/UX-310) --
  playState: "stopped" | "playing" | "paused";
  /** Pending engine-picker selection; only meaningful/settable while `playState === "stopped"`. */
  playEngine: EngineKind;
  /** Registered by `Viewport.tsx` on mount so the store can build a `PlayController` without importing engine-three directly. */
  renderHost: RenderHost | null;
  // -- audio (M7, specs/engine-api.md AH-001/AH-002): registration side only
  // — the CURRENT project's AudioHost instance (real @gltf-studio/audio-
  // webaudio `WebAudioHost` once a document with KHR_audio_emitter is
  // loaded, per `registerAudioHost` below). Ephemeral (DOC-030-style, never
  // persisted): a fresh instance is created and re-registered on every new
  // `document`. Play mode's `SceneAdapter.applyPointer -> renderHost ‖
  // audioHost` fan-out (PC-001) reads this field; wiring that fan-out is
  // NOT this store's concern (see the `packages/play` PR).
  audioHost?: AudioHost;

  // -- selection (DOC-030: ephemeral only) --
  selectedNodeIndex: number | null;
  // -- behavior-graph canvas selection (specs/ux-graph-canvas.md UX-507; DOC-030: ephemeral, additive) --
  selectedGraphNodeIndex: number | null;
  /** Which `extensions.KHR_interactivity.graphs[N]` the canvas shows, when an asset has more than one. */
  selectedGraphIndex: number;
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

  // -- pointer-picker dialog (specs/ux-pointer-picker.md UX-9xx; DOC-030: ephemeral only) --
  pointerPickerRequest: PointerPickerRequest | null;

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
  /**
   * M7 (registration side of specs/engine-api.md's AudioHost — see the
   * `audioHost` field's own doc comment above): sets the store's current
   * `AudioHost` instance. Called from the app's document-load effect once
   * per new `document` (with a freshly constructed `WebAudioHost`) — never
   * from this store itself, which has no document-loading side effects of
   * its own (that lives in `packages/app/src/App.tsx`'s audio-registration
   * effect, mirroring `Viewport.tsx`'s own RenderHost-per-document
   * lifecycle). Passing `undefined` clears it (e.g. on dispose).
   */
  registerAudioHost(host: AudioHost | undefined): void;
  importGlb(file: { name: string; bytes: Uint8Array }): Promise<void>;
  dispatchCommand(command: Command): void;
  undo(): void;
  redo(): void;
  historyEntries(): HistoryEntryView[];
  /** Registers/clears the live `RenderHost` (see `renderHost` field). */
  registerRenderHost(host: RenderHost | null): void;
  /** Only meaningful while `playState === "stopped"`; updates the engine-picker's pending selection. */
  setPlayEngine(engine: EngineKind): void;
  /** UX-310: starts play mode using the current `playEngine`, freezing the document (DOC-031). */
  startPlay(): Promise<void>;
  /** UX-310: suspends the running simulation without discarding variable values. */
  pausePlay(): void;
  /** Resumes a paused simulation from the same point (UX-311). */
  resumePlay(): void;
  /** Advances the simulation by one fixed tick; only meaningful while paused. */
  tickOncePlay(): void;
  /** UX-310: ends play mode, restoring the pre-play scene snapshot (PC-003/PC-007) and unfreezing the document. */
  stopPlay(): Promise<void>;
  selectNode(index: number | null): void;
  selectGraphNode(index: number | null): void;
  setSelectedGraphIndex(index: number): void;
  setHover(index: number | null): void;
  setGizmoMode(mode: GizmoMode): void;
  toggleCollapsed(nodeIndex: number): void;
  toggleShowIndices(): void;
  setActiveAssetTab(tab: AssetTab): void;
  selectAsset(tab: AssetTab, index: number, containerPointer: string): void;
  /** UX-805/UX-800: passive Data-tab update — never switches `activeDockTab` (unlike `selectAsset`). */
  navigateData(pointer: string): void;
  /** specs/ux-graph-canvas.md UX-509: clicking a pointer node's config TEXT — force-switches to the Data tab (UX-806), unlike `navigateData`'s passive update. */
  jumpToDataFromGraph(pointer: string): void;
  /** specs/ux-graph-canvas.md UX-509/UX-505: opens the pointer-picker dialog for the given graph node (UX-907 preselection via `currentPath`/`currentType`, when set). */
  openPointerPicker(info: { nodeIndex: number; currentPath?: string; currentType?: string }): void;
  /** specs/ux-pointer-picker.md UX-908: Cancel/close-x/backdrop/Escape — closes without writing any config change. */
  closePointerPicker(): void;
  /** specs/ux-pointer-picker.md UX-906: "Use pointer" — writes the assembled path+type into the requesting node's config (via `setPointerConfig`) as one undoable command, then closes. */
  confirmPointerPicker(path: string, signature: string): void;
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

// Play mode's live `PlayController` instance and its diagnostic-handler
// unsubscribe, kept as plain module-level bookkeeping (not part of
// `AppState`/not reactive) — mirrors `toastSeq` above. Nothing outside this
// file needs the controller instance itself; components read `playState`/
// call the action methods, and `Viewport.tsx` reaches it only via
// `getActivePlayController()` below (for routing clicks/hover during play).
let activePlayController: PlayController | null = null;
let activePlayDiagnosticsUnsub: (() => void) | null = null;

/**
 * PC-008 routing seam: `Viewport.tsx` calls this inside its click/hover
 * handlers to reach the active `PlayController` without the controller
 * instance itself being exposed as reactive `AppState` (see the module-level
 * `activePlayController` above for why).
 */
export function getActivePlayController(): PlayController | null {
  return activePlayController;
}

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
  audioHost: undefined,

  playState: "stopped",
  playEngine: "interpreter",
  renderHost: null,

  selectedNodeIndex: null,
  selectedGraphNodeIndex: null,
  selectedGraphIndex: 0,
  hoveredNodeIndex: null,
  gizmoMode: "translate",

  collapsedNodes: new Set(),
  showIndices: false,
  activeAssetTab: "meshes",
  selectedAsset: null,

  dataPointer: "",
  pointerPickerRequest: null,
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

  registerAudioHost(host) {
    set({ audioHost: host });
  },

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
        selectedGraphNodeIndex: null,
        selectedGraphIndex: 0,
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
    const { history, storage, projectId, journalSinceRev, log, pushToast, playState } = get();
    if (!history || !projectId) return;
    // DOC-031/DOC-037: UI command dispatch must prevent commands from
    // reaching `applyCommand` while play is running, upstream of
    // `HistoryStack.push`'s own `DocumentFrozenError` throw — this is that
    // pre-check, not just a try/catch backstop.
    if (playState !== "stopped") {
      pushToast("Document locked while playing — Stop to edit.");
      log("warn", "Command rejected: EditorDocument is frozen during play mode (DOC-031).");
      return;
    }
    try {
      history.push(command);
    } catch (err) {
      if (err instanceof DocumentFrozenError) {
        pushToast("Document locked while playing — Stop to edit.");
        return;
      }
      throw err; // anything else is a real bug, don't swallow it
    }
    set({ document: history.document, projectDirty: true, canUndo: history.canUndo(), canRedo: history.canRedo() });
    // SP-004/SP-014: autosave journal wiring — every applied command's
    // forward patches are appended to the project's journal so a crash
    // mid-session can replay back to the same state (SP-015).
    storage.autosaveJournal(projectId, journalSinceRev, command.patches).catch((error: unknown) => {
      log("error", `Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  },

  undo() {
    const { history, playState, pushToast } = get();
    if (!history || !history.canUndo()) return;
    if (playState !== "stopped") {
      pushToast("Document locked while playing — Stop to edit.");
      return;
    }
    try {
      history.undo();
    } catch (err) {
      if (err instanceof DocumentFrozenError) {
        pushToast("Document locked while playing — Stop to edit.");
        return;
      }
      throw err;
    }
    set({ document: history.document, projectDirty: true, canUndo: history.canUndo(), canRedo: history.canRedo() });
  },

  redo() {
    const { history, playState, pushToast } = get();
    if (!history || !history.canRedo()) return;
    if (playState !== "stopped") {
      pushToast("Document locked while playing — Stop to edit.");
      return;
    }
    try {
      history.redo();
    } catch (err) {
      if (err instanceof DocumentFrozenError) {
        pushToast("Document locked while playing — Stop to edit.");
        return;
      }
      throw err;
    }
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

  registerRenderHost(host) {
    set({ renderHost: host });
  },

  setPlayEngine(engine) {
    if (get().playState !== "stopped") return;
    set({ playEngine: engine });
  },

  async startPlay() {
    const { renderHost, history, document, playEngine, pushToast, log } = get();
    if (!renderHost || !history || !document || get().playState !== "stopped") return;

    const controller = createPlayController({
      renderHost,
      getAudioHost: () => get().audioHost,
      getDocumentJson: () => get().document!.json,
      getBinary: () => {
        const container = get().document!.container;
        return container.kind === "glb" ? container.binaryChunk : undefined;
      }
    });

    activePlayDiagnosticsUnsub = controller.onDiagnostic((d) => {
      log(d.kind === "engine-error" ? "error" : "warn", `[play/${d.kind}]${d.pointer ? ` ${d.pointer}` : ""}: ${d.message}`);
    });

    try {
      await controller.start({ engine: playEngine });
    } catch (err) {
      activePlayDiagnosticsUnsub?.();
      activePlayDiagnosticsUnsub = null;
      pushToast(`Play failed to start: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    activePlayController = controller;
    history.freeze(); // DOC-031/DOC-045
    set({ playState: "playing", document: history.document, selectedNodeIndex: null, hoveredNodeIndex: null });
  },

  pausePlay() {
    if (get().playState !== "playing") return;
    activePlayController?.pause();
    set({ playState: "paused" });
  },

  resumePlay() {
    if (get().playState !== "paused") return;
    activePlayController?.resume();
    set({ playState: "playing" });
  },

  tickOncePlay() {
    activePlayController?.tickOnce();
  },

  async stopPlay() {
    const { history } = get();
    if (!activePlayController || !history) return;
    await activePlayController.stop();
    activePlayDiagnosticsUnsub?.();
    activePlayDiagnosticsUnsub = null;
    activePlayController = null;
    history.unfreeze();
    // Clear selection/hover on stop, mirroring startPlay()'s own reset: a selection made via the
    // scene tree DURING play (allowed — it's not itself an edit, UX-113) is not a deliberate
    // post-play editing choice, and resurrecting it here would otherwise let the viewport's gizmo
    // silently reattach to that node the instant play ends (the gizmo-attach effect only checks
    // `selectedNodeIndex`/`playState`, not how old the selection is) — right where `stop()`'s own
    // `renderHost.loadScene()` restore (PC-007) just re-rendered that same node at its restored,
    // on-screen position. A real pointer click landing there (e.g. a test or user re-confirming the
    // restore by clicking the node again) can then be swallowed by TransformControls' own hit-testing
    // as a spurious micro-drag, pushing an unwanted no-op SceneEdit.setTransform onto history instead
    // of reaching the editor's own click-to-select handling.
    set({ playState: "stopped", document: history.document, selectedNodeIndex: null, hoveredNodeIndex: null });
  },

  selectNode(index) {
    set({ selectedNodeIndex: index, selectedAsset: null });
    if (index !== null) {
      // UX-202/UX-805: passive update — does not force-switch the dock tab.
      get().navigateData(`/nodes/${index}`);
    }
  },

  selectGraphNode(index) {
    set({ selectedGraphNodeIndex: index });
  },

  setSelectedGraphIndex(index) {
    set({ selectedGraphIndex: index, selectedGraphNodeIndex: null });
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

  jumpToDataFromGraph(pointer) {
    // UX-509/UX-806: a deliberate "inspect this" action, unlike navigateData's passive update.
    set({ dataPointer: pointer, activeDockTab: "data" });
  },

  openPointerPicker(info) {
    set({ pointerPickerRequest: { graphIndex: get().selectedGraphIndex, ...info } });
  },

  closePointerPicker() {
    set({ pointerPickerRequest: null });
  },

  confirmPointerPicker(path, signature) {
    const { history, dispatchCommand, pointerPickerRequest, pushToast } = get();
    if (!history || !pointerPickerRequest) return;
    const command = setPointerConfig(history.document, pointerPickerRequest.graphIndex, pointerPickerRequest.nodeIndex, path, signature as Parameters<typeof setPointerConfig>[4]);
    dispatchCommand(command);
    set({ pointerPickerRequest: null });
    pushToast(`Pointer set: ${path}`);
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
