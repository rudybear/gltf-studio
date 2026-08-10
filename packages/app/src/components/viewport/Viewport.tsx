import { useEffect, useMemo, useRef, useState } from "react";
import { createThreeRenderHost, type ThreeRenderHost } from "@gltf-studio/engine-three";
import type { CameraPose, GizmoMode } from "@gltf-studio/engine-api";
import { SceneEdit, type EditorDocument, type TransformFields } from "@gltf-studio/editor-core";
import { useAppStore, getActivePlayController } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { extractBinaryChunk } from "../../lib/audio-container.js";
import { PlayOverlay } from "./PlayOverlay";
import { ContextMenu } from "../ContextMenu";
import { PlaygroundPreview, RacerPreview } from "./SampleGalleryPreviews";

/**
 * RenderHost.loadScene's `{ json, binary }` input shape (engine-three's
 * `scene-input.ts`) — NOT bare `history.document.json` alone. A document's
 * `json` almost always has at least one buffer with no `uri` at all (the
 * normal glTF/GLB convention for the implicit GLB binary chunk, per
 * `EditorDocument.container`'s `kind: "glb"` shape); passing json alone
 * silently drops that binary and GLTFLoader ends up with no bytes for any
 * accessor that depends on it — the scene tree still populates (it's built
 * from `json` alone) but nothing renders. This bit every GLB whose buffer
 * wasn't already a base64 `data:` URI (which is why the M2 e2e fixtures,
 * all built with embedded data-URI buffers, never caught it) — including a
 * freshly `packMultiFileGltf`-packed multi-file `.gltf` import, which always
 * produces a real embedded BIN chunk, never a data URI.
 */
function sceneSourceOf(document: EditorDocument): { json: unknown; binary: ArrayBuffer | null } {
  return { json: document.json, binary: extractBinaryChunk(document.container) };
}

/** specs/ux-viewport.md UX-304: exactly W/E/R, mutually exclusive, one-to-one with RH-018's GizmoMode. */
const GIZMO_MODES: ReadonlyArray<{ mode: GizmoMode; label: string; title: string }> = [
  { mode: "translate", label: "W", title: "Move (W)" },
  { mode: "rotate", label: "E", title: "Rotate (E)" },
  { mode: "scale", label: "R", title: "Scale (R)" }
];

/**
 * specs/ux-shell.md UX-119: the empty-project state's starter-experience
 * gallery. `key` drives both the `viewport.gallery.card.<key>` family of
 * testids (UX-110's "part" chainable with a repeated, semantic sub-part --
 * the same pattern PlayOverlay.tsx's `viewport.play-overlay.variable.${key}`
 * already uses) and which static asset (`samples/<file>`, copied into
 * public/ by copy-sample.mjs) the card's Load button fetches.
 */
interface SampleDescriptor {
  key: "playground" | "racer";
  label: string;
  file: string;
  description: string;
}

const SAMPLE_GALLERY: readonly SampleDescriptor[] = [
  {
    key: "playground",
    label: "Playground",
    file: "playground.glb",
    description: "The shipped checkpoint scene — viewport, behavior graph, script tab, both play engines, audio, and Copilot, all wired up."
  },
  {
    key: "racer",
    label: "R4 Racer",
    file: "r4-racer.glb",
    description: "A complete racing game authored as TypeScript, compiled into the asset; click the pads to steer."
  }
];

/**
 * Test-only seam (no UX-### requirement covers it — analogous to
 * engine-three's own `getRendererStats()`/`simulateGizmoDrag` test-only
 * surface): lets Playwright drive a deterministic camera pose and probe the
 * live RenderHost without needing pixel-accurate 3D pick math of its own.
 * Attached/detached alongside this component's own mount/dispose so it never
 * outlives the ThreeRenderHost instance it wraps.
 */
export interface GltfStudioTestHook {
  setCameraPose(pose: CameraPose): void;
  getCameraPose(): CameraPose;
  simulateGizmoDrag(delta: [number, number, number]): boolean;
  /** True once the current document's async `loadScene` has resolved — see `ThreeRenderHost.isReady`. */
  isReady(): boolean;
}

