import { useEffect } from "react";
import { WebAudioHost } from "@gltf-studio/audio-webaudio";
import { useAppStore, PANEL_BOUNDS } from "./store/app-store";
import { attachAudioHost } from "./lib/audio-host-lifecycle.js";
import { resolveAudioUriAgainstDirectory } from "./lib/audio-file-resolve.js";
import { TopBar } from "./components/topbar/TopBar";
import { LockedBanner } from "./components/topbar/LockedBanner";
import { LeftPanel } from "./components/LeftPanel";
import { CenterColumn } from "./components/CenterColumn";
import { RightPanel } from "./components/RightPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { TestIdOverlay } from "./components/TestIdOverlay";
import { ToastLayer } from "./components/ToastLayer";
import { PointerPickerDialog } from "./components/pointer-picker/PointerPickerDialog";
import { MissingFilesDialog } from "./components/import/MissingFilesDialog";
import { ProjectManager } from "./components/project-manager/ProjectManager";
import { RecoveryPrompt } from "./components/project-manager/RecoveryPrompt";
import { ShareDialog } from "./components/project-manager/ShareDialog";
import { SettingsDialog } from "./settings/SettingsDialog.js";
import { filesFromDataTransfer } from "./lib/file-drop.js";
import { TourBanner } from "./tour/TourBanner";
import { TourOverlay } from "./tour/TourOverlay";

/**
 * Test-only seam (no UX-### requirement covers it — same rationale as
 * Viewport.tsx's own `window.__gltfStudioTest`): the bottom dock's Behavior
 * graph tab is still a placeholder (no real canvas yet), so an e2e test
 * asserting `specs/ux-inspector.md`'s `UX-412` ("Add pointer/set|interpolate
 * to graph" creates a real `KHR_interactivity` graph node) has no UI path to
 * inspect `extensions.KHR_interactivity` short of reading the live document.
 * Installed here (App.tsx), not Viewport.tsx, since it's a whole-document
 * concern rather than a RenderHost one.
 */
export interface GltfStudioDocumentTestHook {
  getJson(): unknown;
}

declare global {
  interface Window {
    __gltfStudioDocumentTest?: GltfStudioDocumentTestHook;
    __gltfStudioAudioTest?: GltfStudioAudioTestHook;
  }
}

/**
 * Test-only seam (M7): e2e/audio.spec.ts's "audition click -> AudioContext
 * created only after gesture + context running + host reports an active
 * voice" assertion needs SOME way to observe `WebAudioHost`'s internal
 * state — `AudioHost`'s own interface deliberately exposes none (AH-002).
 * `diagnostics()` proxies `WebAudioHost.getDiagnostics()` (itself a
 * non-interface extra, see that class's doc comment) through a `string` an
 * e2e test can pattern-match, without widening the AudioHost interface
 * itself just for a test hook.
 */
export interface GltfStudioAudioTestHook {
  diagnostics(): string;
  /** specs/ux-inspector.md UX-423: proxies `WebAudioHost.getEmitterPosition` (a diagnostics-only extra, see that class's doc comment) — the e2e placement-confirmation seam for "an editor-driven node move re-derives a positional emitter's world position". */
  emitterPosition(emitterIndex: number): [number, number, number] | null;
}

