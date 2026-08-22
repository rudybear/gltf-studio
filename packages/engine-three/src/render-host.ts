// ThreeRenderHost: the viewport abstraction (specs/render-host.md) over
// three.js + the vendored @gltfi/three-adapter. See that spec's "Open
// questions" section for the concrete shape choices this implementation
// makes where the RenderHost interface (packages/engine-api) deliberately
// stays generic (mount's container contract, loadScene's input shape,
// applyPointer's value shape, PickResult's `distance` field) and for the
// WebGLRenderer-over-WebGPURenderer decision.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  registerInteractivity,
  applyPointer as applyPointerToTables,
  DiagnosticsRecorder,
  IndexTables,
  buildIndexTables
} from "@gltfi/three-adapter";
import { applyPatches } from "@gltf-studio/editor-core";
import type {
  CameraPose,
  EditorHelperDescriptor,
  GizmoChangeEvent,
  GizmoChangePhase,
  GizmoMode,
  JsonPatchOp,
  PatchOutcome,
  PickOptions,
  PickResult,
  RenderHost,
  TRS
} from "@gltf-studio/engine-api";
import { disposeObject3D } from "./dispose-object3d.js";
import { frameCameraOnObject } from "./frame-camera.js";
import { applyDoubleSidedPatch, applyTextureSlotClearPatch } from "./material-extras.js";
import { classifyPatchBatch } from "./patch-classify.js";
import { coercePointerValue } from "./pointer-value.js";
import { toGlbArrayBuffer } from "./scene-input.js";

/**
 * Studio-rig AUTO policy (specs/ux-viewport.md's studio-lighting section):
 * true when the document carries at least one REAL `KHR_lights_punctual`
 * registry entry — deliberately a cheap, static JSON check (does this
 * document author any punctual light at all) rather than "is a light
 * currently reachable/visible from the default scene", matching the same
 * simplicity level `documentHasPunctualLights`'s only caller (`loadScene`,
 * recomputed on every load — see that method's own doc comment for why a
 * manual toggle doesn't survive a reload) needs.
 */
const STUDIO_HEMISPHERE_INTENSITY = 1.1;
const STUDIO_DIRECTIONAL_INTENSITY = 2.2;
/** Full punctual-light control: the studio rig's "off" state is DIMMED to this fraction of its full intensity, not hidden entirely — see the `studioHemisphereLight`/`studioDirectionalLight` field doc comment for why a hard `.visible = false` regressed real fixtures with a degenerate/token authored light. */
const STUDIO_DIM_FACTOR = 0.4;

function documentHasPunctualLights(json: unknown): boolean {
  const lights = (json as { extensions?: { KHR_lights_punctual?: { lights?: unknown[] } } } | null | undefined)?.extensions?.KHR_lights_punctual
    ?.lights;
  return Array.isArray(lights) && lights.length > 0;
}

/**
 * Full punctual-light control (RH-032..RH-034): the one THREE helper class
 * per light type three.js itself ships, sized/instantiated per its own
 * constructor signature (PointLightHelper/DirectionalLightHelper take an
 * explicit size in world units — 0.3 keeps them small relative to this
 * app's own default studio-rig/grid scale, matching this package's other
 * gizmo/highlight helpers' modest visual footprint; SpotLightHelper derives
 * its own size from the light's cone, no size argument). Returns `null` for
 * any other `THREE.Light` subclass (e.g. `HemisphereLight`/`AmbientLight` —
 * not a `KHR_lights_punctual` type at all, never reachable here since only
 * point/spot/directional nodes are ever looked up by `lightObjectForNode`,
 * but kept a graceful `null` rather than a assumption-throw for safety).
 */
function buildLightHelper(light: THREE.Light): THREE.Object3D | null {
  const anyLight = light as THREE.PointLight & THREE.SpotLight & THREE.DirectionalLight;
  if (anyLight.isPointLight) return new THREE.PointLightHelper(light as THREE.PointLight, 0.3);
  if (anyLight.isSpotLight) return new THREE.SpotLightHelper(light as THREE.SpotLight);
  if (anyLight.isDirectionalLight) return new THREE.DirectionalLightHelper(light as THREE.DirectionalLight, 0.3);
  return null;
}

function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

/** Renderer-level stats surface — not part of the RenderHost interface (it is three.js-specific), used by engine-three's own leak-discipline tests and available for a future viewport HUD. */
export interface RendererStats {
  geometries: number;
  textures: number;
}

export class ThreeRenderHost implements RenderHost {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafHandle: number | null = null;

  private modelRoot: THREE.Object3D | null = null;
  private tables: IndexTables | null = null;
  private diagnostics: DiagnosticsRecorder | null = null;
  private currentJson: unknown = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private highlightHelpers: THREE.BoxHelper[] = [];
  private highlightedNodeIndices = new Set<number>();
  private hoverHelpers: THREE.BoxHelper[] = [];
  private lastHoverIndices: number[] = [];
  // RH-029/RH-030 (specs/ux-usage-mapping.md UX-1110): a third, independent
  // highlighted-node set — its own helper list/index set, cleared on the
  // same lifecycle events as `highlightHelpers` above but never by
  // `setHighlight`/`setHover` (the three tiers are fully independent).
  private referenceHighlightHelpers: THREE.BoxHelper[] = [];
  private referenceHighlightedNodeIndices = new Set<number>();

