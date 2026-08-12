import type { DockTab, RightTab } from "../store/app-store";

/**
 * specs/ux-tour.md UX-1206: a step's optional pre-action switches the
 * bottom-dock and/or right-panel tab BEFORE the engine measures the step's
 * anchor, so an anchor that lives inside a currently-hidden tab (e.g. the
 * Behavior graph canvas, the Script tab) becomes real, positioned DOM
 * before the spotlight/card try to read its `getBoundingClientRect()`. Kept
 * as plain data (which tab, not a function) rather than an imperative
 * callback so `e2e/tour.spec.ts` can assert on it declaratively too (e.g.
 * "after advancing to this step, `dock.tab.script` carries the active
 * class") instead of only trusting that the engine ran *something*.
 */
export interface TourStepPreAction {
  dockTab?: DockTab;
  rightTab?: RightTab;
}

/**
 * specs/ux-tour.md UX-1205: one step = one real `data-testid` anchor (or
 * `null` for a centered, spotlight-free card — used here as the engine's
 * defensive fallback for an anchor that still can't be found after
 * `UX-1207`'s retry window, not exercised by any of the 14 steps below,
 * every one of which anchors on a real, always-derivable element).
 */
export interface TourStep {
  id: string;
  anchorTestId: string | null;
  title: string;
  body: string;
  preAction?: TourStepPreAction;
}

/**
 * The 14-step golden-path tour (specs/ux-tour.md UX-1205): single source of
 * truth for both `TourOverlay`'s runtime rendering and `e2e/tour.spec.ts`'s
 * per-step anchor/preAction assertions — the step content itself is data,
 * not spec prose (specs/ux-tour.md deliberately does not duplicate any of
 * the text below).
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    anchorTestId: "topbar.app-name",
    title: "Welcome to gltf-studio",
    body: "This short tour walks through the scene tree, viewport, inspector, and behavior graph, using the top bar as your home base. Click Next to begin, or Skip to explore on your own."
  },
  {
    id: "starter-gallery",
    anchorTestId: "viewport.gallery",
    title: "Two ways to start",
    body: "Load Empty scene to start from scratch and use + Add to build, or Racer — a complete racing game authored as TypeScript, compiled into the asset; click the pads to steer. Click a card to load one, or continue the tour without loading anything."
  },
  {
    id: "import",
    anchorTestId: "topbar.import",
    title: "Import your own files",
    body: "Import brings in your own glTF or GLB files — select multiple files, or drop a whole folder including textures and audio, and gltf-studio packs them into one self-contained scene."
  },
  {
    id: "scene-tree",
    anchorTestId: "scene-tree.list",
    title: "The scene tree",
    body: "Click any row to select that node, use +Add to create meshes, lights, cameras, or groups, and right-click a row to rename or delete it. The # toggle shows node indices for cross-referencing with the behavior graph."
  },
  {
    id: "viewport",
    anchorTestId: "viewport.panel",
    title: "The viewport",
    body: "Orbit with the mouse and click any object to select it; press W, E, or R to switch the gizmo between move, rotate, and scale. The camera stays locked while you drag a gizmo, and the frame button re-centers on your selection."
  },
  {
    id: "inspector",
    anchorTestId: "inspector.panel",
    title: "The inspector",
    body: "The identity strip shows the node's type and glTF pointer — click to copy it — above transform, mesh, and material sections you can edit directly. The ◈ icon next to a property jumps into the graph or script, and Used-in-behavior lists every place that references this node.",
    preAction: { rightTab: "inspector" }
  },
  {
    id: "behavior-graph",
    anchorTestId: "graph.panel",
    title: "Behavior graph",
    body: "Drag operations from the palette onto the canvas and connect their sockets to wire up behavior; the pointer icon on a node opens a picker to retarget it anywhere in the scene. Badges on a node flag validation errors or warnings.",
    preAction: { dockTab: "graph" }
  },
  {
    id: "script",
    anchorTestId: "script.tab-wrap",
    title: "Script",
    body: "Script shows the same behavior as real GI Script code — edit it and click Apply to compile your changes back into the graph. The EQUIV badge confirms the graph and script are still in sync.",
    preAction: { dockTab: "script" }
  },
  {
    id: "audio-graph",
    anchorTestId: "audio-graph.panel",
    title: "Audio graph",
    body: "The audio graph visualizes your scene's KHR_audio_graph routing — emitters, effects, and outputs. It's a read-only view today; editing is on the roadmap.",
    preAction: { dockTab: "audio-graph" }
  },
  {
    id: "data",
    anchorTestId: "data.panel",
    title: "Data",
    body: "Data is a raw, read-only view of the underlying glTF JSON — use the breadcrumb to drill into any object by its pointer path. It's the fastest way to confirm exactly what will be exported.",
    preAction: { dockTab: "data" }
  },
  {
    id: "play-bar",
    anchorTestId: "playbar.panel",
    title: "Play mode",
    body: "Play runs your scene live using either the interpreter or a compiled engine — pick one with the engine selector next to Play."
  },
  {
    id: "copilot",
    anchorTestId: "copilot.panel",
    title: "Copilot",
    body: "Add context chips for your selection, a graph node, or an asset, then describe what you want in plain language. The current mock understands scene edits, simple behavior wiring, and basic asset generation, and shows validation before you accept a proposal.",
    preAction: { rightTab: "copilot" }
  },
  {
    id: "export",
    anchorTestId: "topbar.export",
    title: "Export",
    body: "Export packages your scene back into a byte-preserving GLB or glTF, leaving anything you haven't touched exactly as it was. Download it and use it anywhere glTF is supported."
  },
  {
    id: "done",
    anchorTestId: "topbar.tour-start",
    title: "That's the tour",
    body: "Relaunch it anytime from the tour button in the top bar. Now go build something."
  }
];
