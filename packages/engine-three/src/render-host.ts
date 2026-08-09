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
  GizmoChangeEvent,
  GizmoChangePhase,
  GizmoMode,
  JsonPatchOp,
  PatchOutcome,
  PickResult,
  RenderHost,
  TRS
} from "@gltf-studio/engine-api";
import { disposeObject3D } from "./dispose-object3d.js";
import { frameCameraOnObject } from "./frame-camera.js";
import { classifyPatchBatch } from "./patch-classify.js";
import { coercePointerValue } from "./pointer-value.js";
import { toGlbArrayBuffer } from "./scene-input.js";

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
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x30323a, 1.1);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.2);
    directionalLight.position.set(3, 6, 4);
    const grid = new THREE.GridHelper(10, 10);
    scene.add(hemisphereLight, directionalLight, grid);

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
    this.gizmo?.detach();
    this.gizmoNodeIndex = null;

    this.modelRoot = gltf.scene;
    this.scene.add(this.modelRoot);
    frameCameraOnObject(this.camera, this.controls?.target, this.modelRoot);
    this.controls?.update();

    this.tables = loadedTables ?? buildIndexTables(gltf.parser, gltf.scene);
    this.diagnostics = new DiagnosticsRecorder();
    this.currentJson = gltf.parser.json;
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
    if (patch.op !== "replace" && patch.op !== "add") {
      return; // no live three.js-side effect for remove/move/copy/test in the non-structural branch.
    }
    if (!this.tables || !this.diagnostics) {
      return;
    }
    const value = coercePointerValue(patch.value, `RenderHost.patchScene(${patch.path})`);
    applyPointerToTables(this.tables, patch.path, value, this.diagnostics);
  }

  // ---------------------------------------------------------------------
  // pick (RH-015)
  // ---------------------------------------------------------------------

  pick(x: number, y: number): PickResult | null {
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
          if (isEffectivelyVisible(current) && state.selectable) {
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
      throw new Error(`RenderHost.attachGizmo: no node at index ${nodeIndex}`);
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
    if (!this.tables) {
      return;
    }
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

  // ---------------------------------------------------------------------
  // snapshot (RH-024)
  // ---------------------------------------------------------------------

  async snapshot(): Promise<Blob> {
    if (!this.renderer || !this.scene || !this.camera) {
      throw new Error("RenderHost.snapshot: call mount() first");
    }
    this.renderer.render(this.scene, this.camera);
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
  // Test-only introspection (not part of the RenderHost interface).
  // ---------------------------------------------------------------------

  /** three.js-specific GPU-resource counters, for leak-discipline tests (RH-008) and a future viewport HUD. */
  getRendererStats(): RendererStats | null {
    return this.renderer ? { geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures } : null;
  }
}

export function createThreeRenderHost(): ThreeRenderHost {
  return new ThreeRenderHost();
}