  // Full punctual-light control (specs/render-host.md's implementation
  // notes, specs/ux-viewport.md's studio-lighting section): the neutral
  // studio rig's two actual lights (hemisphere + directional key light) —
  // NOT the grid helper, which stays a plain scene sibling, unaffected by
  // the studio-lighting AUTO policy/toggle. DIMMED (intensity scaled down
  // by STUDIO_DIM_FACTOR), never fully hidden, when the AUTO policy or the
  // manual toggle turns it "off" — see `setStudioLightingEnabled`'s own doc
  // comment for why a full on/off (`.visible = false`) turned out to be the
  // wrong call: a document whose only authored light is a token/placeholder
  // one (this project's own `e2e/global-setup.ts` fixture had exactly this
  // shape — a `KHR_lights_punctual` point light co-located with the very
  // surface it nominally lights, a genuinely degenerate near-zero-distance
  // case no realistic intensity value fixes) would otherwise go completely
  // dark the instant it's imported, a far worse outcome than a merely-
  // dimmed neutral fill the user can still fall back on.
  private studioHemisphereLight: THREE.HemisphereLight | null = null;
  private studioDirectionalLight: THREE.DirectionalLight | null = null;
  private studioLightingFull = true;
  // `editorHelperGroup` is the dedicated EDITOR-ONLY overlay group RH-032
  // describes: every visual `setEditorHelpers` creates lives here, nowhere
  // else, so `snapshot()` (RH-034) can hide the whole group for one render
  // call cheaply, and so it's obvious by construction that nothing in it
  // ever reaches `this.currentJson`/`patchScene`'s document-facing state.
  private editorHelperGroup: THREE.Group | null = null;
  private editorHelperObjects = new Map<string, THREE.Object3D>();

  private gizmo: TransformControls | null = null;
  private gizmoNodeIndex: number | null = null;
  private readonly gizmoChangeHandlers = new Set<(event: GizmoChangeEvent) => void>();

  private loadToken = 0;

  private readonly tick = (): void => {
    this.rafHandle = requestAnimationFrame(this.tick);
    this.controls?.update();
    for (const helper of this.highlightHelpers) {
      helper.update();
    }
    for (const helper of this.hoverHelpers) {
      helper.update();
      // BoxHelper.update() rebuilds its LineSegments geometry from the
      // tracked object's current bounding box every frame; a dashed
      // LineDashedMaterial needs computeLineDistances() re-run against that
      // fresh geometry too, or the dash pattern goes stale/wrong as soon as
      // the object (or camera) moves.
      helper.computeLineDistances();
    }
    for (const helper of this.referenceHighlightHelpers) {
      helper.update();
    }
    // RH-032: PointLightHelper/SpotLightHelper/DirectionalLightHelper each
    // rebuild their own wireframe geometry from the live light's CURRENT
    // color/cone/etc on `.update()` — called every frame here (same
    // convention as the highlight/hover/reference-highlight helpers just
    // above) so a `patchScene`/`applyPointer` light-property write shows up
    // in the helper's own shape immediately, with no separate "refresh the
    // helpers" call needed from `applyNonStructuralPatch`.
    for (const helper of this.editorHelperObjects.values()) {
      (helper as { update?: () => void }).update?.();
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  // ---------------------------------------------------------------------
  // Lifecycle: mount / dispose (RH-004..RH-010)
  // ---------------------------------------------------------------------

  mount(container: HTMLElement): void {
    if (!this.renderer) {
      this.initRenderer();
    }
    if (this.container !== container) {
      this.detachCanvas();
      this.container = container;
      container.appendChild(this.canvas!);
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.resize();
  }

  private initRenderer(): void {
    const canvas = document.createElement("canvas");
    this.canvas = canvas;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2));
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11141a);
    this.scene = scene;

    // Neutral studio rig: hemisphere (sky/ground fill) + directional (key
    // light) — many glTF assets ship with no lights of their own at all.
    // Full punctual-light control: DIMMED (never fully hidden — see the
    // field doc comment above) by the AUTO policy (`loadScene`, below) and
    // the viewport toolbar's manual toggle (`setStudioLightingEnabled`) —
    // the grid stays a plain, always-on scene sibling, unaffected by either.
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x30323a, STUDIO_HEMISPHERE_INTENSITY);
    const directionalLight = new THREE.DirectionalLight(0xffffff, STUDIO_DIRECTIONAL_INTENSITY);
    directionalLight.position.set(3, 6, 4);
    this.studioHemisphereLight = hemisphereLight;
    this.studioDirectionalLight = directionalLight;
    const grid = new THREE.GridHelper(10, 10);
    scene.add(hemisphereLight, directionalLight, grid);

