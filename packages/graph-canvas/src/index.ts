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
// M7: shared rendering internals exported for @gltf-studio/audio-canvas's
// reuse (specs/ux-audio-graph.md UX-600 — "the identical engine ... a
// separate canvas instance ..., never a different rendering
// implementation") rather than a duplicate React Flow/ELK canvas. Not
// previously exported because the only consumer was graph-canvas.tsx
// itself, in the same package.
export { GraphView, type GraphViewProps, type GraphCanvasTestHook } from "./graph-view.js";
export { NodeDetails, type NodeDetailsProps } from "./node-details.js";
// Task ("in the node graph there is no way to edit variables" / "typed
// literal editors incl. color pickers"): the new Variables panel + the
// shared typed-literal/color-field editors it (and op-node.tsx/node-details.tsx)
// build on — exported for @gltf-studio/app's own reuse of `ColorField`
// (`MaterialSection.tsx`'s Base Color picker, per that task's "extract/share
// it rather than duplicate" instruction).
export { VariablesPanel, type VariablesPanelProps } from "./variables-panel.js";
export { TypedLiteralEditor, EDITABLE_LITERAL_TYPES, VECTOR_COMPONENT_COUNTS, type TypedLiteralEditorProps, type LiteralValue } from "./literal-editors.js";
export { ColorField, colorKindForPointerPath, hexToRgb01, rgb01ToHex, useNumericFallbackToggle, type ColorFieldProps, type ColorKind } from "./color-field.js";