export function App(): JSX.Element {
  const themeOverride = useAppStore((s) => s.themeOverride);
  const setPanelSize = useAppStore((s) => s.setPanelSize);
  const history = useAppStore((s) => s.history);
  const registerAudioHost = useAppStore((s) => s.registerAudioHost);

  // M7 (specs/engine-api.md AH-001/AH-002; fixed per specs/ux-shell.md's
  // M7 "audio-host-keying fix" follow-up): one WebAudioHost per
  // `HistoryStack` instance -- i.e. per PROJECT, not per `EditorDocument` --
  // registered on the store's `audioHost` field ("emitters host always" —
  // loaded whether or not the document turns out to declare a
  // KHR_audio_emitter extension; WebAudioHost.loadEmitters is a safe no-op
  // when it doesn't, per AudioSystem.hasAudio's original gate, now just an
  // early-return inside buildFromDocument). `attachAudioHost`
  // (lib/audio-host-lifecycle.ts) does the initial load and re-loads on
  // every subsequent `history.onApply` (DOC-040, real push/undo/redo only).
  // Originally this effect was keyed on `editorDocument` (the store's
  // `document` field) instead of `history`, which was a bug: `startPlay`/
  // `stopPlay` (DOC-031/DOC-045) call `history.freeze()`/`unfreeze()`,
  // which produce a NEW `EditorDocument` object (via `{...document, frozen:
  // ...}`) with the same `json`/`container`/`rev` -- so entering play mode
  // re-triggered this effect, disposing the live `WebAudioHost` (and
  // losing any `AudioContext` a pre-play Audition gesture had already
  // created on it, since AH-001 gesture-gates `init()` and a fresh host
  // can't resume without a brand-new gesture) and silently replacing it
  // with an idle one. `history`'s own identity is stable for the life of
  // one project (only replaced by a brand-new `new HistoryStack(...)` when
  // a project is imported, never by freeze/unfreeze), so keying on it
  // instead makes play-mode start/stop invisible to this effect entirely --
  // mirrors Viewport.tsx's own `history`/`onApply`-keyed RenderHost
  // lifecycle. NOT gesture-gated here either way — `loadEmitters` itself
  // never creates an AudioContext (AH-001 is `init()`'s obligation, called
  // lazily on the inspector's first Audition click, see AudioSection.tsx).
  useEffect(() => {
    if (!history) {
      registerAudioHost(undefined);
      return;
    }
    // Clip management (Track A audio task): resolves a URI-referenced clip
    // against whichever folder the user has most recently granted via the
    // Assets > Audio Clips tab's "Grant folder access" action
    // (`grantAudioFolder`) — read lazily via `useAppStore.getState()` (not
    // captured once at this closure's creation) so granting mid-session
    // takes effect on the NEXT `loadEmitters` reload without needing a new
    // `WebAudioHost` instance. Returns `null` (honestly unresolved, never a
    // thrown error) when no folder has been granted yet.
    const host = new WebAudioHost({
      resolveAudioUri: (uri) => {
        const dirHandle = useAppStore.getState().audioFolderHandle;
        return dirHandle ? resolveAudioUriAgainstDirectory(dirHandle, uri) : Promise.resolve(null);
      }
    });
    const teardown = attachAudioHost(history, host);
    registerAudioHost(host);
    window.__gltfStudioAudioTest = { diagnostics: () => host.getDiagnostics(), emitterPosition: (index) => host.getEmitterPosition(index) };
    return () => {
      delete window.__gltfStudioAudioTest;
      teardown();
      registerAudioHost(undefined);
    };
  }, [history, registerAudioHost]);

  // UX-104/UX-105: no explicit override on first load (CSS's own
  // prefers-color-scheme media query handles that live); once the user
  // toggles, an explicit data-theme attribute wins over the media query and
  // persists across further OS-theme changes until toggled back.
  useEffect(() => {
    if (themeOverride) {
      document.documentElement.setAttribute("data-theme", themeOverride);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [themeOverride]);

  useEffect(() => {
    window.__gltfStudioDocumentTest = {
      getJson: () => useAppStore.getState().document?.json ?? null
    };
    return () => {
      delete window.__gltfStudioDocumentTest;
    };
  }, []);

  // specs/ux-shell.md UX-125/UX-127: runs once at startup -- a `#share=`
  // URL (UX-127) takes priority over reopening the last-open project
  // (UX-125's own bookmark), and either path leaves this a no-op when
  // neither applies (a fresh session with nothing to resume, same as
  // before this feature existed).
  useEffect(() => {
    void useAppStore.getState().bootstrapFromEnvironment();
  }, []);

  // specs/ux-shell.md UX-118: dropping a file (or an entire FOLDER — see
  // `file-drop.ts`'s directory-entry traversal) ANYWHERE on the window
  // imports it, not just onto the `topbar.import` button — the "it just
  // sees the files" flow this feature adds alongside UX-117's folder-grant
  // dialog. Gated on `dataTransfer.types.includes("Files")` so this never
  // fires for the app's OWN internal HTML5 drag sources (SceneTree's
  // scene-node drag, AssetBrowser's animation-clip drag), neither of which
  // ever sets the "Files" kind on their `DataTransfer` — only a real OS
  // file/folder drag does. `TopBar.tsx`'s own button-level drop handler
  // calls `stopPropagation()` so a drop landing exactly on that button
  // doesn't ALSO run through this window-level handler a second time.
  useEffect(() => {
    function onDragOver(e: DragEvent): void {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    }
    function onDrop(e: DragEvent): void {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      void filesFromDataTransfer(e.dataTransfer).then((files) => {
        if (files.length > 0) void useAppStore.getState().importFiles(files);
      });
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // specs/ux-scene-tree.md UX-214 (DOC-048): Delete/Backspace deletes the
  // currently-selected scene node (and its subtree) via the store's
  // `deleteNode` — the same action the scene-tree context menu's "Delete"
  // entry dispatches. App-level (not SceneTree-local) so the shortcut fires
  // regardless of which panel currently has focus, mirroring
  // Viewport.tsx's own W/E/R gizmo-shortcut focus guard: skip while an
  // INPUT/TEXTAREA/SELECT has focus (the scene-tree's inline rename field,
  // any Inspector field, etc.) or focus is anywhere inside a mounted Monaco
  // editor (the Script tab) — `.closest(".monaco-editor")` catches Monaco's
  // internal contentEditable/hidden-textarea widgets that the plain tagName
  // check alone might not. `deleteNode` itself is a no-op with nothing
  // selected; `dispatchCommand`'s own play-mode freeze guard (DOC-031)
  // already blocks it while playing, same as every other edit action.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.closest(".monaco-editor")) return;
      if (target?.isContentEditable) return;
      const { selectedNodeIndex, deleteNode } = useAppStore.getState();
      if (selectedNodeIndex === null) return;
      e.preventDefault();
      deleteNode(selectedNodeIndex);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div id="app">
      <TopBar />
      <LockedBanner />
      <TourBanner />
      <div id="workspace">
        <LeftPanel />
        <ResizeHandle
          orientation="vertical"
          testId="left-panel.resize-handle"
          onDrag={(delta) => {
            // Reads the live store value (not a render-closed-over variable) so
            // rapid successive move events within one drag gesture each apply
            // their delta on top of the LATEST width rather than all
            // recomputing from the width at drag-start (which would silently
            // discard every intermediate step but the last).
            const current = useAppStore.getState().panelSizes.leftWidth;
            const next = Math.min(PANEL_BOUNDS.left.max, Math.max(PANEL_BOUNDS.left.min, current + delta));
            setPanelSize("leftWidth", next);
          }}
        />
        <CenterColumn />
        <ResizeHandle
          orientation="vertical"
          testId="right-panel.resize-handle"
          onDrag={(delta) => {
            const current = useAppStore.getState().panelSizes.rightWidth;
            const next = Math.min(PANEL_BOUNDS.right.max, Math.max(PANEL_BOUNDS.right.min, current - delta));
            setPanelSize("rightWidth", next);
          }}
        />
        <RightPanel />
      </div>
      <TestIdOverlay />
      <ToastLayer />
      <PointerPickerDialog />
      <MissingFilesDialog />
      <ProjectManager />
      <ShareDialog />
      <SettingsDialog />
      <RecoveryPrompt />
      <TourOverlay />
    </div>
  );
}