    // RH-032: the dedicated editor-only overlay group — see its own field
    // doc comment above for what it's for and why it stays separate from
    // every other scene content.
    const editorHelperGroup = new THREE.Group();
    editorHelperGroup.name = "editor-helpers";
    scene.add(editorHelperGroup);
    this.editorHelperGroup = editorHelperGroup;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(2, 2, 3);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    this.controls = controls;

    this.diagnostics = new DiagnosticsRecorder();

    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private detachCanvas(): void {
    if (this.canvas && this.container && this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private resize(): void {
    if (!this.renderer || !this.camera || !this.container) {
      return;
    }
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (!this.renderer) {
      return; // RH-005/RH-006: idempotent, and safe with no prior mount.
    }
    this.loadToken++; // invalidate any in-flight loadScene

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    if (this.modelRoot) {
      this.scene!.remove(this.modelRoot);
      disposeObject3D(this.modelRoot);
      this.modelRoot = null;
    }

    for (const helper of this.highlightHelpers) {
      this.scene!.remove(helper);
      helper.dispose();
    }
    this.highlightHelpers = [];
    this.highlightedNodeIndices = new Set();

    for (const helper of this.hoverHelpers) {
      this.scene!.remove(helper);
      helper.dispose();
    }
    this.hoverHelpers = [];
    this.lastHoverIndices = [];

    for (const helper of this.referenceHighlightHelpers) {
      this.scene!.remove(helper);
      helper.dispose();
    }
    this.referenceHighlightHelpers = [];
    this.referenceHighlightedNodeIndices = new Set();

    this.disposeEditorHelpers();
    this.studioHemisphereLight = null;
    this.studioDirectionalLight = null;
    this.studioLightingFull = true;
    this.editorHelperGroup = null;

    if (this.gizmo) {
      this.scene!.remove(this.gizmo.getHelper());
      this.gizmo.dispose();
      this.gizmo = null;
      this.gizmoNodeIndex = null;
    }

    this.controls?.dispose();
    this.controls = null;

    this.renderer.dispose();
    this.detachCanvas();

    this.renderer = null;
    this.canvas = null;
    this.container = null;
    this.scene = null;
    this.camera = null;
    this.tables = null;
    this.diagnostics = null;
    this.currentJson = null;
  }

  // ---------------------------------------------------------------------
  // loadScene (RH-007, RH-008)
  // ---------------------------------------------------------------------

  async loadScene(json: unknown): Promise<void> {
    if (!this.renderer || !this.scene || !this.camera) {
      throw new Error("RenderHost.loadScene: call mount() first");
    }
    const buffer = toGlbArrayBuffer(json);

    const token = ++this.loadToken;
    const loader = new GLTFLoader();
    let loadedTables: IndexTables | undefined;
    registerInteractivity(loader, {
      onTables: (t) => {
        loadedTables = t;
      }
    });

    const gltf = await loader.parseAsync(buffer, "");
    if (token !== this.loadToken) {
      return; // superseded by a newer loadScene/dispose call — RH-008 last-writer-wins.
    }

    // RH-008: tear down the previous scene before mounting the new one.
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      disposeObject3D(this.modelRoot);
      this.modelRoot = null;
    }
    for (const helper of this.highlightHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.highlightHelpers = [];
    this.highlightedNodeIndices = new Set();
    for (const helper of this.hoverHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.hoverHelpers = [];
    this.lastHoverIndices = [];
    for (const helper of this.referenceHighlightHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.referenceHighlightHelpers = [];
    this.referenceHighlightedNodeIndices = new Set();
    this.gizmo?.detach();
    this.gizmoNodeIndex = null;
    // RH-032: every existing helper object was built against the OLD
    // tables/light objects `disposeObject3D(this.modelRoot)` above just
    // tore down — stale references, cleared the same way every other
    // per-node helper set in this method is. The caller (Viewport.tsx,
    // mirroring its own gizmo/highlight `reloadSeq` re-attach convention)
    // re-calls `setEditorHelpers` once the new tables exist.
    this.disposeEditorHelpers();

    this.modelRoot = gltf.scene;
    this.scene.add(this.modelRoot);
    frameCameraOnObject(this.camera, this.controls?.target, this.modelRoot);
    this.controls?.update();

    this.tables = loadedTables ?? buildIndexTables(gltf.parser, gltf.scene);
    this.diagnostics = new DiagnosticsRecorder();
    this.currentJson = gltf.parser.json;

    // Studio-rig AUTO policy (specs/ux-viewport.md): recomputed on EVERY
    // load/reload, unconditionally — a prior manual `setStudioLightingEnabled`
    // toggle does not survive a reload (a deliberate v1 simplicity choice,
    // documented on that method's own doc comment, not an oversight).
    this.applyStudioLighting(!documentHasPunctualLights(this.currentJson));
  }

  /** Full punctual-light control: sets both studio-rig lights' intensity to full strength or `STUDIO_DIM_FACTOR` of it (never `0` — see the two light fields' own doc comment) and records `studioLightingFull` for `getStudioLightingEnabled()` to read back. */
  private applyStudioLighting(full: boolean): void {
    this.studioLightingFull = full;
    const factor = full ? 1 : STUDIO_DIM_FACTOR;
    if (this.studioHemisphereLight) {
      this.studioHemisphereLight.intensity = STUDIO_HEMISPHERE_INTENSITY * factor;
    }
    if (this.studioDirectionalLight) {
      this.studioDirectionalLight.intensity = STUDIO_DIRECTIONAL_INTENSITY * factor;
    }
  }

  /** RH-032: disposes and clears every currently-tracked editor-helper object (both loadScene's reload teardown and dispose() use this). */
  private disposeEditorHelpers(): void {
    if (this.editorHelperGroup) {
      for (const helper of this.editorHelperObjects.values()) {
        this.editorHelperGroup.remove(helper);
        (helper as { dispose?: () => void }).dispose?.();
      }
    }
    this.editorHelperObjects.clear();
  }

  // ---------------------------------------------------------------------
  // patchScene (RH-001, RH-011..RH-014)
  // ---------------------------------------------------------------------

  patchScene(patches: JsonPatchOp[]): PatchOutcome {
    if (!this.tables || this.currentJson === null) {
      throw new Error("RenderHost.patchScene: call loadScene() first");
    }
    const outcome = classifyPatchBatch(patches, this.currentJson);
    if (outcome === "needs-reload") {
      return "needs-reload";
    }
    for (const patch of patches) {
      this.applyNonStructuralPatch(patch);
    }
    this.currentJson = applyPatches(this.currentJson, patches);
    return "applied";
  }

  private applyNonStructuralPatch(patch: JsonPatchOp): void {
    if (!this.tables || !this.diagnostics) {
      return;
    }
    // UX-415/UX-416 (material-extras.ts): two patch shapes with no vendored
    // pointer-router row — `doubleSided` (add/replace) and a texture-info
    // slot CLEAR (remove) — handled directly against the live three.js
    // materials before falling through to the generic op-guard/router path
    // below. Checked first specifically so a `remove` op (the texture-clear
    // case) gets a chance at all: the pre-existing op guard right after this
    // only ever forwards add/replace to the pointer-router.
    if (applyDoubleSidedPatch(this.tables, patch)) return;
    if (applyTextureSlotClearPatch(this.tables, patch)) return;
    if (patch.op !== "replace" && patch.op !== "add") {
      return; // no live three.js-side effect for remove/move/copy/test the two checks above didn't already claim.
    }
    const value = coercePointerValue(patch.value, `RenderHost.patchScene(${patch.path})`);
    applyPointerToTables(this.tables, patch.path, value, this.diagnostics);
  }

  // ---------------------------------------------------------------------
  // pick (RH-015)
  // ---------------------------------------------------------------------

  /**
   * RH-027: default (options omitted/false) enforces KHR_node_selectability
   * — the gate PLAY-mode's select/hover injection always relies on (scenery
   * a game deliberately marks non-interactive-during-play must stay
   * unpickable there). `options.ignoreEligibility: true` bypasses that
   * check entirely for EDIT-mode authoring — visibility and nearest-node-
   * ancestor resolution still apply, only the selectable gate is skipped —
   * so any visible node can be selected/hovered while editing regardless of
   * its authored selectability/hoverability.
   */
  pick(x: number, y: number, options?: PickOptions): PickResult | null {
    if (!this.camera || !this.modelRoot || !this.tables) {
      return null;
    }
    // Raycaster reads each object's cached matrixWorld — a just-applied
    // patchScene/applyPointer TRS write (or setCameraPose) does not itself
    // recompute it, and pick() may run before the rAF loop's next render()
    // does so as a side effect.
    this.camera.updateMatrixWorld();
    this.modelRoot.updateMatrixWorld(true);
    this.pointerNdc.set(x, y);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.modelRoot, true);
    for (const hit of hits) {
      let current: THREE.Object3D | null = hit.object;
      while (current) {
        const nodeIndex = this.tables.nodeIndexByObject.get(current);
        if (nodeIndex !== undefined) {
          const state = this.tables.getNodeState(nodeIndex);
          if (isEffectivelyVisible(current) && (options?.ignoreEligibility || state.selectable)) {
            return {
              nodeIndex,
              point: hit.point.toArray() as [number, number, number],
              distance: hit.distance
            };
          }
          break; // nearest node ancestor found but ineligible — try the next hit, not further up the chain.
        }
        current = current.parent;
      }
    }
    return null;
  }

  /**
   * Not part of the RenderHost interface (see specs/render-host.md's M2
   * DECISION note) — lets Viewport.tsx suppress OrbitControls entirely for
   * the first few pixels of a pointer gesture. OrbitControls has no
   * click-vs-drag threshold of its own: it starts rotating/panning the
   * camera on the very first `pointermove` after `pointerdown`, however
   * small. A real mouse or trackpad essentially never holds pixel-perfect
   * still between press and release, so without this, the camera has
   * already rotated a fraction of a degree away from the pose the user was
   * looking at by the time their "click" reaches `pick()` — enough to miss
   * whatever appeared to be right under the cursor (the actual cause of
   * "clicking objects in the viewport doesn't select them"). A no-op when
   * `mount()` hasn't run yet (no `controls` to toggle).
   */
  /**
   * Not part of the RenderHost interface either (same DECISION note as
   * `setControlsEnabled` above) — lets Viewport.tsx's click-vs-drag
   * threshold logic tell a genuine orbit drag apart from a TransformControls
   * gizmo drag before deciding whether to re-enable OrbitControls mid-
   * gesture. Backed directly by TransformControls' own public `dragging`
   * (three.js sets it `true` synchronously in its native pointerdown handler
   * on the canvas — which, same as OrbitControls', always runs before this
   * component's own React pointer handlers on the ancestor `#viewport-mount`
   * div, per bubble order — and back to `false` on its native pointerup), so
   * it's always current by the time a bubbled pointermove/pointerup handler
   * checks it. `false` when no gizmo is attached at all.
   */
  isGizmoDragging(): boolean {
    return this.gizmo?.dragging ?? false;
  }

  setControlsEnabled(enabled: boolean): void {
    if (this.controls) {
      this.controls.enabled = enabled;
    }
  }

  // ---------------------------------------------------------------------
  // Camera pose (RH-016, RH-017)
  // ---------------------------------------------------------------------

  getCameraPose(): CameraPose {
    if (!this.camera) {
      throw new Error("RenderHost.getCameraPose: call mount() first");
    }
    const position = this.camera.position.toArray() as [number, number, number];
    const rotation = this.camera.quaternion.toArray() as [number, number, number, number];
    if (this.controls) {
      return { position, rotation, target: this.controls.target.toArray() as [number, number, number] };
    }
    return { position, rotation };
  }

  setCameraPose(pose: CameraPose): void {
    if (!this.camera) {
      throw new Error("RenderHost.setCameraPose: call mount() first");
    }
    this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.camera.quaternion.set(pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]);
    this.camera.updateMatrixWorld(true);
    if (pose.target && this.controls) {
      // RH-017: position/rotation round-trip exactly as set — deliberately
      // does NOT call `controls.update()` here, since OrbitControls.update()
      // unconditionally re-derives the camera's orientation from
      // (position, target), which would silently discard a caller-set
      // rotation that isn't itself a plain look-at of `target` (e.g. any
      // roll). `controls.target` is still recorded for future orbit-drag
      // interactions and for getCameraPose's optional `target` field; the
      // rAF loop's own per-frame `controls.update()` call is what
      // eventually reconciles the two, one frame later — acceptable since
      // RH-017 only requires target to round-trip, not to stay
      // orbit-consistent indefinitely.
      this.controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
    }
  }

  // ---------------------------------------------------------------------
  // Gizmo (RH-003, RH-018, RH-019)
  // ---------------------------------------------------------------------

  attachGizmo(nodeIndex: number, mode: GizmoMode): void {
    if (!this.renderer || !this.camera || !this.scene || !this.tables) {
      throw new Error("RenderHost.attachGizmo: call mount() and loadScene() first");
    }
    const object = this.tables.nodeByIndex[nodeIndex];
    if (!object) {
      // M8-lite fix (specs/ux-scene-tree.md UX-213's auto-select-the-new-node
      // behavior surfaced this): a structural edit (e.g. the "+ Add" menu)
      // dispatches its command and calls `selectNode` on the SAME tick, but
      // `patchScene`'s resulting "needs-reload" `loadScene()` is async — this
      // effect's own `selectedNodeIndex`-keyed re-run can fire against the
      // STALE `tables` a moment before the new node's index exists in them.
      // Throwing here (the old behavior) crashed the commit as an uncaught
      // render-effect exception. `setHighlight`/`setReferenceHighlight`
      // already treat an unknown index as "no-op the unresolvable entries,
      // don't throw" (their own `tables.nodeByIndex[i]` lookups skip a
      // `continue` rather than erroring) — mirrored here: detach whatever
      // gizmo exists (there is nothing valid to keep it attached to) and
      // return, rather than raise. `Viewport.tsx`'s reload-completion signal
      // (`reloadSeq`) re-runs this effect once the new tables actually
      // contain the node, so the gizmo still ends up attached moments later.
      this.detachGizmo();
      return;
    }
    if (!this.gizmo) {
      const gizmo = new TransformControls(this.camera, this.renderer.domElement);
      this.scene.add(gizmo.getHelper());
      gizmo.addEventListener("dragging-changed", (event) => {
        if (this.controls) {
          this.controls.enabled = !event.value;
        }
        if (!event.value) {
          this.emitGizmoChange("commit");
        }
      });
      gizmo.addEventListener("objectChange", () => {
        this.emitGizmoChange("drag");
      });
      this.gizmo = gizmo;
    }
    // RH-019: replaces whatever was previously attached — no explicit detach needed.
    this.gizmo.setMode(mode);
    this.gizmo.attach(object);
    this.gizmoNodeIndex = nodeIndex;
  }

  /** RH-025: removes any attached gizmo; a no-op when none is attached. */
  detachGizmo(): void {
    if (!this.gizmo) {
      return;
    }
    this.gizmo.detach();
    this.gizmoNodeIndex = null;
  }

  onGizmoChange(handler: (event: GizmoChangeEvent) => void): () => void {
    this.gizmoChangeHandlers.add(handler);
    return () => {
      this.gizmoChangeHandlers.delete(handler);
    };
  }

  private emitGizmoChange(phase: GizmoChangePhase): void {
    if (this.gizmoNodeIndex === null || !this.gizmo?.object) {
      return;
    }
    const object = this.gizmo.object;
    const trs: TRS = {
      translation: object.position.toArray() as [number, number, number],
      rotation: object.quaternion.toArray() as [number, number, number, number],
      scale: object.scale.toArray() as [number, number, number]
    };
    const event: GizmoChangeEvent = { phase, nodeIndex: this.gizmoNodeIndex, trs };
    for (const handler of this.gizmoChangeHandlers) {
      handler(event);
    }
  }

  // ---------------------------------------------------------------------
  // applyPointer (RH-020, RH-021)
  // ---------------------------------------------------------------------

  applyPointer(pointer: string, value: unknown): void {
    if (!this.tables || !this.diagnostics) {
      throw new Error("RenderHost.applyPointer: call loadScene() first");
    }
    applyPointerToTables(this.tables, pointer, coercePointerValue(value, `RenderHost.applyPointer(${pointer})`), this.diagnostics);
  }

  // ---------------------------------------------------------------------
  // Highlight (RH-022, RH-023)
  // ---------------------------------------------------------------------

  setHighlight(nodeIndices: number[]): void {
    if (!this.scene) {
      throw new Error("RenderHost.setHighlight: call mount() first");
    }
    for (const helper of this.highlightHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.highlightHelpers = [];
    this.highlightedNodeIndices = new Set(nodeIndices);
    if (this.tables) {
      for (const nodeIndex of nodeIndices) {
        const object = this.tables.nodeByIndex[nodeIndex];
        if (!object) {
          continue;
        }
        const helper = new THREE.BoxHelper(object, 0xffaa00);
        this.scene.add(helper);
        this.highlightHelpers.push(helper);
      }
    }
    // UX-301: hover is only shown for objects that are NOT the current
    // selection — re-apply it now in case setHighlight just made the
    // hovered node the selection (or vice versa).
    this.applyHover(this.lastHoverIndices);
  }

  /**
   * Not part of the RenderHost interface (see specs/render-host.md's M2
   * DECISION note) — a dashed-outline visual for specs/ux-viewport.md's
   * UX-301 (hover), kept distinct from setHighlight's solid one (RH-022's
   * highlighted set is deliberately style-agnostic at the interface level).
   * Indices already present in the current highlight set are skipped so a
   * hovered-AND-selected object shows only the solid selection outline.
   */
  setHover(nodeIndices: number[]): void {
    this.lastHoverIndices = nodeIndices;
    this.applyHover(nodeIndices);
  }

  private applyHover(nodeIndices: number[]): void {
    if (!this.scene) {
      return;
    }
    for (const helper of this.hoverHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.hoverHelpers = [];
    if (!this.tables) {
      return;
    }
    for (const nodeIndex of nodeIndices) {
      if (this.highlightedNodeIndices.has(nodeIndex)) {
        continue;
      }
      const object = this.tables.nodeByIndex[nodeIndex];
      if (!object) {
        continue;
      }
      const helper = new THREE.BoxHelper(object, 0x4d9dff);
      helper.computeLineDistances();
      helper.material = new THREE.LineDashedMaterial({ color: 0x4d9dff, dashSize: 0.08, gapSize: 0.06 });
      this.scene.add(helper);
      this.hoverHelpers.push(helper);
    }
  }

  // ---------------------------------------------------------------------
  // Reference highlight (RH-029, RH-030 — specs/ux-usage-mapping.md UX-1110)
  // ---------------------------------------------------------------------

  /**
   * A third, solid outline color (0xd9a441, the same amber
   * `docs/ux/mockups/mockup-v6.html` uses for its `--warn` reference-
   * highlight CSS) — distinct from both `setHighlight`'s selection amber
   * (0xffaa00) and `setHover`'s dashed blue (0x4d9dff), so all three tiers
   * remain visually distinguishable when they coexist on the same or
   * different nodes.
   */
  setReferenceHighlight(nodeIndices: number[]): void {
    if (!this.scene) {
      throw new Error("RenderHost.setReferenceHighlight: call mount() first");
    }
    for (const helper of this.referenceHighlightHelpers) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.referenceHighlightHelpers = [];
    this.referenceHighlightedNodeIndices = new Set(nodeIndices);
    if (!this.tables) {
      return;
    }
    for (const nodeIndex of nodeIndices) {
      const object = this.tables.nodeByIndex[nodeIndex];
      if (!object) {
        continue;
      }
      const helper = new THREE.BoxHelper(object, 0xd9a441);
      this.scene.add(helper);
      this.referenceHighlightHelpers.push(helper);
    }
  }

  // ---------------------------------------------------------------------
  // Editor helpers (RH-032, RH-033 — full punctual-light control's shared
  // editor-overlay seam)
  // ---------------------------------------------------------------------

  /**
   * RH-032/RH-033: replaces the entire editor-helper set. Unknown `kind`s
   * and unresolvable `nodeIndex`es are silently skipped, never thrown —
   * same tolerance `setHighlight`/`attachGizmo` already establish for a
   * `nodeIndex` that doesn't (yet) exist in the currently loaded scene.
   * v1 only draws `"light"` (a `PointLightHelper`/`SpotLightHelper`/
   * `DirectionalLightHelper` per the live light's own current type,
   * `buildLightHelper`) — every other `kind` (e.g. a future
   * `"audio-emitter"`/`"audio-listener"`) is ignored today, forward-
   * compatible with `EditorHelperKind`'s own "open string union" design.
   */
  setEditorHelpers(descriptors: EditorHelperDescriptor[]): void {
    if (!this.scene || !this.editorHelperGroup) {
      throw new Error("RenderHost.setEditorHelpers: call mount() first");
    }
    this.disposeEditorHelpers();
    if (!this.tables) {
      return; // no scene loaded yet — nothing resolvable, same as setHighlight's own no-tables early return.
    }
    for (const descriptor of descriptors) {
      if (descriptor.kind !== "light") {
        continue;
      }
      const light = this.lightObjectForNode(descriptor.nodeIndex);
      if (!light) {
        continue;
      }
      const helper = buildLightHelper(light);
      if (!helper) {
        continue;
      }
      this.editorHelperGroup.add(helper);
      this.editorHelperObjects.set(`${descriptor.kind}:${descriptor.nodeIndex}`, helper);
    }
  }

  /**
   * Resolves `nodeIndex`'s own KHR_lights_punctual light object, if any.
   * GLTFLoader's node-building (`GLTFParser.getDependency('node', ...)`) IS
   * the light object itself when a light is the node's ONLY attachment (no
   * mesh/camera) — `objects.length === 1` short-circuits to `node =
   * objects[0]` rather than wrapping it in a `Group` — so `nodeByIndex`'s
   * entry for a pure light node already satisfies `isLight` directly; only
   * a node with MULTIPLE attachments (e.g. a light co-located with a mesh)
   * gets wrapped in a `Group`, with the light as one of its children.
   * Checked in that order (object itself, then its immediate children).
   */
  private lightObjectForNode(nodeIndex: number): THREE.Light | null {
    const object = this.tables?.nodeByIndex[nodeIndex];
    if (!object) {
      return null;
    }
    if ((object as THREE.Light).isLight) {
      return object as THREE.Light;
    }
    for (const child of object.children) {
      if ((child as THREE.Light).isLight) {
        return child as THREE.Light;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Studio lighting (specs/ux-viewport.md's studio-lighting section — not
  // part of the RenderHost interface, same "engine-three-only public
  // method" convention as setControlsEnabled/frameNode/getRendererStats).
  // ---------------------------------------------------------------------

  /**
   * Manually overrides the studio rig's strength for the CURRENTLY loaded
   * scene: `true` is full strength, `false` DIMS it to `STUDIO_DIM_FACTOR`
   * of full (never fully hidden — see the two studio-light fields' own doc
   * comment for why). Does not persist across the next `loadScene` call —
   * every `loadScene` recomputes the AUTO policy fresh
   * (`documentHasPunctualLights`) regardless of any override made here, a
   * deliberate v1 simplicity choice (see that call site's own comment): the
   * toolbar toggle is a per-scene, not per-document, override.
   */
  setStudioLightingEnabled(enabled: boolean): void {
    this.applyStudioLighting(enabled);
  }

  /** Current studio-rig strength state (AUTO-computed on load, or manually overridden since — see `setStudioLightingEnabled`): `true` means full strength, `false` means dimmed. `true` when nothing has mounted yet (matches the rig's own default-full state before any scene loads). */
  getStudioLightingEnabled(): boolean {
    return this.studioLightingFull;
  }

  // ---------------------------------------------------------------------
  // snapshot (RH-024, RH-034)
  // ---------------------------------------------------------------------

  /**
   * RH-034: editor-only helpers (RH-032) are excluded from the captured
   * image — cheap to do exactly right since they all live in one dedicated
   * `editorHelperGroup`: hide it for this one render call, restore
   * whatever visibility it had immediately after. (The grid/selection/hover/
   * reference-highlight helpers are NOT hidden here — a pre-existing,
   * separately-tracked gap this change doesn't newly introduce or widen,
   * see specs/render-host.md's own note on `snapshot()`.)
   */
  async snapshot(): Promise<Blob> {
    if (!this.renderer || !this.scene || !this.camera) {
      throw new Error("RenderHost.snapshot: call mount() first");
    }
    const helpersWereVisible = this.editorHelperGroup?.visible ?? false;
    if (this.editorHelperGroup) {
      this.editorHelperGroup.visible = false;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.editorHelperGroup) {
      this.editorHelperGroup.visible = helpersWereVisible;
    }
    const renderer = this.renderer;
    return await new Promise<Blob>((resolve, reject) => {
      renderer.domElement.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("RenderHost.snapshot: canvas.toBlob produced no data"));
        }
      }, "image/png");
    });
  }

  // ---------------------------------------------------------------------
  // Camera framing (not part of the RenderHost interface — see
  // specs/render-host.md's M2 DECISION note). Backs specs/ux-viewport.md's
  // UX-308 "Frame selected" toolbar control.
  // ---------------------------------------------------------------------

  /**
   * Test-only (not part of the RenderHost interface): true once a `loadScene`
   * call has resolved and stayed current (RH-008's "last writer wins" — a
   * superseded in-flight call never flips this). Callers that need to know
   * whether e.g. `attachGizmo`/`pick` will see real geometry yet — without
   * threading their own copy of `loadScene`'s promise around — can poll this
   * instead of guessing from `mount()` having been called.
   */
  isReady(): boolean {
    return this.tables !== null;
  }

  /** Frames `nodeIndex`'s bounding box, or the whole loaded scene when `nodeIndex` is null (UX-308, including its now-resolved no-selection case). */
  frameNode(nodeIndex: number | null): void {
    if (!this.camera || !this.modelRoot) {
      return;
    }
    const target = nodeIndex !== null ? this.tables?.nodeByIndex[nodeIndex] : undefined;
    frameCameraOnObject(this.camera, this.controls?.target, target ?? this.modelRoot);
    this.controls?.update();
  }

  // ---------------------------------------------------------------------
  // Test-only introspection (not part of the RenderHost interface).
  // ---------------------------------------------------------------------

  /** three.js-specific GPU-resource counters, for leak-discipline tests (RH-008) and a future viewport HUD. */
  getRendererStats(): RendererStats | null {
    return this.renderer ? { geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures } : null;
  }

  /** Test-only (not part of the RenderHost interface): the number of currently-shown editor helpers (RH-032) — lets e2e assert the light-helper toggle/selected-always behavior directly without a fragile pixel-level wireframe check. */
  getEditorHelperCount(): number {
    return this.editorHelperObjects.size;
  }

  /**
   * Test-only (see specs/render-host.md's M2 DECISION note): hit-tests NDC
   * coordinates against the currently-attached gizmo's OWN picker geometry
   * via TransformControls' own public `pointerHover` — the exact raycast it
   * runs on every real pointermove without a button held — and returns
   * whichever axis/plane it reports (e.g. "X", "XY"), or null if nothing is
   * attached or hit. A pure query: `pointerHover` never touches
   * `controls.enabled` (only a real `pointerdown` starting a drag does), so
   * calling this has no side effect on OrbitControls.
   *
   * Lets e2e (see e2e/viewport-gizmo-camera-lock.spec.ts) locate a real
   * gizmo handle's screen position deterministically instead of by
   * trial-and-error real drags — which matters here specifically because a
   * MISSED trial-and-error drag is a genuine OrbitControls orbit, and
   * OrbitControls' own `enableDamping` (see `mount()`) means its rotation
   * momentum outlives the gesture, decaying gradually over many subsequent
   * frames regardless of `controls.enabled` — polluting the camera pose a
   * LATER, successful attempt's "the camera did not move" assertion would
   * otherwise measure against.
   */
  hitTestGizmoHandle(ndcX: number, ndcY: number): string | null {
    if (!this.gizmo) return null;
    // @types/three's `TransformControls.pointerHover` signature is typed as
    // `(pointer: PointerEvent | null) => void`, but the real implementation
    // (TransformControls.js's own `_getPointer`) always normalizes the
    // native event to a plain `{x, y, button}` (NDC + button index) BEFORE
    // calling this public method — that plain shape, not a real
    // PointerEvent's properties, is genuinely all it reads. An upstream
    // typing gap, not a real type mismatch.
    (this.gizmo as unknown as { pointerHover(pointer: { x: number; y: number; button: number }): void }).pointerHover({
      x: ndcX,
      y: ndcY,
      button: -1
    });
    return this.gizmo.axis;
  }

  /**
   * Test-only (see specs/render-host.md's M2 DECISION note): simulates a
   * completed TransformControls drag gesture WITHOUT real pointer input —
   * moves the currently-attached gizmo's object by `delta` (world-space
   * translation) and re-fires the exact internal events a real drag would
   * (`objectChange` then `dragging-changed` with `value: false`), so
   * `onGizmoChange`'s real "drag"-then-"commit" emission (RH-003) runs
   * unmodified. Returns false (does nothing) if no gizmo is attached.
   */
  simulateGizmoDrag(delta: [number, number, number]): boolean {
    if (!this.gizmo?.object) {
      return false;
    }
    this.gizmo.object.position.x += delta[0];
    this.gizmo.object.position.y += delta[1];
    this.gizmo.object.position.z += delta[2];
    this.gizmo.dispatchEvent({ type: "objectChange" });
    this.gizmo.dispatchEvent({ type: "dragging-changed", value: false });
    return true;
  }
}

export function createThreeRenderHost(): ThreeRenderHost {
  return new ThreeRenderHost();
}
