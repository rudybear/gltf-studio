// GraphEdit command factories: addNode, removeNode, connectFlow,
// connectValue, disconnect, setLiteral, setNodePosition, addVariable,
// addCustomEvent, ensureDeclaration. Every factory reads the CURRENT
// `EditorDocument.json` to compute exact forward + inverse RFC-6902 patches
// (DOC-007, DOC-008) against one `extensions.KHR_interactivity.graphs[graphIndex]`.
//
// Reuses `@gltfi/ir`'s plain-JSON `Graph`/`GraphNode` shapes (the same
// vocabulary `@gltfi/ir`'s importer consumes) rather than redefining the
// KHR_interactivity graph schema a second time.
import type { Graph, GraphNode, GraphNodeValue } from "@gltfi/ir";
import type { Command } from "./command.js";
import { combineCommandParts, makeCommandId } from "./command.js";
import { appendFragment, deletePathFragment, setPathFragment, type PatchPair } from "./edit-fragments.js";
import { fixupReferences } from "./fixup-references.js";
import { formatPointer, getIn } from "./json-pointer.js";
import { applyPatches } from "./patch.js";
import type { EditorDocument } from "./document.js";

function graphPath(graphIndex: number): (string | number)[] {
  return ["extensions", "KHR_interactivity", "graphs", graphIndex];
}

function getGraph(json: unknown, graphIndex: number): Graph {
  const graph = getIn(json, graphPath(graphIndex).map(String)) as Graph | undefined;
  if (!graph) {
    throw new Error(`No KHR_interactivity graph at index ${graphIndex}.`);
  }
  return graph;
}

