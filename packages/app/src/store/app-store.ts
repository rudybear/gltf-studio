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
  applyPatches,
  createDocument,
  DocumentFrozenError,
  getIn,
  GraphEdit,
  HistoryStack,
  save,
  SceneEdit,
  type Command,
  type EditorDocument
} from "@gltf-studio/editor-core";
import { setPointerConfig } from "@gltf-studio/graph-canvas";
import { findEnclosingHandlerRoot, graphNodeSceneRef, type UsageDocJson, type UsageGraphNode, type UsageInteractivityGraph, type UsageRef } from "@gltf-studio/usage-index";
import { IndexedDBStorage } from "@gltf-studio/storage";
import { createPlayController } from "@gltf-studio/play";
import { MockAgentProvider } from "@gltf-studio/agent-mock";
import type {
  AgentContextRef,
  AudioHost,
  EngineKind,
  GizmoMode,
  PlayController,
  Proposal,
  ProjectMeta,
  RenderHost,
  StorageProvider
} from "@gltf-studio/engine-api";
import { triggerBrowserDownload, trySaveFilePicker } from "../lib/export.js";
import { packMultiFileGltf, type PackFileMap } from "../lib/pack-gltf.js";
import { extractBinaryChunk } from "../lib/audio-container.js";
import { resolveUrisFromDirectory, type DirectoryHandleLike } from "@gltf-studio/storage";

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

/** The minimal shape `importFiles`/`packMultiFileGltf` need from a selected/dropped/`showOpenFilePicker`-returned file — a real `File` satisfies it. */
export interface ImportFileLike {
  name: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * specs/ux-shell.md UX-117: state for the missing-files dialog a single
 * `.gltf` pick (or drop) with unresolved `buffers[].uri`/`images[].uri`/
 * `KHR_audio_emitter.audio[].uri` references opens, alongside the existing
 * UX-116 toast — `gltfFile` and `otherFiles` are exactly what `importFiles`
 * already had in hand when `packMultiFileGltf` reported `missing`, kept
 * around so `grantFolderAndRetryImport` can re-run the same pack attempt
 * once the missing names resolve against a granted directory, with no need
 * to ask the user to reselect anything already provided.
 */
export interface MissingFilesDialogState {
  gltfFile: ImportFileLike;
  otherFiles: PackFileMap;
  missing: string[];
  /** True while a "Grant folder access…" attempt is in flight (disables the dialog's action button; distinct from the native picker's own modality). */
  resolving: boolean;
}

/**
 * specs/ux-copilot.md UX-1001/UX-1002: one removable, user-visible wrapper
 * per `AgentContextRef` currently attached as context for the NEXT request
 * (AG-013 — nothing reaches `AgentService.request` that isn't shown here
 * first). `id` is a locally-generated React key/removal handle, independent
 * of anything in `ref` itself. `label` is the chip's display text (e.g.
 * "Selection: Cube_003", "Graph 0", "Attached: /materials/0") — computed
 * once at attach time rather than re-derived from `ref` on every render, so
 * callers (inline `✦` affordances) control exactly what's shown.
 */
export interface CopilotContextChip {
  id: string;
  ref: AgentContextRef;
  label: string;
}

/**
 * specs/ux-copilot.md UX-1003..UX-1007: one entry in the Copilot thread.
 * "user"/"pending"/"refusal" are plain messages; "proposal" holds the
 * `Proposal` itself plus its own accept/reject/expand-collapse UI state
 * (AG-009: rejecting only ever flips `state` here — it never touches
 * `history`/`document`). A `pending` entry is replaced in place (same
 * `id`) by either a `proposal` or `refusal` entry once the request settles,
 * per UX-1003's "thinking… bubble replaced by the resulting card".
 */
export type CopilotThreadEntry =
  | { kind: "user"; id: string; text: string }
  | { kind: "pending"; id: string }
  | { kind: "refusal"; id: string; text: string }
  | { kind: "proposal"; id: string; proposal: Proposal; state: "pending" | "accepted" | "rejected"; expanded: boolean };

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

  // -- missing-files dialog (specs/ux-shell.md UX-117; DOC-030: ephemeral only) --
  missingFilesDialog: MissingFilesDialogState | null;

  // -- inspector (UX-4xx: ephemeral only, DOC-030) --
  flashTarget: FlashTarget | null;