declare global {
  interface Window {
    __gltfStudioTest?: GltfStudioTestHook;
  }
}

/**
 * Center viewport region (specs/ux-shell.md UX-100, specs/ux-viewport.md
 * UX-3xx): mounts the real `ThreeRenderHost` (specs/render-host.md) into
 * `#viewport-mount`, keeps it in sync with the store's document/selection/
 * hover/gizmo-mode state, and turns a committed gizmo drag into exactly one
 * undoable `SceneEdit.setTransform` command (UX-305, RH-003).
 */
export function Viewport(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const history = useAppStore((s) => s.history);
  const audioHost = useAppStore((s) => s.audioHost);
  const importGlb = useAppStore((s) => s.importGlb);
  const pushToast = useAppStore((s) => s.pushToast);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);
  const hoveredNodeIndex = useAppStore((s) => s.hoveredNodeIndex);
  const gizmoMode = useAppStore((s) => s.gizmoMode);
  const playState = useAppStore((s) => s.playState);
  const selectNode = useAppStore((s) => s.selectNode);
  const setHover = useAppStore((s) => s.setHover);
  const setGizmoMode = useAppStore((s) => s.setGizmoMode);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const registerRenderHost = useAppStore((s) => s.registerRenderHost);
  const frameRequest = useAppStore((s) => s.frameRequest);
  const tryInPlayEntryId = useAppStore((s) => s.tryInPlayEntryId);
  const stopTryInPlay = useAppStore((s) => s.stopTryInPlay);
  const copilotThread = useAppStore((s) => s.copilotThread);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);
  const addCopilotContextChip = useAppStore((s) => s.addCopilotContextChip);
  const requestCopilotComposerFocus = useAppStore((s) => s.requestCopilotComposerFocus);
  const requestFrame = useAppStore((s) => s.requestFrame);
  const selectedGraphNodeIndex = useAppStore((s) => s.selectedGraphNodeIndex);
  const selectedGraphIndex = useAppStore((s) => s.selectedGraphIndex);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeIndex: number } | null>(null);

  // Click-vs-orbit-drag threshold (root cause of the "can't select objects
  // in the viewport" bug): OrbitControls has NO minimum-drag distance of its
  // own — it starts rotating (or, on the right button, panning) the camera
  // from the very first `pointermove` after `pointerdown`, however small. A
  // synthetic `page.mouse.click()` moves to the target and presses/releases
  // with zero intervening movement, so e2e never saw this; a real mouse or
  // trackpad essentially never holds pixel-perfect still between press and
  // release, so without the guards below the camera has already rotated a
  // few fractions of a degree away from the pose the user was looking at by
  // the time `pick()` runs — enough to miss whatever appeared to be right
  // under the cursor. Two cooperating fixes, both keyed off the same
  // pointerdown position:
  //  1. `onPointerDown` disables OrbitControls immediately; `onPointerMove`
  //     re-enables it only once the gesture has moved past the threshold
  //     (`thresholdCrossed`). Below the threshold OrbitControls never sees a
  //     live pointermove at all, so the camera genuinely does not move —
  //     small jitter no longer desyncs the click from what's on screen.
  //  2. `wasDrag` (used by `onClick`/`onContextMenu`) still bails out of
  //     selection/context-menu handling for a gesture that DID cross the
  //     threshold — a deliberate orbit drag still fires a native "click" at
  //     the drop point, which must not also change the selection there.
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const thresholdCrossed = useRef(false);
  const CLICK_DRAG_THRESHOLD_PX = 5;
  function wasDrag(e: { clientX: number; clientY: number }): boolean {
    const down = pointerDownPos.current;
    if (!down) return false;
    return Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_DRAG_THRESHOLD_PX;
  }

  const mountRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<ThreeRenderHost | null>(null);
  if (!hostRef.current) {
    hostRef.current = createThreeRenderHost();
  }

  const gizmoModeRef = useRef<GizmoMode>(gizmoMode);
  useEffect(() => {
    gizmoModeRef.current = gizmoMode;
  }, [gizmoMode]);

  // Tracks whether `loadScene`'s promise for the CURRENT `history` has
  // resolved yet — `attachGizmo` throws if called before a scene is loaded
  // (unlike `setHighlight`/`setHover`/`pick`, which tolerate it), and a
  // selection can arrive (e.g. a scene-tree click) before that async load
  // finishes. Gated on below so that race never reaches attachGizmo.
  const [sceneReady, setSceneReady] = useState(false);

  // Mount/dispose lifecycle, once per component instance (RH-004..RH-010
  // make re-mount/dispose safe regardless, e.g. under React StrictMode's
  // dev-only double-invoke).
  useEffect(() => {
    const host = hostRef.current!;
    const el = mountRef.current!;
    host.mount(el);
    registerRenderHost(host);
    window.__gltfStudioTest = {
      setCameraPose: (pose) => host.setCameraPose(pose),
      getCameraPose: () => host.getCameraPose(),
      simulateGizmoDrag: (delta) => host.simulateGizmoDrag(delta),
      isReady: () => host.isReady()
    };
    return () => {
      delete window.__gltfStudioTest;
      registerRenderHost(null);
      host.dispose();
    };
  }, [registerRenderHost]);

  // Click-vs-drag threshold cleanup (see `pointerDownPos`'s doc comment
  // above): a real `addEventListener("pointerup", ...)` on `window`, NOT a
  // JSX `onPointerUp` prop on the mount div — a JSX handler only fires when
  // the pointerup's target is that div or a descendant, but a real drag
  // gesture routinely ends with the pointer released somewhere else
  // entirely (over the scene tree, outside the browser chrome's tracked
  // area, etc.). Without this being global, a release outside the div would
  // leave OrbitControls permanently disabled.
  //
  // Deliberately does NOT clear `pointerDownPos` — native event order is
  // pointerup -> mouseup -> click, so this handler always runs BEFORE the
  // "click" (or "contextmenu") event `wasDrag()` needs it for; clearing it
  // here would make every drag look like a fresh, zero-distance click by
  // the time `onClick` inspects it, defeating the "a real orbit drag must
  // not also reselect/deselect at the drop point" half of the fix.
  // `onClick`/`onContextMenu` clear it themselves once they've consumed it.
  useEffect(() => {
    function onWindowPointerUp(): void {
      thresholdCrossed.current = false;
      hostRef.current?.setControlsEnabled(true);
    }
    window.addEventListener("pointerup", onWindowPointerUp);
    return () => window.removeEventListener("pointerup", onWindowPointerUp);
  }, []);

  // Load / patch the scene as the store's document changes. `history`'s own
  // identity is stable for the life of one project — it only changes when a
  // NEW project is imported — so a full loadScene (which re-frames the
  // camera) happens only there. Every subsequent command/undo/redo instead
  // replays its own forward patch batch through RenderHost.patchScene's fast
  // path (RH-001, DOC-040) so a gizmo commit never yanks the camera back.
  useEffect(() => {
    const host = hostRef.current!;
    if (!history) return;
    setSceneReady(false);
    let cancelled = false;
    void host.loadScene(sceneSourceOf(history.document)).then(() => {
      if (!cancelled) setSceneReady(true);
    });
    const unsubscribe = history.onApply((patches) => {
      const outcome = host.patchScene(patches);
      if (outcome === "needs-reload") {
        void host.loadScene(sceneSourceOf(history.document));
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [history]);

  // Selection highlight sync (UX-302/UX-303): driven by the shared store
  // field, so ANY surface that sets it (scene tree, asset rows, or this
  // component's own pick handler below) ends up here. Safe to call before
  // the scene finishes loading (a no-op until `tables` exists) — re-run once
  // `sceneReady` flips so a selection made during the load isn't dropped.
  useEffect(() => {
    hostRef.current?.setHighlight(selectedNodeIndex !== null ? [selectedNodeIndex] : []);
  }, [selectedNodeIndex, history, sceneReady]);

  // Hover outline (UX-301): dashed, and never shown for the current selection.
  useEffect(() => {
    hostRef.current?.setHover(hoveredNodeIndex !== null ? [hoveredNodeIndex] : []);
  }, [hoveredNodeIndex, history, sceneReady]);

  // UX-1110 (specs/ux-usage-mapping.md): the amber reference highlight, a
  // THIRD tier independent of selection/hover — derived from the Behavior
  // graph canvas's own selection via the store's `referenceHighlightSceneNodeIndex()`
  // getter (not reactive state itself, same convention as `historyEntries()`),
  // re-derived whenever any field it reads could have changed. Naturally
  // clears (returns null) when the graph-node selection is cleared/changed
  // to something with no scene-node reference, or the document changes out
  // from under it — no separate clearing code needed here.
  const referenceHighlightNodeIndex = useMemo(
    () => useAppStore.getState().referenceHighlightSceneNodeIndex(),
    [document, selectedGraphNodeIndex, selectedGraphIndex]
  );
  useEffect(() => {
    hostRef.current?.setReferenceHighlight(referenceHighlightNodeIndex !== null ? [referenceHighlightNodeIndex] : []);
  }, [referenceHighlightNodeIndex, history, sceneReady]);

  // specs/ux-scene-tree.md UX-207: the scene-tree/viewport context menu's
  // "Frame" action lives outside this component's own `hostRef` (a
  // scene-tree row has no reach into the live RenderHost), so it goes
  // through the store's `frameRequest` cross-component signal instead —
  // same pattern as `flashTarget`/`triggerFlash` elsewhere in this store.
  // Keyed on the request OBJECT (bumped `seq`), not just `nodeIndex`, so
  // framing the same node twice in a row still re-triggers this effect.
  useEffect(() => {
    if (!frameRequest) return;
    hostRef.current?.frameNode(frameRequest.nodeIndex);
  }, [frameRequest]);

  // Gizmo attach/replace/detach (UX-304..UX-306, RH-018/RH-019/RH-025):
  // attached whenever there's a selection, replaced in place on a mode or
  // selection change, detached on deselect. Gated on `sceneReady` — unlike
  // setHighlight/setHover/pick, attachGizmo THROWS if the scene hasn't
  // finished loading yet, which a selection made during that async load
  // (e.g. a fast scene-tree click right after import) can otherwise race.
  // Also gated on `playState === "stopped"` (specs/ux-shell.md UX-113: the
  // gizmo is one of play mode's disabled edit-affordances) — `startPlay()`
  // itself clears `selectedNodeIndex`, but a scene-tree row click (allowed
  // during play/pause; it's a selection, not a document edit) can set it
  // again mid-session, which would otherwise reattach a live, draggable
  // gizmo onto a node the running engine may itself be animating. Also
  // gated on `tryInPlayEntryId === null` (specs/ux-copilot.md UX-1007's
  // "Try in play" preview, Part B's own design note in app-store.ts): the
  // document isn't frozen during a preview (`playState` stays "stopped" on
  // purpose), but the preview's own PlayController is writing transforms
  // into the SAME live RenderHost every frame -- an attached, draggable
  // TransformControls gizmo would otherwise fight that.
  useEffect(() => {
    const host = hostRef.current!;
    if (!sceneReady) return;
    if (selectedNodeIndex !== null && playState === "stopped" && tryInPlayEntryId === null) {
      host.attachGizmo(selectedNodeIndex, gizmoMode);
    } else {
      host.detachGizmo();
    }
  }, [selectedNodeIndex, gizmoMode, history, sceneReady, playState, tryInPlayEntryId]);

  // Gizmo drag/commit (UX-305, RH-003): the "drag" phase is already live —
  // TransformControls writes straight to the object's transform, which the
  // render loop then shows every frame — so this only reacts to "commit",
  // the one place a SceneEdit.setTransform command reaches HistoryStack
  // (making Undo/Redo meaningful for gizmo edits). Only the field matching
  // the mode active AT COMMIT TIME is written, via gizmoModeRef (a plain
  // `gizmoMode` closure would go stale since this effect subscribes once).
  useEffect(() => {
    const host = hostRef.current!;
    return host.onGizmoChange((event) => {
      if (event.phase !== "commit") return;
      const doc = history?.document;
      if (!doc) return;
      const fields: TransformFields =
        gizmoModeRef.current === "translate"
          ? { translation: event.trs.translation }
          : gizmoModeRef.current === "rotate"
            ? { rotation: event.trs.rotation }
            : { scale: event.trs.scale };
      dispatchCommand(SceneEdit.setTransform(doc, event.nodeIndex, fields));
    });
  }, [history, dispatchCommand]);

  // M7 (AudioHost.setListenerPose, specs/engine-api.md): listener pose fed
  // from the viewport camera per-frame ONLY while playing, gated here on the
  // store's `playState === "playing"` (packages/play PC-001's own flag —
  // pausing or stopping stops the feed too, matching how the rest of play
  // mode freezes/pauses cleanly). While gated in: poll the live camera pose
  // and forward it to `audioHost.setListenerPose` whenever it actually
  // changed. Skips entirely (interval never scheduled) when no `audioHost`
  // is registered or play mode isn't active.
  //
  // A `setInterval` at 10Hz, NOT a `requestAnimationFrame` loop: this ran
  // continuously (60 wakeups/sec) for every mounted Viewport in EVERY test
  // that loads any document — nearly the whole e2e suite, not just audio
  // tests — and, unlike a timer macrotask, an rAF callback competes for the
  // exact same per-frame budget as React's own commit/paint work. That
  // measurably starved an already-timing-marginal, pre-existing test
  // (e2e/graph-canvas.spec.ts:67's own comments already document its
  // sensitivity to "heavy... parallelism") enough to fail CI outright — see
  // this PR's own description. Spatial audio has no need for 60Hz listener
  // updates anyway; 10Hz is standard practice for this exact purpose.
  useEffect(() => {
    if (!document || !audioHost || playState !== "playing") return;
    let lastPoseKey = "";
    function tick(): void {
      const host = hostRef.current;
      if (host && sceneReady) {
        const pose = host.getCameraPose();
        const key = `${pose.position.join(",")}|${pose.rotation.join(",")}`;
        if (key !== lastPoseKey) {
          lastPoseKey = key;
          audioHost!.setListenerPose(pose);
        }
      }
    }
    const intervalId = window.setInterval(tick, 100);
    return () => window.clearInterval(intervalId);
  }, [document, audioHost, sceneReady, playState]);

  // W/E/R keyboard shortcuts, mirroring the toolbar buttons' own tooltips.
  useEffect(() => {
    if (!document) return;
    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const entry = GIZMO_MODES.find((m) => m.label.toLowerCase() === e.key.toLowerCase());
      if (entry) setGizmoMode(entry.mode);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [document, setGizmoMode]);

  function ndcFromEvent(e: React.PointerEvent<HTMLDivElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    return [x, y];
  }

  // Disabling OrbitControls here relies on browser event order: OrbitControls'
  // own native listener is bound directly to the canvas (the actual pointerdown
  // TARGET), so it always runs before this React handler, which is invoked
  // during the bubble phase on this ancestor `#viewport-mount` div — by the
  // time `setControlsEnabled(false)` below takes effect, OrbitControls has
  // already recorded its rotate/pan start position but has not yet reacted to
  // any pointermove (none has been dispatched yet; JS is single-threaded), so
  // no rotation has happened. Its very next pointermove — however soon that
  // fires — will see `enabled === false` and no-op.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    thresholdCrossed.current = false;
    hostRef.current?.setControlsEnabled(false);
  }

  function onClick(e: React.PointerEvent<HTMLDivElement>): void {
    // Consume this gesture's pointerDownPos now, unconditionally: `wasDrag`
    // needs it (native order is pointerdown -> ... -> pointerup -> click, so
    // it's still the position from THIS gesture's press), but it must not
    // leak into the next one.
    const dragged = wasDrag(e);
    pointerDownPos.current = null;
    if (!document) return;
    if (dragged) return; // an orbit drag, not a click-to-select (see pointerDownPos's doc comment above).
    const [x, y] = ndcFromEvent(e);
    const result = hostRef.current?.pick(x, y) ?? null;
    if (playState !== "stopped") {
      // PC-008: route clicks to the running engine's fireSelect instead of
      // editor selection while playing/paused — do not touch editor
      // selection state (UX-113: editing affordances are disabled).
      const controller = getActivePlayController();
      if (result) controller?.fireSelect(result.nodeIndex, result.point, hostRef.current?.getCameraPose().position);
      return;
    }
    selectNode(result?.nodeIndex ?? null); // UX-302 (hit) / UX-303 (empty space clears)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!document) return;
    // Mid-gesture (a button is down): once movement crosses the click/drag
    // threshold, this IS a deliberate orbit drag — hand the pointer back to
    // OrbitControls (disabled by `onPointerDown` above) so the rest of the
    // drag orbits/pans normally. Below the threshold this intentionally does
    // nothing, leaving OrbitControls disabled — see the fix's doc comment
    // above `pointerDownPos`.
    if (pointerDownPos.current && !thresholdCrossed.current && wasDrag(e)) {
      thresholdCrossed.current = true;
      hostRef.current?.setControlsEnabled(true);
    }
    const [x, y] = ndcFromEvent(e);
    const result = hostRef.current?.pick(x, y) ?? null;
    if (playState !== "stopped") {
      const controller = getActivePlayController();
      if (result) controller?.fireHoverIn(result.nodeIndex, result.point);
      else controller?.fireHoverOut();
      return;
    }
    setHover(result?.nodeIndex ?? null);
  }

  function onPointerLeave(): void {
    if (playState !== "stopped") {
      getActivePlayController()?.fireHoverOut();
      return;
    }
    setHover(null);
  }

  function onFrameSelected(): void {
    hostRef.current?.frameNode(selectedNodeIndex); // UX-308: selection, or whole scene when null
  }

  // specs/ux-scene-tree.md UX-207: "Right-clicking a scene-tree row OR a
  // viewport object" -- reuses the exact same `pick()` raycast `onClick`
  // already does at these NDC coordinates, so a right-click resolves to
  // whichever object is actually under the cursor rather than falling back
  // to the current selection.
  function onContextMenu(e: React.MouseEvent<HTMLDivElement>): void {
    // See onClick's identical pattern: consume + clear pointerDownPos now,
    // unconditionally, so it can't leak into the next gesture.
    const dragged = wasDrag(e);
    pointerDownPos.current = null;
    if (!document || playState !== "stopped") return;
    if (dragged) return; // an orbit pan (OrbitControls' default right-button action), not a context-menu request.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const result = hostRef.current?.pick(x, y) ?? null;
    if (!result) return; // no object under the cursor -- nothing to menu about (UX-207 is scoped to "a scene-tree row or a viewport OBJECT").
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeIndex: result.nodeIndex });
  }

  const previewEntry = tryInPlayEntryId ? copilotThread.find((entry) => entry.id === tryInPlayEntryId) : undefined;
  const previewSummary = previewEntry && previewEntry.kind === "proposal" ? previewEntry.proposal.summary : "Copilot proposal";

  const nodeName = (nodeIndex: number): string => (document?.json as GltfJsonShape | undefined)?.nodes?.[nodeIndex]?.name ?? `Node ${nodeIndex}`;

  const selectedName =
    selectedNodeIndex !== null
      ? ((document?.json as GltfJsonShape | undefined)?.nodes?.[selectedNodeIndex]?.name ?? `Node ${selectedNodeIndex}`)
      : null;

  // specs/ux-shell.md UX-119 (supersedes UX-114): the empty-project state's
  // starter-experience gallery -- two cards, each fetching its own
  // committed sample asset (samples/*.glb) as a static file this app's own
  // build already serves (packages/app/scripts/copy-sample.mjs copies both
  // into public/ at predev/prebuild, same mechanism as
  // gltfi-runtime-lib.mjs) and importing it exactly the way a manually-picked
  // file would via the top bar's Import control. `import.meta.env.BASE_URL`
  // (not a hardcoded "/") so this also works once deployed under a GitHub
  // Pages project-site subpath.
  const onLoadSample = (sample: SampleDescriptor) => async (): Promise<void> => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${sample.file}`);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await importGlb({ name: sample.file, bytes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushToast(`Couldn't load "${sample.label}": ${message}`);
    }
  };

  return (
    <div id="viewport" data-testid="viewport.panel">
      <div
        id="viewport-mount"
        data-testid="viewport.mount"
        ref={mountRef}
        className={hoveredNodeIndex !== null ? "hover-pickable" : undefined}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onContextMenu={onContextMenu}
      >
        {!document && (
          <div className="viewport-empty-state" data-testid="viewport.empty-state">
            {/* See app.css's own comment on `.viewport-empty-state`/`.viewport-empty-state-inner`
                for why this is two nested divs rather than one: the outer one is an
                absolutely-positioned overlay (like the play overlay/preview strip below), taken
                out of flex flow entirely so it can't compete with the always-mounted <canvas>
                sibling for flex space; the inner one is the actual width-capped content box. */}
            <div className="viewport-empty-state-inner">
              <p className="viewport-placeholder-note" data-testid="viewport.placeholder-note">
                Import a .glb to get started, or try one of these:
              </p>
              <div className="sample-gallery" data-testid="viewport.gallery">
                {SAMPLE_GALLERY.map((sample) => (
                  <div className="sample-card" data-testid={`viewport.gallery.card.${sample.key}`} key={sample.key}>
                    <div className="sample-card-preview" data-testid={`viewport.gallery.card.${sample.key}.preview`}>
                      {sample.key === "playground" ? <PlaygroundPreview /> : <RacerPreview />}
                    </div>
                    <h4 className="sample-card-title">{sample.label}</h4>
                    <p className="sample-card-desc">{sample.description}</p>
                    <button
                      className="btn"
                      data-testid={`viewport.gallery.card.${sample.key}.load`}
                      onClick={() => void onLoadSample(sample)()}
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {document && (
        <>
          <div className="vp-toolbar" data-testid="viewport.gizmo-group">
            {GIZMO_MODES.map(({ mode, label, title }) => (
              <button
                key={mode}
                className={`btn icon-only${gizmoMode === mode ? " active" : ""}`}
                data-testid={`viewport.gizmo-${label.toLowerCase()}`}
                title={title}
                onClick={() => setGizmoMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="vp-toolbar-right">
            <button className="btn icon-only" data-testid="viewport.camera-frame" title="Frame selected" onClick={onFrameSelected}>
              ⛶
            </button>
          </div>
          {selectedName && (
            <div className="vp-selection-label" data-testid="viewport.selection-label">
              {selectedName}
            </div>
          )}
        </>
      )}
      <PlayOverlay />
      {tryInPlayEntryId && (
        // Part B ("apply-scratch-play-discard", app-store.ts's own doc
        // comment on `startTryInPlay`): the one honest visual cue that a
        // preview -- not real play mode -- is running. Deliberately NOT
        // `specs/ux-shell.md` UX-106's locked-banner/topbar tint: the
        // document isn't locked, so that chrome would misrepresent this.
        <div className="preview-strip" data-testid="viewport.preview-strip">
          <span>Previewing Copilot proposal: {previewSummary}</span>
          <button data-testid="viewport.preview-strip.stop" onClick={() => void stopTryInPlay()}>
            Stop preview
          </button>
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          testId="viewport.context-menu"
          onDismiss={() => setContextMenu(null)}
          actions={[
            { key: "frame", label: "Frame", onSelect: () => requestFrame(contextMenu.nodeIndex) },
            {
              key: "rename",
              label: "Rename",
              onSelect: () => {
                const name = window.prompt("Rename node", nodeName(contextMenu.nodeIndex));
                if (name && name.trim() && history) {
                  dispatchCommand(SceneEdit.setName(history.document, contextMenu.nodeIndex, name.trim()));
                }
              }
            },
            {
              key: "ask-copilot",
              label: "✦ Ask Copilot about this…",
              onSelect: () => {
                const label = nodeName(contextMenu.nodeIndex);
                setActiveRightTab("copilot");
                addCopilotContextChip({ kind: "explicit", label, pointer: `/nodes/${contextMenu.nodeIndex}` }, label);
                requestCopilotComposerFocus();
              }
            }
          ]}
        />
      )}
    </div>
  );
}