export const GraphEdit = {
  /**
   * DOC-021: `ensureDeclaration` — find-or-append a `{ op }` declaration into
   * `graph.declarations`, shared by every factory (e.g. `addNode`) that
   * needs a declaration index for a given op string. Returns a no-op
   * `Command` (empty `patches`/`inverse`) when the declaration already
   * exists, alongside its index.
   */
  ensureDeclaration(document: EditorDocument, graphIndex: number, op: string, extension?: string): { command: Command; index: number } {
    const { fragment, index } = ensureDeclarationFragment(document.json, graphIndex, op, extension);
    return {
      index,
      command: {
        id: makeCommandId("ensure-declaration"),
        label: `Ensure declaration "${op}"`,
        patches: fragment.patches,
        inverse: fragment.inverse
      }
    };
  },

  /** DOC-027 (position), DOC-021 (via `ensureDeclaration`): appends a new graph node, declaring `op` first if needed. */
  addNode(
    document: EditorDocument,
    graphIndex: number,
    op: string,
    opts: {
      extension?: string;
      configuration?: GraphNode["configuration"];
      values?: Record<string, GraphNodeValue>;
      flows?: GraphNode["flows"];
      position?: { x: number; y: number };
    } = {}
  ): Command {
    const { fragment: declFragment, index: declarationIndex } = ensureDeclarationFragment(document.json, graphIndex, op, opts.extension);
    const node: GraphNode = { declaration: declarationIndex };
    if (opts.configuration) node.configuration = opts.configuration;
    if (opts.values) node.values = opts.values;
    if (opts.flows) node.flows = opts.flows;
    const nodeWithExtras: GraphNode & { extras?: { gltfi: { x: number; y: number } } } = opts.position
      ? { ...node, extras: { gltfi: { x: opts.position.x, y: opts.position.y } } }
      : node;

    const jsonAfterDecl = declFragment.patches.length > 0 ? applyPatches(document.json, declFragment.patches) : document.json;
    const nodesArrayPath = [...graphPath(graphIndex), "nodes"];
    const addFragment = appendFragment(jsonAfterDecl, nodesArrayPath, nodeWithExtras);

    const combined = combineCommandParts([declFragment, addFragment]);
    return {
      id: makeCommandId("add-node"),
      label: `Add node "${op}"`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /**
   * DOC-019/DOC-021: removes a graph node and fixes up every other node's
   * `values`/`flows` reference into the shifted index range via the shared
   * `fixupReferences` helper.
   */
  removeNode(document: EditorDocument, graphIndex: number, nodeIndex: number): Command {
    const graph = getGraph(document.json, graphIndex);
    const removedNode = graph.nodes[nodeIndex];
    if (removedNode === undefined) {
      throw new Error(`No graph node at index ${nodeIndex} in graph ${graphIndex}.`);
    }
    const nodePath = [...graphPath(graphIndex), "nodes", nodeIndex];
    const removeFragment: PatchPair = {
      patches: [{ op: "remove", path: formatPointer(nodePath) }],
      inverse: [{ op: "add", path: formatPointer(nodePath), value: removedNode }]
    };
    const fixup = fixupReferences(document.json, nodeIndex, [{ kind: "graphNodeRef", graphPath: graphPath(graphIndex) }]);

    // Fixups MUST run before the remove op — see fixupReferences' "ORDERING
    // REQUIREMENT" doc comment: fixup patch paths address surviving siblings
    // by their pre-removal index.
    const combined = combineCommandParts([fixup, removeFragment]);
    return {
      id: makeCommandId("remove-node"),
      label: `Remove node ${nodeIndex}`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /** Wires `nodes[fromNode].flows[fromSocket] -> { node: toNode, socket: toSocket }`. */
  connectFlow(document: EditorDocument, graphIndex: number, fromNode: number, fromSocket: string, toNode: number, toSocket: string): Command {
    const path = [...graphPath(graphIndex), "nodes", fromNode, "flows", fromSocket];
    const fragment = setPathFragment(document.json, path, { node: toNode, socket: toSocket });
    return {
      id: makeCommandId("connect-flow"),
      label: `Connect flow ${fromNode}.${fromSocket} -> ${toNode}.${toSocket}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** Wires `nodes[nodeIndex].values[socket] -> { node: sourceNode, socket?: sourceSocket }`. */
  connectValue(document: EditorDocument, graphIndex: number, nodeIndex: number, socket: string, sourceNode: number, sourceSocket?: string): Command {
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, "values", socket];
    const value: GraphNodeValue = sourceSocket === undefined ? { node: sourceNode } : { node: sourceNode, socket: sourceSocket };
    const fragment = setPathFragment(document.json, path, value);
    return {
      id: makeCommandId("connect-value"),
      label: `Connect value ${nodeIndex}.${socket} -> ${sourceNode}${sourceSocket ? "." + sourceSocket : ""}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** Removes whatever is wired into `nodes[nodeIndex].{values|flows}[socket]`. */
  disconnect(document: EditorDocument, graphIndex: number, nodeIndex: number, socket: string, kind: "value" | "flow"): Command {
    const socketMapName = kind === "value" ? "values" : "flows";
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, socketMapName, socket];
    const fragment = deletePathFragment(document.json, path);
    return {
      id: makeCommandId("disconnect"),
      label: `Disconnect ${kind} ${nodeIndex}.${socket}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** Sets `nodes[nodeIndex].values[socket]` to a literal `{ type, value }` (overwriting any wired connection). */
  setLiteral(document: EditorDocument, graphIndex: number, nodeIndex: number, socket: string, literal: { type: number; value: Array<number | boolean | string> }): Command {
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, "values", socket];
    const fragment = setPathFragment(document.json, path, literal);
    return {
      id: makeCommandId("set-literal"),
      label: `Set literal ${nodeIndex}.${socket}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** DOC-027: sets the canvas position of a graph node, stored at `node.extras.gltfi.{x,y}`. */
  setNodePosition(document: EditorDocument, graphIndex: number, nodeIndex: number, x: number, y: number): Command {
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, "extras", "gltfi"];
    const fragment = setPathFragment(document.json, path, { x, y });
    return {
      id: makeCommandId("set-node-position"),
      label: `Move node ${nodeIndex}`,
      coalesceKey: `node-position:${graphIndex}:${nodeIndex}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** Appends a variable to `graph.variables`. */
  addVariable(document: EditorDocument, graphIndex: number, variable: NonNullable<Graph["variables"]>[number]): Command {
    const arrayPath = [...graphPath(graphIndex), "variables"];
    const fragment = appendFragment(document.json, arrayPath, variable);
    return {
      id: makeCommandId("add-variable"),
      label: `Add variable${variable.id ? ` "${variable.id}"` : ""}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /** Appends a custom event to `graph.events`. */
  addCustomEvent(document: EditorDocument, graphIndex: number, event: NonNullable<Graph["events"]>[number]): Command {
    const arrayPath = [...graphPath(graphIndex), "events"];
    const fragment = appendFragment(document.json, arrayPath, event);
    return {
      id: makeCommandId("add-custom-event"),
      label: `Add custom event${event.id ? ` "${event.id}"` : ""}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * DOC-044: sets `nodes[nodeIndex].configuration[field]` to `{ value }`
   * (overwriting whatever was there, adding the field if it wasn't) — a
   * generic, single-field primitive `addNode`'s create-time shape doesn't
   * cover: retargeting an existing pointer node's `pointer`/`type` fields
   * (M4's pointer-picker dialog, `specs/ux-pointer-picker.md`'s `UX-906`),
   * switching a `variable/get|set`/`event/send|receive` node's referenced
   * declaration, or editing any other op's config field the M4 config-field
   * editor doesn't have a dedicated command for (the generic key/value
   * fallback). Mirrors `setLiteral`'s shape for `values` but for
   * `configuration` instead.
   */
  setNodeConfig(document: EditorDocument, graphIndex: number, nodeIndex: number, field: string, value: Array<number | boolean | string>): Command {
    const path = [...graphPath(graphIndex), "nodes", nodeIndex, "configuration", field];
    const fragment = setPathFragment(document.json, path, { value });
    return {
      id: makeCommandId("set-node-config"),
      label: `Set ${field} config on node ${nodeIndex}`,
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * DOC-041: find-or-scaffolds `extensions.KHR_interactivity.graphs[graphIndex]`
   * as a single command (empty `types`/`declarations`/`variables`/`events`/
   * `nodes` arrays, plus the extension's `graph` pointer and an
   * `extensionsUsed` entry when either is missing) — a no-op command when the
   * graph already exists. Every other `GraphEdit` factory (`addNode`, etc.)
   * assumes its target graph already exists (`getGraph` throws otherwise);
   * this is the one factory a caller uses FIRST when it can't assume that —
   * e.g. the Inspector's `◈` pointer-shortcut "Add pointer/…" actions
   * (`specs/ux-inspector.md`'s `UX-412`) against a freshly-imported asset
   * with no `KHR_interactivity` extension at all yet.
   */
  ensureGraph(document: EditorDocument, graphIndex = 0): Command {
    const existingExtension = getIn(document.json, ["extensions", "KHR_interactivity"]) as
      | { graph?: number; graphs?: Graph[] }
      | undefined;
    const existingGraphs = existingExtension?.graphs ?? [];
    if (existingGraphs[graphIndex] !== undefined) {
      return { id: makeCommandId("ensure-graph"), label: "Ensure interactivity graph", patches: [], inverse: [] };
    }

    const graphs = existingGraphs.slice();
    while (graphs.length <= graphIndex) {
      graphs.push({ types: [], declarations: [], variables: [], events: [], nodes: [] });
    }
    const newExtension = { graph: existingExtension?.graph ?? graphIndex, graphs };
    const extFragment = setPathFragment(document.json, ["extensions", "KHR_interactivity"], newExtension);

    const extensionsUsed = (getIn(document.json, ["extensionsUsed"]) as string[] | undefined) ?? [];
    const usedFragment: PatchPair = extensionsUsed.includes("KHR_interactivity")
      ? { patches: [], inverse: [] }
      : appendFragment(document.json, ["extensionsUsed"], "KHR_interactivity");

    const combined = combineCommandParts([usedFragment, extFragment]);
    return {
      id: makeCommandId("ensure-graph"),
      label: "Ensure interactivity graph",
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /**
   * DOC-042: `ensureDeclaration`'s (DOC-021) counterpart for `graph.types` —
   * find-or-appends a `{ signature }` entry (e.g. `"float3"`, `"float4"`),
   * returning its index. Used by callers that must fill in a node's
   * `configuration.type` (a `graph.types` index) without duplicating an
   * already-declared signature — e.g. `addPointerNode` below.
   */
  ensureType(document: EditorDocument, graphIndex: number, signature: string): { command: Command; index: number } {
    const { fragment, index } = ensureTypeFragment(document.json, graphIndex, signature);
    return {
      index,
      command: {
        id: makeCommandId("ensure-type"),
        label: `Ensure type "${signature}"`,
        patches: fragment.patches,
        inverse: fragment.inverse
      }
    };
  },

  /**
   * DOC-043: replaces `extensions.KHR_interactivity.graphs[graphIndex]`
   * wholesale with `newGraph`, as a single `replace` patch (the graph must
   * already exist — same precondition as every other factory in this file
   * except `ensureGraph`; use that first if it might not). The inverse is
   * the exact prior graph value, so undo restores it byte-for-byte
   * (DOC-008). Used by `specs/ux-script.md`'s `UX-711` Script-tab "Apply ->
   * Graph" action to swap in a freshly `parseModule`d + `exportGraph`d
   * script as one history entry, rather than diffing node-by-node against
   * the prior graph.
   */
  replaceGraph(document: EditorDocument, graphIndex: number, newGraph: Graph): Command {
    // Read-before-write via getGraph (not setPathFragment's own existing-value
    // probe) so a missing graph fails fast with this file's usual "No
    // KHR_interactivity graph at index N" message rather than setPathFragment's
    // generic "create missing ancestors" add-path behavior.
    getGraph(document.json, graphIndex);
    const fragment = setPathFragment(document.json, graphPath(graphIndex), newGraph);
    return {
      id: makeCommandId("replace-graph"),
      label: "Apply script",
      patches: fragment.patches,
      inverse: fragment.inverse
    };
  },

  /**
   * `specs/ux-inspector.md`'s `UX-411`/`UX-412` (`set`/`interpolate`) and
   * `specs/ux-graph-canvas.md`'s `UX-508` scene-tree-row drag-drop (`get`,
   * added for M4's drop-menu, which offers `pointer/get` alongside
   * `set`/`interpolate`): builds a `pointer/get`, `pointer/set`, or
   * `pointer/interpolate` node targeting `pointerPath`, as ONE combined
   * command — scaffolding the graph (`ensureGraph`, DOC-041) and the value's
   * `types` entry (`ensureType`, DOC-042) first if either is missing, then
   * `addNode` itself — so the whole thing is one undo/redo step regardless of
   * how many of those three sub-steps actually had anything to do.
   */
  addPointerNode(
    document: EditorDocument,
    graphIndex: number,
    kind: "get" | "set" | "interpolate",
    pointerPath: string,
    signature: string,
    position?: { x: number; y: number }
  ): Command {
    const op = kind === "get" ? "pointer/get" : kind === "set" ? "pointer/set" : "pointer/interpolate";

    const ensureGraphCmd = GraphEdit.ensureGraph(document, graphIndex);
    const jsonAfterGraph = ensureGraphCmd.patches.length > 0 ? applyPatches(document.json, ensureGraphCmd.patches) : document.json;
    const docAfterGraph: EditorDocument = { ...document, json: jsonAfterGraph };

    const { command: ensureTypeCmd, index: typeIndex } = GraphEdit.ensureType(docAfterGraph, graphIndex, signature);
    const jsonAfterType = ensureTypeCmd.patches.length > 0 ? applyPatches(jsonAfterGraph, ensureTypeCmd.patches) : jsonAfterGraph;
    const docAfterType: EditorDocument = { ...document, json: jsonAfterType };

    const addCmd = GraphEdit.addNode(docAfterType, graphIndex, op, {
      configuration: { pointer: { value: [pointerPath] }, type: { value: [typeIndex] } },
      ...(position ? { position } : {})
    });

    const combined = combineCommandParts([ensureGraphCmd, ensureTypeCmd, addCmd]);
    return {
      id: makeCommandId("add-pointer-node"),
      label: `Add ${op} for ${pointerPath}`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  }
};

function ensureDeclarationFragment(json: unknown, graphIndex: number, op: string, extension?: string): { fragment: PatchPair; index: number } {
  const graph = getGraph(json, graphIndex);
  const declarations = graph.declarations ?? [];
  const existingIndex = declarations.findIndex(
    (decl) => decl.op === op && (decl as { extension?: string }).extension === extension
  );
  if (existingIndex !== -1) {
    return { fragment: { patches: [], inverse: [] }, index: existingIndex };
  }
  const declaration = extension === undefined ? { op } : { op, extension };
  const arrayPath = [...graphPath(graphIndex), "declarations"];
  const fragment = appendFragment(json, arrayPath, declaration);
  return { fragment, index: fragment.index };
}

function ensureTypeFragment(json: unknown, graphIndex: number, signature: string): { fragment: PatchPair; index: number } {
  const graph = getGraph(json, graphIndex);
  const types = graph.types ?? [];
  const existingIndex = types.findIndex((t) => t.signature === signature);
  if (existingIndex !== -1) {
    return { fragment: { patches: [], inverse: [] }, index: existingIndex };
  }
  const arrayPath = [...graphPath(graphIndex), "types"];
  const fragment = appendFragment(json, arrayPath, { signature });
  return { fragment, index: fragment.index };
}