  // -- copilot (specs/ux-copilot.md UX-10xx, specs/agent-service.md AG-###;
  // DOC-030: ephemeral only -- a Proposal that hasn't been accepted is not
  // document state, and even once accepted it lives on as ordinary
  // history/document state, not here) --
  copilotContextChips: CopilotContextChip[];
  copilotThread: CopilotThreadEntry[];
  copilotPrompt: string;
  /**
   * Part B ("Try in play"): the live scratch-preview controller for AT MOST
   * one proposal at a time, and which thread entry it belongs to. Modeled
   * as its OWN small state machine, deliberately NOT `playState`/
   * `activePlayController` -- see `startTryInPlay`'s doc comment for the
   * full reasoning (short version: reusing real play-mode state would
   * freeze `history` via `dispatchCommand`'s `playState !== "stopped"`
   * guard, which would incorrectly also block accepting/rejecting a
   * DIFFERENT pending proposal while one is being previewed).
   */
  tryInPlayController: PlayController | null;
  tryInPlayEntryId: string | null;
  /**
   * Cross-component "do a thing in the viewport" signal (same pattern as
   * `flashTarget`/`triggerFlash` above): the scene-tree/viewport context
   * menu's "Frame" action (UX-207) lives outside `Viewport.tsx`'s own
   * `hostRef`, so it can't call `frameNode` directly like the viewport's own
   * toolbar button does. `Viewport.tsx` watches this field (by object
   * identity, bumped every request via `seq` so re-requesting the SAME
   * `nodeIndex` twice in a row still re-triggers the effect) and calls
   * `hostRef.current?.frameNode(nodeIndex)`.
   */
  frameRequest: { nodeIndex: number | null; seq: number } | null;
  /** UX-1107: same cross-component-signal pattern as `frameRequest` above, for the Behavior graph canvas instead of the viewport — `BehaviorGraphPanel.tsx` forwards it to `GraphCanvas`'s `focusRequest` prop. */
  graphNodeFocusRequest: { nodeIndex: number; seq: number } | null;
  /** UX-1108: see `requestScriptNodeFocus`'s doc comment — a durable (not fire-and-forget) version of the `graphNodeFocusRequest` pattern above, forwarded by `ScriptTabPanel.tsx` to `ScriptPanel`'s `focusRequest` prop. */
  scriptNodeFocusRequest: { graphIndex: number; nodeIndex: number; pointerPath: string | null; enclosingHandlerNodeIndex: number | null; seq: number } | null;
  /** Same cross-component-signal pattern: bumped by an inline "✦ Ask Copilot" affordance so `Copilot.tsx`'s composer can autofocus once the right panel switches to it. */
  copilotComposerFocusSeq: number;

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
  /**
   * Entry point for TopBar's (now multi-select/drag-drop-capable) import
   * control. A single `.glb` (or any lone file) goes straight through
   * `importGlb` unchanged. A `.gltf` among the selected/dropped files is
   * packed into one self-contained GLB first (`packMultiFileGltf`, resolving
   * `buffers[].uri`/`images[].uri`/`KHR_audio_emitter.audio[].uri` against
   * the OTHER selected files) before handing off to `importGlb` — so the
   * document editor-core ends up with is always a self-contained container,
   * never one with dangling external references. Any unresolved reference
   * fails the whole import with a toast naming every missing filename
   * (never a silent empty viewport) and leaves the current document
   * untouched.
   */
  importFiles(files: ImportFileLike[]): Promise<void>;
  /** specs/ux-shell.md UX-117: closes the missing-files dialog (Cancel/close-x/backdrop) without importing anything; the current document (if any) is untouched, same as the toast-only UX-116 path always was. */
  closeMissingFilesDialog(): void;
  /**
   * specs/ux-shell.md UX-117's primary action: given a directory handle from
   * `window.showDirectoryPicker()` (or a test double structurally matching
   * `DirectoryHandleLike`), resolves the dialog's current `missing` list
   * against it (`resolveUrisFromDirectory`), merges any resolved files into
   * `otherFiles`, and re-runs `packMultiFileGltf`. Success imports and closes
   * the dialog; a still-incomplete folder updates `missing` in place (the
   * dialog stays open) and surfaces a toast rather than failing silently.
   */
  grantFolderAndRetryImport(dirHandle: DirectoryHandleLike): Promise<void>;
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
  /** specs/ux-scene-tree.md UX-214 (DOC-048): deletes `nodeIndex` (and its whole subtree) as one undoable command, then moves selection to its former parent (or clears it for a scene-root). */
  deleteNode(nodeIndex: number): void;
  selectGraphNode(index: number | null): void;
  setSelectedGraphIndex(index: number): void;
  /** UX-1107 (specs/ux-usage-mapping.md): requests the Behavior graph canvas center/pan to the given graph node — see `@gltf-studio/graph-canvas`'s `GraphView` `focusRequest` doc comment. Same cross-component-signal pattern as `requestFrame` below. */
  requestGraphNodeFocus(nodeIndex: number): void;
  /**
   * UX-1108 (specs/ux-usage-mapping.md): same cross-component-signal
   * pattern as `requestGraphNodeFocus`, for the Script tab instead of the
   * Behavior graph canvas — `ScriptTabPanel.tsx` forwards it to
   * `ScriptPanel`'s `focusRequest` prop. Unlike the graph canvas (always
   * mounted, just hidden — `BottomDock.tsx`), the Script tab is
   * `React.lazy`-mounted on first open and Monaco loads via its own inner
   * dynamic import, so the receiving end can't assume it's ready the
   * instant this is called: `scriptNodeFocusRequest` is a durable, seq-
   * bumped STORE field (not a one-shot event) precisely so a request fired
   * before the panel/editor exists yet is naturally still there — and still
   * acted on — once `ScriptPanel`'s own effect decides it's actually ready
   * (Monaco mounted AND the emit view current for this graph), rather than
   * being silently dropped by a component that wasn't listening yet.
   */
  requestScriptNodeFocus(request: { graphIndex: number; nodeIndex: number; pointerPath: string | null; enclosingHandlerNodeIndex: number | null }): void;
  /**
   * UX-1106..1108: the Inspector "Used in behavior" section's → Graph / →
   * Script row actions. Both switch to the ref's own owning graph first
   * (a no-op when it's already `selectedGraphIndex`), then select that
   * graph node — the SAME `selectedGraphNodeIndex` state the Behavior
   * graph canvas's own details card (`specs/ux-graph-canvas.md` UX-507)
   * and the Script tab's cross-highlight (`specs/ux-script.md` UX-712)
   * already react to, so neither jump needs its own bespoke open-details
   * or flash mechanism. → Graph additionally requests a canvas focus
   * (the target node may not already be on-screen); → Script requests its
   * own focus too (`requestScriptNodeFocus` above) — for a `kind: "pointer"`
   * ref (`pointer/set`/`pointer/interpolate`, which carries no
   * `sourceNodeIds` identifier at all — see `cross-highlight.ts`'s header
   * comment) this is the ONLY way the corresponding line ever gets found;
   * for an `event-handler`/`animation` ref it's a defense-in-depth
   * hardening of the same cross-highlight `selectedGraphNodeIndex` already
   * drives, removing reliance on effect-ordering timing alone.
   */
  jumpUsageRefToGraph(ref: UsageRef): void;
  jumpUsageRefToScript(ref: UsageRef): void;
  /**
   * UX-1110: derives the reference-highlight scene-node index from the
   * current Behavior-graph selection (`selectedGraphIndex`/
   * `selectedGraphNodeIndex`), via `@gltf-studio/usage-index`'s
   * `graphNodeSceneRef` — the exact same resolution rule the Inspector's
   * usage index (above) is built from, run forward. A plain getter (not
   * reactive state, same convention as `historyEntries()`) — callers
   * `useMemo` it themselves, keyed on the store fields it reads.
   */
  referenceHighlightSceneNodeIndex(): number | null;
  /** UX-1111: "Reveal in viewport" — frames the given scene node (reusing `requestFrame`'s cross-component signal) and confirms via a toast. */
  revealSceneNodeInViewport(nodeIndex: number): void;
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

