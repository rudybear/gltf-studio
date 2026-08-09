import { useEffect } from "react";
import { WebAudioHost } from "@gltf-studio/audio-webaudio";
import { useAppStore, PANEL_BOUNDS } from "./store/app-store";
import { attachAudioHost } from "./lib/audio-host-lifecycle.js";
import { TopBar } from "./components/topbar/TopBar";
import { LockedBanner } from "./components/topbar/LockedBanner";
import { LeftPanel } from "./components/LeftPanel";
import { CenterColumn } from "./components/CenterColumn";
import { RightPanel } from "./components/RightPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { TestIdOverlay } from "./components/TestIdOverlay";
import { ToastLayer } from "./components/ToastLayer";
import { PointerPickerDialog } from "./components/pointer-picker/PointerPickerDialog";

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
    const host = new WebAudioHost();
    const teardown = attachAudioHost(history, host);
    registerAudioHost(host);
    window.__gltfStudioAudioTest = { diagnostics: () => host.getDiagnostics() };
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

  return (
    <div id="app">
      <TopBar />
      <LockedBanner />
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
    </div>
  );
}
