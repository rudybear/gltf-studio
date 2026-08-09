import { useEffect, useRef, useState } from "react";
import { createThreeRenderHost, type ThreeRenderHost } from "@gltf-studio/engine-three";
import type { CameraPose, GizmoMode } from "@gltf-studio/engine-api";
import { SceneEdit, type TransformFields } from "@gltf-studio/editor-core";
import { useAppStore, getActivePlayController } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { PlayOverlay } from "./PlayOverlay";
import { ContextMenu } from "../ContextMenu";

/** specs/ux-viewport.md UX-304: exactly W/E/R, mutually exclusive, one-to-one with RH-018's GizmoMode. */
const GIZMO_MODES: ReadonlyArray<{ mode: GizmoMode; label: string; title: string }> = [
  { mode: "translate", label: "W", title: "Move (W)" },
  { mode: "rotate", label: "E", title: "Rotate (E)" },
  { mode: "scale", label: "R", title: "Scale (R)" }
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

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeIndex: number } | null>(null);

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
    void host.loadScene(history.document.json).then(() => {
      if (!cancelled) setSceneReady(true);
    });
    const unsubscribe = history.onApply((patches) => {
      const outcome = host.patchScene(patches);
      if (outcome === "needs-reload") {
        void host.loadScene(history.document.json);
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

  function onClick(e: React.PointerEvent<HTMLDivElement>): void {
    if (!document) return;
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
    if (!document || playState !== "stopped") return;
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

  return (
    <div id="viewport" data-testid="viewport.panel">
      <div
        id="viewport-mount"
        data-testid="viewport.mount"
        ref={mountRef}
        className={hoveredNodeIndex !== null ? "hover-pickable" : undefined}
        onClick={onClick}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onContextMenu={onContextMenu}
      >
        {!document && (
          <p className="viewport-placeholder-note" data-testid="viewport.placeholder-note">
            Import a .glb to get started.
          </p>
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