  // -- copilot actions (specs/ux-copilot.md UX-10xx, AG-###) --
  /** UX-1001/UX-1002/AG-013: adds a context chip, de-duped by an equality key derived from `ref` (see `contextRefKey` — same selection/graph-node/pointer counts as "already attached", regardless of `label`). */
  addCopilotContextChip(ref: AgentContextRef, label: string): void;
  /** UX-1002: removes one chip by its local `id` -- it will not be sent with the next request. */
  removeCopilotContextChip(id: string): void;
  setCopilotPrompt(text: string): void;
  /**
   * UX-1011: appends the user message and clears the composer BEFORE the
   * response arrives; AG-012: auto-attaches a `{kind:"selection"}` chip for
   * the current `selectedNodeIndex` first (visibly, in `copilotContextChips`)
   * if one isn't already present, so the request's `context` is exactly
   * what's shown as chips (AG-013) at send time.
   */
  sendCopilotPrompt(): Promise<void>;
  /** AG-004/AG-006..008/UX-1006: applies as one `HistoryStack.transact`; no-op (with an explanatory toast) when the proposal isn't eligible for one-click acceptance or the document is locked by real play mode. */
  acceptCopilotProposal(entryId: string): void;
  /** AG-009/UX-1006: zero document/history/storage mutation -- only flips the card's own thread-entry state. */
  rejectCopilotProposal(entryId: string): void;
  toggleCopilotProposalExpanded(entryId: string): void;
  /** Part B: apply-scratch-play-discard preview -- see doc comment above the implementation for the full design note. */
  startTryInPlay(entryId: string): Promise<void>;
  stopTryInPlay(): Promise<void>;
  /** UX-207: requests the viewport frame the given node (or the whole scene, when `null`) — see `frameRequest`'s own doc comment. */
  requestFrame(nodeIndex: number | null): void;
  /** Bumps `copilotComposerFocusSeq` so the mounted Copilot composer autofocuses. */
  requestCopilotComposerFocus(): void;
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

// specs/agent-service.md AG-010: the mock/offline AgentService, wired up as
// a module-level singleton (mirrors `activePlayController` above) rather
// than reactive AppState -- nothing outside this file needs the provider
// INSTANCE, only its `request()` result. Constructed lazily, on first use,
// since `MockAgentProvider`'s constructor requires a real `EditorDocument`
// (none exists before a project is imported); `syncAgentProviderDocument`
// below is called from every place `document`/`history` already gets
// updated elsewhere in this store, so the provider never sees a stale
// document by the time a request is made.
let agentProvider: MockAgentProvider | null = null;

function syncAgentProviderDocument(document: EditorDocument): MockAgentProvider {
  if (agentProvider) agentProvider.setDocument(document);
  else agentProvider = new MockAgentProvider(document);
  return agentProvider;
}

/**
 * `RenderHost.loadScene`'s `{ json, binary }` input shape — every direct
 * `renderHost.loadScene(...)` call in this store must use this, never bare
 * `document.json`/a bare patched-json copy, or a document whose buffer(s)
 * aren't `data:`-URI-embedded (the normal glTF/GLB convention, and always
 * true of a `packMultiFileGltf`-packed import) silently renders with no
 * mesh data at all. `jsonOverride` lets a scratch/patched copy (e.g.
 * `startTryInPlay`'s Copilot-preview JSON) reuse the SAME document's binary
 * — proposal patches only ever touch JSON pointers, never raw buffer bytes.
 */
function sceneSourceOf(document: EditorDocument, jsonOverride?: unknown): { json: unknown; binary: ArrayBuffer | null } {
  return { json: jsonOverride ?? document.json, binary: extractBinaryChunk(document.container) };
}

let localIdSeq = 0;
/** Local id generator for chips/thread entries -- same pattern as `toastSeq`/`makeCommandId`, just namespaced per call site so ids stay readable in devtools. */
function makeLocalId(prefix: string): string {
  localIdSeq += 1;
  return `${prefix}-${localIdSeq}`;
}

/**
 * UX-1001/AG-013 de-dupe key: two `AgentContextRef`s count as "the same
 * context already attached" when this key matches, regardless of the
 * chip's own `label` (a user could re-attach the same node under a
 * different label and it still shouldn't duplicate the underlying context
 * sent to the agent). Judgment call, documented here since AG-002 doesn't
 * pin down equality semantics: "selection" compares its full
 * `nodeIndices` array (order-sensitive -- simplest correct rule for the
 * single-index case every current call site produces); "graph-node"
 * compares `graphIndex`+`nodeId`; "explicit" compares `pointer` alone (two
 * explicit chips at the same pointer are the same context even if their
 * `label`s differ).
 */
function contextRefKey(ref: AgentContextRef): string {
  switch (ref.kind) {
    case "selection":
      return `selection:${ref.nodeIndices.join(",")}`;
    case "graph-node":
      return `graph-node:${ref.graphIndex}:${ref.nodeId}`;
    case "explicit":
      return `explicit:${ref.pointer}`;
  }
}

// Part B ("Try in play"): the scratch-preview PlayController's diagnostics
// unsubscribe -- mirrors `activePlayDiagnosticsUnsub` above, kept separate
// since it belongs to a wholly different controller/lifecycle.
let tryInPlayDiagnosticsUnsub: (() => void) | null = null;

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
  missingFilesDialog: null,
  flashTarget: null,

