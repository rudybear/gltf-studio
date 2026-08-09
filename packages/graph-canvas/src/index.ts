// Public API of @gltf-studio/graph-canvas (specs/ux-graph-canvas.md).
export { GraphCanvas, type GraphCanvasProps } from "./graph-canvas.js";
export {
  mapGraph,
  CATEGORY_TOKENS,
  type MappedGraph,
  type MappedNode,
  type MappedEdge,
  type MappedPort,
  type MappedLiteral,
  type PortKind,
  type InteractivityGraph,
  type InteractivityNode,
  type InteractivityDeclaration,
  type InteractivityVariable,
  type InteractivityEvent,
  type GraphNodeValue,
  type GraphValueRef,
  type GraphValueLiteral,
  type GraphFlowRef,
  type JsonScalar
} from "./map-graph.js";
export { categoryColor, typeColor, CATEGORY_COLORS } from "./palette.js";
export { validateInteractivityGraph, type ValidationResult, type GraphDiagnostic, type DiagnosticSource } from "./validation.js";
export { validateConnection, type ConnectionValidation } from "./validate-connection.js";
export { ensureTypeIndex, setLiteralValue, setPointerConfig } from "./graph-edit-ext.js";
export { ensureGraphScaffold, type EnsureGraphResult } from "./ensure-graph.js";
export { SCENE_NODE_DRAG_MIME, ANIM_CLIP_DRAG_MIME } from "./graph-view.js";
export { type DropKind } from "./drop-menu.js";