  copilotContextChips: [],
  copilotThread: [],
  copilotPrompt: "",
  tryInPlayController: null,
  tryInPlayEntryId: null,
  frameRequest: null,
  graphNodeFocusRequest: null,
  scriptNodeFocusRequest: null,
  copilotComposerFocusSeq: 0,

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
        collapsedNodes: new Set(),
        // A new project is an unrelated document -- any in-flight Copilot
        // thread/proposal/preview from the previous one no longer applies.
        copilotContextChips: [],
        copilotThread: [],
        copilotPrompt: "",
        tryInPlayController: null,
        tryInPlayEntryId: null,
        // UX-117: a successful import (whether straight-through or via a
        // resolved missing-files dialog retry) always closes the dialog --
        // there is nothing left to resolve once a document is actually open.
        missingFilesDialog: null
      });
      syncAgentProviderDocument(document);
      log("info", `Imported "${file.name}" (${file.bytes.byteLength.toLocaleString()} bytes).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `Import failed: ${message}`);
      pushToast(`Import failed: ${message}`);
    }
  },

  async importFiles(files) {
    const { importGlb, log, pushToast } = get();
    if (files.length === 0) return;
    // A brand-new pick/drop attempt supersedes any still-open missing-files
    // dialog from a previous one (the dialog's own Cancel/close-x already
    // covers the explicit case; this covers "tried again without closing
    // it first").
    set({ missingFilesDialog: null });

    const gltfFile = files.find((f) => /\.gltf$/i.test(f.name));
    if (!gltfFile) {
      // No .gltf among the selection: a single-file .glb (or any other
      // single file) import, same behavior as before multi-select existed.
      // If several non-.gltf files were somehow selected together, the
      // first .glb (or otherwise just the first file) wins — there's no
      // multi-file shape to resolve without a .gltf driving it.
      const file = files.find((f) => /\.glb$/i.test(f.name)) ?? files[0];
      const bytes = new Uint8Array(await file.arrayBuffer());
      await importGlb({ name: file.name, bytes });
      return;
    }

    let gltfJson: unknown;
    try {
      gltfJson = JSON.parse(await gltfFile.text());
    } catch {
      log("error", `Import failed: "${gltfFile.name}" is not valid JSON.`);
      pushToast(`Import failed: "${gltfFile.name}" is not valid JSON.`);
      return;
    }

    const fileMap: PackFileMap = new Map(files.map((f) => [f.name, f]));
    const result = await packMultiFileGltf(gltfJson, fileMap);
    if (!result.ok) {
      const list = result.missing.join(", ");
      log("error", `Import failed: missing external file(s) referenced by "${gltfFile.name}": ${list}`);
      pushToast(`Import failed: select ${list} together with ${gltfFile.name}.`);
      // UX-117: alongside the UX-116 toast (kept verbatim -- still the only
      // signal in a non-visual/screen-reader context), open the
      // missing-files dialog so a Chromium user has a one-click way forward
      // (grant folder access) instead of having to re-pick everything by
      // hand. `otherFiles` excludes the .gltf itself -- `gltfFile` is kept
      // separately since `grantFolderAndRetryImport` re-reads its JSON.
      const otherFiles: PackFileMap = new Map(fileMap);
      otherFiles.delete(gltfFile.name);
      set({ missingFilesDialog: { gltfFile, otherFiles, missing: result.missing, resolving: false } });
      return;
    }

    await importGlb({ name: gltfFile.name, bytes: result.bytes });
  },

  closeMissingFilesDialog() {
    set({ missingFilesDialog: null });
  },

  async grantFolderAndRetryImport(dirHandle) {
    const { missingFilesDialog, importGlb, pushToast, log } = get();
    if (!missingFilesDialog) return;
    set({ missingFilesDialog: { ...missingFilesDialog, resolving: true } });

    const { resolved, missing } = await resolveUrisFromDirectory(dirHandle, missingFilesDialog.missing);
    if (missing.length > 0) {
      // Granted the wrong folder, or an incomplete one -- update the list in
      // place (never silently drop the ones that WERE found) and keep the
      // dialog open rather than failing the whole attempt outright.
      const list = missing.join(", ");
      pushToast(`Still missing after folder access: ${list}.`);
      set((state) =>
        state.missingFilesDialog
          ? { missingFilesDialog: { ...state.missingFilesDialog, missing, resolving: false } }
          : {}
      );
      return;
    }

    const mergedFileMap: PackFileMap = new Map([...missingFilesDialog.otherFiles, ...resolved]);
    let gltfJson: unknown;
    try {
      gltfJson = JSON.parse(await missingFilesDialog.gltfFile.text());
    } catch {
      log("error", `Import failed: "${missingFilesDialog.gltfFile.name}" is not valid JSON.`);
      pushToast(`Import failed: "${missingFilesDialog.gltfFile.name}" is not valid JSON.`);
      set({ missingFilesDialog: null });
      return;
    }

    const result = await packMultiFileGltf(gltfJson, mergedFileMap);
    if (!result.ok) {
      // Shouldn't normally happen (every name `resolveUrisFromDirectory`
      // reported resolved should satisfy `packMultiFileGltf` too), but
      // handled the same way as the initial failure rather than assumed
      // impossible.
      const list = result.missing.join(", ");
      pushToast(`Import failed: select ${list} together with ${missingFilesDialog.gltfFile.name}.`);
      set((state) =>
        state.missingFilesDialog
          ? { missingFilesDialog: { ...state.missingFilesDialog, missing: result.missing, resolving: false } }
          : {}
      );
      return;
    }

    await importGlb({ name: missingFilesDialog.gltfFile.name, bytes: result.bytes });
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
    syncAgentProviderDocument(history.document);
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
    syncAgentProviderDocument(history.document);
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
    syncAgentProviderDocument(history.document);
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
    syncAgentProviderDocument(history.document);
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
    syncAgentProviderDocument(history.document);
  },

  selectNode(index) {
    set({ selectedNodeIndex: index, selectedAsset: null });
    if (index !== null) {
      // UX-202/UX-805: passive update — does not force-switch the dock tab.
      get().navigateData(`/nodes/${index}`);
    }
  },

  /**
   * specs/ux-scene-tree.md UX-214 (DOC-048): deletes `nodeIndex` and its
   * entire descendant subtree as one undoable `SceneEdit.removeNode`
   * command, then moves selection to the node's former parent — or clears
   * it when the deleted node was a scene-root — per UX-214's
   * "selection-after-delete" policy. `dispatchCommand` already carries the
   * play-mode freeze guard (rejects + toasts while playing, DOC-031); this
   * shares it rather than duplicating the check. Shared by the scene-tree
   * context menu's "Delete" action and the app-level Delete/Backspace
   * keyboard shortcut (`App.tsx`).
   */
  deleteNode(nodeIndex) {
    const { history, dispatchCommand, selectNode } = get();
    if (!history) return;
    const { command, parentIndex } = SceneEdit.removeNode(history.document, nodeIndex);
    dispatchCommand(command);
    selectNode(parentIndex);
  },

  selectGraphNode(index) {
    set({ selectedGraphNodeIndex: index });
  },

  setSelectedGraphIndex(index) {
    set({ selectedGraphIndex: index, selectedGraphNodeIndex: null });
  },

  requestGraphNodeFocus(nodeIndex) {
    set((state) => ({ graphNodeFocusRequest: { nodeIndex, seq: (state.graphNodeFocusRequest?.seq ?? 0) + 1 } }));
  },

  requestScriptNodeFocus(request) {
    set((state) => ({ scriptNodeFocusRequest: { ...request, seq: (state.scriptNodeFocusRequest?.seq ?? 0) + 1 } }));
  },

  jumpUsageRefToGraph(ref) {
    const { selectedGraphIndex, setActiveDockTab, setSelectedGraphIndex, selectGraphNode, requestGraphNodeFocus } = get();
    setActiveDockTab("graph");
    if (ref.graphIndex !== selectedGraphIndex) setSelectedGraphIndex(ref.graphIndex);
    selectGraphNode(ref.graphNodeIndex);
    requestGraphNodeFocus(ref.graphNodeIndex);
  },

  jumpUsageRefToScript(ref) {
    const { history, selectedGraphIndex, setActiveDockTab, setSelectedGraphIndex, selectGraphNode, requestScriptNodeFocus } = get();
    setActiveDockTab("script");
    if (ref.graphIndex !== selectedGraphIndex) setSelectedGraphIndex(ref.graphIndex);
    // specs/ux-script.md UX-712 already flashes the corresponding identifier
    // purely off this same `selectedGraphNodeIndex` field for handler/proc/
    // stateSlot-kind nodes — but a `kind: "pointer"` ref (pointer/set|
    // interpolate) carries no such identifier at all (cross-highlight.ts's
    // header comment), so its literal pointer path text is threaded through
    // as an explicit fallback needle, plus a cheap best-effort "which
    // handler does this trace back to" hint (`findEnclosingHandlerRoot`) for
    // disambiguating multiple identical-path occurrences in the same graph.
    selectGraphNode(ref.graphNodeIndex);
    let pointerPath: string | null = null;
    let enclosingHandlerNodeIndex: number | null = null;
    if (ref.kind === "pointer" && history) {
      pointerPath = ref.pathText;
      const graph = getIn(history.document.json, ["extensions", "KHR_interactivity", "graphs", ref.graphIndex]) as UsageInteractivityGraph | undefined;
      if (graph) enclosingHandlerNodeIndex = findEnclosingHandlerRoot(graph, ref.graphNodeIndex);
    }
    requestScriptNodeFocus({ graphIndex: ref.graphIndex, nodeIndex: ref.graphNodeIndex, pointerPath, enclosingHandlerNodeIndex });
  },

  referenceHighlightSceneNodeIndex() {
    const { history, selectedGraphIndex, selectedGraphNodeIndex } = get();
    if (!history || selectedGraphNodeIndex === null) return null;
    const json = history.document.json;
    const graph = getIn(json, ["extensions", "KHR_interactivity", "graphs", selectedGraphIndex]) as
      | { declarations?: Array<{ op: string }>; nodes?: UsageGraphNode[] }
      | undefined;
    const node = graph?.nodes?.[selectedGraphNodeIndex];
    const op = node ? graph?.declarations?.[node.declaration]?.op : undefined;
    if (!node || !op) return null;
    return graphNodeSceneRef(op, node, json as UsageDocJson);
  },

  revealSceneNodeInViewport(nodeIndex) {
    const { history, requestFrame, pushToast } = get();
    const json = history?.document.json as { nodes?: Array<{ name?: string }> } | undefined;
    const label = json?.nodes?.[nodeIndex]?.name ?? `Node #${nodeIndex}`;
    requestFrame(nodeIndex);
    pushToast(`Framed ${label} in viewport`);
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

  addCopilotContextChip(ref, label) {
    const key = contextRefKey(ref);
    set((state) => {
      if (state.copilotContextChips.some((chip) => contextRefKey(chip.ref) === key)) return {};
      return { copilotContextChips: [...state.copilotContextChips, { id: makeLocalId("chip"), ref, label }] };
    });
  },

  removeCopilotContextChip(id) {
    set((state) => ({ copilotContextChips: state.copilotContextChips.filter((chip) => chip.id !== id) }));
  },

  setCopilotPrompt(text) {
    set({ copilotPrompt: text });
  },

  async sendCopilotPrompt() {
    const { copilotPrompt, document, selectedNodeIndex, addCopilotContextChip, pushToast } = get();
    const text = copilotPrompt.trim();
    if (!text || !document) return;

    // AG-012: the current selection auto-populates a context chip on every
    // request -- visibly, via the same `addCopilotContextChip` an inline
    // "✦" affordance uses, so it's indistinguishable from a manually
    // attached one and satisfies AG-013 ("nothing reaches request() that
    // wasn't shown as a chip") by construction. De-duped like any other
    // chip -- a manually-attached selection chip for the same node isn't
    // duplicated.
    if (selectedNodeIndex !== null) {
      addCopilotContextChip({ kind: "selection", nodeIndices: [selectedNodeIndex] }, `Selection: Node #${selectedNodeIndex}`);
    }

    const entryId = makeLocalId("thread");
    // UX-1011: the user message is appended and the composer cleared BEFORE
    // the request resolves -- both happen in this one synchronous `set`,
    // before `provider.request` is ever awaited below.
    set((state) => ({
      copilotThread: [...state.copilotThread, { kind: "user", id: makeLocalId("thread"), text }, { kind: "pending", id: entryId }],
      copilotPrompt: ""
    }));

    const context = get().copilotContextChips.map((chip) => chip.ref);
    const provider = syncAgentProviderDocument(document);

    try {
      const proposal = await provider.request(text, context);
      set((state) => ({
        copilotThread: state.copilotThread.map((e) =>
          e.id === entryId ? { kind: "proposal", id: entryId, proposal, state: "pending", expanded: false } : e
        )
      }));
    } catch (err) {
      // AgentRequestRefusedError (UnrecognizedPromptError/MissingSelectionError)
      // -- rendered as a plain assistant message, never a proposal card
      // (specs/ux-copilot.md has no "refusal card" concept). Anything else
      // is treated the same way rather than left as a permanent "thinking…"
      // bubble -- there is no other UI for a provider-level crash.
      const message = err instanceof Error ? err.message : String(err);
      set((state) => ({
        copilotThread: state.copilotThread.map((e) => (e.id === entryId ? { kind: "refusal", id: entryId, text: message } : e))
      }));
      pushToast("Copilot couldn't act on that request.");
    }
  },

  acceptCopilotProposal(entryId) {
    const { history, storage, projectId, journalSinceRev, playState, pushToast, log, copilotThread } = get();
    if (!history || !projectId) return;
    const entry = copilotThread.find((e) => e.id === entryId);
    if (!entry || entry.kind !== "proposal" || entry.state !== "pending") return;

    // Mirrors dispatchCommand's own guard: a Proposal is not a separate
    // trust tier from a manual edit once it's being applied (docs/adr/0004)
    // -- real play mode locks the document for both the same way.
    if (playState !== "stopped") {
      pushToast("Document locked while playing — Stop to edit.");
      return;
    }

    const { proposal } = entry;
    // AG-007/AG-008: the exact "eligible for one-click acceptance" boolean
    // packages/contract-tests/src/agent-service.ts's own AG-007/AG-008
    // tests encode -- no error-level finding, AND (no behavior-neutral claim
    // OR at least one EQUIV result backing it).
    const hasErrorFinding = proposal.validationReport.findings.some((f) => f.severity === "error");
    const claimsBehaviorNeutral = /behavior-neutral/i.test(proposal.summary);
    const hasEquivCheck = (proposal.validationReport.equivChecks?.length ?? 0) > 0;
    const eligible = !hasErrorFinding && (!claimsBehaviorNeutral || hasEquivCheck);
    if (!eligible) {
      pushToast(
        hasErrorFinding
          ? "Copilot proposal has validation errors and can't be applied — see its command list."
          : "Copilot proposal claims a behavior-neutral change with no EQUIV check — not eligible for one-click acceptance."
      );
      return;
    }

    // DOC-009/UX-1008: relabel only the FIRST command so HistoryStack.entries()
    // (which surfaces an entry's first command's label) shows "Copilot: …" —
    // every other command keeps its own real label (UX-1004 already renders
    // the full per-command label list from `Command.label` when the card is
    // expanded, so those must stay accurate).
    const relabeled: Command[] = proposal.commands.map((command, i) => (i === 0 ? { ...command, label: `Copilot: ${proposal.summary}` } : { ...command }));

    // AG-004: exactly one HistoryStack.transact call regardless of how many
    // commands the proposal bundles.
    try {
      history.transact(() => {
        for (const command of relabeled) history.push(command);
      });
    } catch (err) {
      if (err instanceof DocumentFrozenError) {
        pushToast("Document locked while playing — Stop to edit.");
        return;
      }
      throw err;
    }

    set((state) => ({
      document: history.document,
      projectDirty: true,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      copilotThread: state.copilotThread.map((e) => (e.id === entryId && e.kind === "proposal" ? { ...e, state: "accepted" } : e))
    }));
    syncAgentProviderDocument(history.document);

    // AG-005: same autosave-journal call dispatchCommand makes, over the
    // flattened forward patches of every relabeled command, so an accepted
    // proposal's journal entry is byte-for-byte indistinguishable from a
    // manual multi-command edit's.
    const flattenedPatches = relabeled.flatMap((command) => command.patches);
    storage.autosaveJournal(projectId, journalSinceRev, flattenedPatches).catch((error: unknown) => {
      log("error", `Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    pushToast(`Applied: ${proposal.summary}`);
  },

  rejectCopilotProposal(entryId) {
    // AG-009: zero calls into history/storage -- purely a thread-entry flag flip.
    set((state) => ({
      copilotThread: state.copilotThread.map((e) => (e.id === entryId && e.kind === "proposal" ? { ...e, state: "rejected" } : e))
    }));
  },

  toggleCopilotProposalExpanded(entryId) {
    set((state) => ({
      copilotThread: state.copilotThread.map((e) => (e.id === entryId && e.kind === "proposal" ? { ...e, expanded: !e.expanded } : e))
    }));
  },

  /**
   * Part B ("Try in play" -- specs/ux-copilot.md UX-1007): "apply-scratch-
   * play-discard". Resolves OPEN(AG-preview-render-tbd)/UX-1007's own open
   * question for THIS proposal-preview surface specifically (recorded in
   * specs/ux-copilot.md's Open Questions): a pending/accepted/rejected
   * proposal's commands are replayed onto a SCRATCH copy of the current
   * `json` (never `history`/`document` -- `history.document.rev` is
   * provably unchanged across this entire flow, since nothing here ever
   * calls `history.push`/`transact`), the viewport is pointed at that
   * scratch JSON, and a real `PlayController` runs against it exactly like
   * `startPlay()`'s, except `getDocumentJson` is a closed-over constant
   * instead of `() => get().document!.json`.
   *
   * Design call (per the parent task's brief -- documented here as
   * requested): this does NOT set `playState`/reuse `activePlayController`.
   * A separate `tryInPlayController`/`tryInPlayEntryId` pair models it
   * instead. Two reasons, not just one:
   *   1. `dispatchCommand`/`acceptCopilotProposal` both gate on
   *      `playState !== "stopped"` to lock the document during REAL play.
   *      UX-1007 requires Try-in-play to be available regardless of a
   *      card's state, and the parent brief explicitly calls for Accept on
   *      a DIFFERENT pending proposal to keep working while one proposal is
   *      being previewed -- only possible if previewing one proposal leaves
   *      `playState === "stopped"`.
   *   2. `specs/ux-shell.md`'s UX-106 locked banner ("Document locked while
   *      playing — Stop to edit.") would be actively misleading here: the
   *      document isn't locked because of this preview, and there's nothing
   *      the user would need to "Stop" editing to unlock (they can keep
   *      editing the real document the whole time).
   * The one real safety property real play mode has that IS worth keeping
   * for honesty (per the brief's own callout): TransformControls shouldn't
   * fight a running preview engine's own per-frame transform writes.
   * `Viewport.tsx`'s gizmo-attach effect additionally checks
   * `tryInPlayEntryId === null` for exactly this reason, and a small
   * viewport-level "Previewing Copilot proposal" strip (distinct from the
   * real locked-banner) gives the one honest visual cue that something is
   * being previewed.
   */
  async startTryInPlay(entryId) {
    const { renderHost, history, copilotThread, playEngine, tryInPlayController, log, pushToast } = get();
    if (!renderHost || !history) return;
    const entry = copilotThread.find((e) => e.id === entryId);
    if (!entry || entry.kind !== "proposal") return;

    if (tryInPlayController) {
      // Switching preview target (or re-previewing the same card): tear the
      // old one down cleanly first, same as `startPlay`'s own single-active-
      // controller invariant.
      await get().stopTryInPlay();
    }

    const flattenedPatches = entry.proposal.commands.flatMap((command) => command.patches);
    const scratchJson = applyPatches(history.document.json, flattenedPatches);

    await renderHost.loadScene(sceneSourceOf(history.document, scratchJson));

    const controller = createPlayController({
      renderHost,
      getAudioHost: () => get().audioHost,
      getDocumentJson: () => scratchJson, // a closed-over constant, NOT get().document!.json (history/document are never touched by this flow)
      getBinary: () => extractBinaryChunk(history.document.container) ?? undefined
    });

    tryInPlayDiagnosticsUnsub = controller.onDiagnostic((d) => {
      log(d.kind === "engine-error" ? "error" : "warn", `[copilot-preview/${d.kind}]${d.pointer ? ` ${d.pointer}` : ""}: ${d.message}`);
    });

    try {
      await controller.start({ engine: playEngine });
    } catch (err) {
      tryInPlayDiagnosticsUnsub?.();
      tryInPlayDiagnosticsUnsub = null;
      pushToast(`Try in play failed to start: ${err instanceof Error ? err.message : String(err)}`);
      // loadScene(scratchJson) already ran above -- restore the real
      // committed scene rather than leaving the viewport stuck on scratch.
      await renderHost.loadScene(sceneSourceOf(history.document));
      return;
    }

    set({ tryInPlayController: controller, tryInPlayEntryId: entryId });
  },

  async stopTryInPlay() {
    const { tryInPlayController, history, renderHost } = get();
    if (!tryInPlayController) {
      set({ tryInPlayController: null, tryInPlayEntryId: null });
      return;
    }
    await tryInPlayController.stop(); // PC-007: restores via renderHost.loadScene(scratchJson) -- a no-op-ish reload, it's already showing scratch
    tryInPlayDiagnosticsUnsub?.();
    tryInPlayDiagnosticsUnsub = null;
    // The "discard" half of "apply-scratch-play-discard": an EXPLICIT second
    // reload back to the real committed document/container -- without this
    // the viewport would stay showing the discarded scratch state forever.
    // `history`/`document`/`rev` were never touched anywhere in this flow.
    if (history && renderHost) {
      await renderHost.loadScene(sceneSourceOf(history.document));
    }
    set({ tryInPlayController: null, tryInPlayEntryId: null });
  },

  requestFrame(nodeIndex) {
    set((state) => ({ frameRequest: { nodeIndex, seq: (state.frameRequest?.seq ?? 0) + 1 } }));
  },

  requestCopilotComposerFocus() {
    set((state) => ({ copilotComposerFocusSeq: state.copilotComposerFocusSeq + 1 }));
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
