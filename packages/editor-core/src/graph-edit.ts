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

/**
 * Thrown by `GraphEdit.removeVariable` when the variable is still referenced
 * by at least one `variable/get`/`variable/set`/`variable/interpolate` node
 * (DOC-055's resolved policy: block, don't dangle — a variable index that no
 * longer resolves breaks `@gltfi/verify`'s structural validation harder than
 * a dangling scene-node/graph-node reference does, since every consumer of
 * `variables[]` assumes every declared index is populated). Carries
 * `usageCount` (distinct REFERENCING NODES, not distinct slots — a single
 * `variable/set` referencing the same variable in two array slots still
 * counts as one node) so a caller (the Variables panel) can surface an exact
 * "used by N node(s)" toast rather than a bare rejection.
 */
export class VariableInUseError extends Error {
  readonly variableIndex: number;
  readonly usageCount: number;
  constructor(variableIndex: number, usageCount: number, id?: string) {
    super(`Variable ${id ? `"${id}"` : `#${variableIndex}`} is used by ${usageCount} node${usageCount === 1 ? "" : "s"} — remove those references before deleting it.`);
    this.name = "VariableInUseError";
    this.variableIndex = variableIndex;
    this.usageCount = usageCount;
  }
}

/** `GraphEdit.removeCustomEvent`'s counterpart to `VariableInUseError` above — same block-don't-dangle policy, for `event/send`/`event/receive` references into `graph.events`. */
export class CustomEventInUseError extends Error {
  readonly eventIndex: number;
  readonly usageCount: number;
  constructor(eventIndex: number, usageCount: number, id?: string) {
    super(`Event ${id ? `"${id}"` : `#${eventIndex}`} is used by ${usageCount} node${usageCount === 1 ? "" : "s"} — remove those references before deleting it.`);
    this.name = "CustomEventInUseError";
    this.eventIndex = eventIndex;
    this.usageCount = usageCount;
  }
}

const VARIABLE_SCALAR_OPS = new Set(["variable/get", "variable/interpolate"]);
const VARIABLE_ARRAY_OP = "variable/set";
const EVENT_OPS = new Set(["event/send", "event/receive"]);

function declOp(declarations: Graph["declarations"], node: GraphNode): string | undefined {
  return declarations[node.declaration]?.op;
}

/** Per-node component count used to resize a variable's `value` array on `setVariableType` (DOC-055) — mirrors `packages/graph-canvas`'s `defaultLiteralFor`'s own type/shape table (that one builds a FRESH default; this one only needs the SLOT COUNT to truncate/pad an EXISTING value). Unknown/matrix signatures fall back to 1 rather than throwing — a variable's declared type is free-form KHR_interactivity text, not restricted to this editor's own picker vocabulary. */
function componentCountForSignature(signature: string): number {
  switch (signature) {
    case "float2":
    case "float2x2":
      return signature === "float2x2" ? 4 : 2;
    case "float3":
      return 3;
    case "float3x3":
      return 9;
    case "float4":
      return 4;
    case "float4x4":
      return 16;
    default:
      return 1; // bool, int, float, ref, and anything this table doesn't special-case.
  }
}

/** Coerces one component to the JS type `signature`'s own slots must hold: `bool` -> `boolean` (via `Boolean`, e.g. a leftover numeric `1` from a prior float type becomes `true`, `0` becomes `false`), everything else -> `number` (via `Number`, falling back to `0` for a non-numeric leftover, e.g. a leftover `boolean` from a prior `bool` type). */
function coerceComponent(v: number | boolean | string, signature: string): number | boolean | string {
  if (signature === "bool") return Boolean(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Resizes `value` to `componentCountForSignature(signature)` slots: truncates extra components, pads missing ones with `false` (bool) or `0` (everything else) — never invents a truthy/nonzero default — and coerces every KEPT component to the new signature's own JS type (`coerceComponent`), so e.g. retyping `float3` `[1, 0, 0]` to `bool` yields `[true]`, not a leftover numeric `[1]` a `bool`-typed variable can never validly carry. */
function resizeVariableValue(value: Array<number | boolean | string>, signature: string): Array<number | boolean | string> {
  const count = componentCountForSignature(signature);
  const padValue: number | boolean = signature === "bool" ? false : 0;
  const coerced = value.map((v) => coerceComponent(v, signature));
  if (coerced.length === count) return coerced;
  if (coerced.length > count) return coerced.slice(0, count);
  return [...coerced, ...Array.from({ length: count - coerced.length }, () => padValue)];
}

/**
 * Counts graph nodes that reference `variableIndex` via `variable/get`'s or
 * `variable/interpolate`'s scalar `configuration.variable`, or
 * `variable/set`'s array `configuration.variables` (any slot) — one count
 * per REFERENCING NODE (DOC-055), not per slot.
 */
export function countVariableUsage(graph: Graph, variableIndex: number): number {
  const declarations = graph.declarations ?? [];
  let count = 0;
  for (const node of graph.nodes) {
    const op = declOp(declarations, node);
    if (!op) continue;
    if (VARIABLE_SCALAR_OPS.has(op)) {
      if (node.configuration?.variable?.value?.[0] === variableIndex) count += 1;
    } else if (op === VARIABLE_ARRAY_OP) {
      const arr = node.configuration?.variables?.value;
      if (Array.isArray(arr) && arr.includes(variableIndex)) count += 1;
    }
  }
  return count;
}

/** `event/send`/`event/receive`'s counterpart to `countVariableUsage` above — their single `configuration.event` scalar field is the only reference shape events have (no `variable/set`-shaped array case). */
export function countEventUsage(graph: Graph, eventIndex: number): number {
  const declarations = graph.declarations ?? [];
  let count = 0;
  for (const node of graph.nodes) {
    const op = declOp(declarations, node);
    if (op && EVENT_OPS.has(op) && node.configuration?.event?.value?.[0] === eventIndex) count += 1;
  }
  return count;
}

/**
 * DOC-055: called ONLY after `countVariableUsage`/`countEventUsage` has
 * already confirmed zero remaining references to `removedIndex` itself (a
 * blocked-delete precondition, not re-checked here) — so this only ever
 * needs to SHIFT indices strictly greater than `removedIndex` down by one to
 * account for the array shrinking; nothing is ever dangling by the time this
 * runs. Returns the whole rewritten `nodes` array (a single `replace` patch
 * covers every changed node, mirroring `fixup-references.ts`'s own
 * whole-array-`replace` shape for `indexArray`) plus whether anything
 * actually changed (an all-below-removedIndex graph needs no patch at all).
 */
function shiftVariableRefsInNodes(nodes: GraphNode[], declarations: Graph["declarations"], removedIndex: number): { nodes: GraphNode[]; changed: boolean } {
  let changed = false;
  const next = nodes.map((node) => {
    const op = declOp(declarations, node);
    if (!op) return node;
    if (VARIABLE_SCALAR_OPS.has(op)) {
      const cfg = node.configuration?.variable;
      const raw = cfg?.value?.[0];
      if (typeof raw === "number" && raw > removedIndex) {
        changed = true;
        return { ...node, configuration: { ...node.configuration, variable: { value: [raw - 1] } } };
      }
    } else if (op === VARIABLE_ARRAY_OP) {
      const cfg = node.configuration?.variables;
      const arr = cfg?.value;
      if (Array.isArray(arr) && arr.some((v) => typeof v === "number" && v > removedIndex)) {
        changed = true;
        const nextArr = arr.map((v) => (typeof v === "number" && v > removedIndex ? v - 1 : v));
        return { ...node, configuration: { ...node.configuration, variables: { value: nextArr } } };
      }
    }
    return node;
  });
  return { nodes: next, changed };
}

/** `removeCustomEvent`'s counterpart to `shiftVariableRefsInNodes` above, for `event/send`/`event/receive`'s scalar `configuration.event` field. */
function shiftEventRefsInNodes(nodes: GraphNode[], declarations: Graph["declarations"], removedIndex: number): { nodes: GraphNode[]; changed: boolean } {
  let changed = false;
  const next = nodes.map((node) => {
    const op = declOp(declarations, node);
    if (!op || !EVENT_OPS.has(op)) return node;
    const cfg = node.configuration?.event;
    const raw = cfg?.value?.[0];
    if (typeof raw === "number" && raw > removedIndex) {
      changed = true;
      return { ...node, configuration: { ...node.configuration, event: { value: [raw - 1] } } };
    }
    return node;
  });
  return { nodes: next, changed };
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

  /** DOC-055: renames `variables[variableIndex].id` — every `variable/get|set|interpolate` reference is BY INDEX (never by id), so this alone re-labels every one of that variable's referencing nodes' resolved-name subtitle (map-graph.ts's `nodeSubtitle`) without touching a single node. */
  renameVariable(document: EditorDocument, graphIndex: number, variableIndex: number, id: string): Command {
    const graph = getGraph(document.json, graphIndex);
    if (!graph.variables?.[variableIndex]) {
      throw new Error(`No variable at index ${variableIndex} in graph ${graphIndex}.`);
    }
    const path = [...graphPath(graphIndex), "variables", variableIndex, "id"];
    const fragment = setPathFragment(document.json, path, id);
    return { id: makeCommandId("rename-variable"), label: `Rename variable to "${id}"`, patches: fragment.patches, inverse: fragment.inverse };
  },

  /**
   * DOC-055: retypes `variables[variableIndex].type` to a (find-or-appended,
   * `ensureType`/DOC-042) `types[]` index for `signature`, resizing its
   * `value` default to the new type's component count in the SAME combined
   * command (`resizeVariableValue`) — a `float3` variable retyped to `bool`
   * would otherwise leave a 3-element `value` array a `bool`-typed variable
   * can never validly carry. Deliberately does NOT check/block usage the way
   * `removeVariable` does: `specs/document-model.md`'s resolved policy is
   * "allow retype, surface validation" — any `variable/get`/`set`/
   * `interpolate` node whose OWN edges assumed the prior type becomes a real
   * type-mismatch finding through the existing `@gltfi/verify`/`@gltfi/ir`
   * validation pipeline (`packages/graph-canvas`'s `validateInteractivityGraph`)
   * the next time it runs — this factory does not re-implement that check
   * itself, only produces the (possibly now-invalid) graph for it to see.
   */
  setVariableType(document: EditorDocument, graphIndex: number, variableIndex: number, signature: string): Command {
    const graph = getGraph(document.json, graphIndex);
    const variable = graph.variables?.[variableIndex];
    if (!variable) {
      throw new Error(`No variable at index ${variableIndex} in graph ${graphIndex}.`);
    }
    const { command: ensureTypeCmd, index: typeIndex } = GraphEdit.ensureType(document, graphIndex, signature);
    const jsonAfterType = ensureTypeCmd.patches.length > 0 ? applyPatches(document.json, ensureTypeCmd.patches) : document.json;

    const typePath = [...graphPath(graphIndex), "variables", variableIndex, "type"];
    const typeFragment = setPathFragment(jsonAfterType, typePath, typeIndex);
    const jsonAfterTypeField = typeFragment.patches.length > 0 ? applyPatches(jsonAfterType, typeFragment.patches) : jsonAfterType;

    const resizedValue = resizeVariableValue(variable.value ?? [], signature);
    const valuePath = [...graphPath(graphIndex), "variables", variableIndex, "value"];
    const valueFragment = setPathFragment(jsonAfterTypeField, valuePath, resizedValue);

    const combined = combineCommandParts([ensureTypeCmd, typeFragment, valueFragment]);
    return {
      id: makeCommandId("set-variable-type"),
      label: `Set variable ${variable.id ?? `#${variableIndex}`} type to "${signature}"`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /** DOC-055: sets `variables[variableIndex].value` outright (the config editor/Variables panel's typed default-value editor calls this on every commit — it does not resize; pair with `setVariableType` when the signature itself is also changing). */
  setVariableDefault(document: EditorDocument, graphIndex: number, variableIndex: number, value: Array<number | boolean | string>): Command {
    const graph = getGraph(document.json, graphIndex);
    if (!graph.variables?.[variableIndex]) {
      throw new Error(`No variable at index ${variableIndex} in graph ${graphIndex}.`);
    }
    const path = [...graphPath(graphIndex), "variables", variableIndex, "value"];
    const fragment = setPathFragment(document.json, path, value);
    return { id: makeCommandId("set-variable-default"), label: `Set variable #${variableIndex} default value`, patches: fragment.patches, inverse: fragment.inverse };
  },

  /**
   * DOC-055: removes `variables[variableIndex]` — BLOCKED (throws
   * `VariableInUseError`) when any `variable/get|set|interpolate` node still
   * references it, the resolved policy over DOC-020's usual dangling-literal
   * treatment (see `VariableInUseError`'s own doc comment for why a
   * dangling VARIABLE index is worse than a dangling scene-node/pointer
   * reference). When unused, removes the element AND shifts every surviving
   * variable-index reference above it down by one (`shiftVariableRefsInNodes`)
   * as ONE combined command — required because, unlike `SceneEdit.removeNode`
   * (which shifts SCENE-node references via the shared `fixupReferences`
   * helper), `variables[]` has no existing shared fixup path; this factory
   * owns its own.
   */
  removeVariable(document: EditorDocument, graphIndex: number, variableIndex: number): Command {
    const graph = getGraph(document.json, graphIndex);
    const variables = graph.variables ?? [];
    const variable = variables[variableIndex];
    if (!variable) {
      throw new Error(`No variable at index ${variableIndex} in graph ${graphIndex}.`);
    }
    const usageCount = countVariableUsage(graph, variableIndex);
    if (usageCount > 0) {
      throw new VariableInUseError(variableIndex, usageCount, variable.id);
    }

    const nodesPath = [...graphPath(graphIndex), "nodes"];
    const shifted = shiftVariableRefsInNodes(graph.nodes, graph.declarations ?? [], variableIndex);
    const nodesFragment: PatchPair = shifted.changed
      ? { patches: [{ op: "replace", path: formatPointer(nodesPath), value: shifted.nodes }], inverse: [{ op: "replace", path: formatPointer(nodesPath), value: graph.nodes }] }
      : { patches: [], inverse: [] };

    const variablesPath = [...graphPath(graphIndex), "variables"];
    const nextVariables = [...variables.slice(0, variableIndex), ...variables.slice(variableIndex + 1)];
    const removeFragment: PatchPair = {
      patches: [{ op: "replace", path: formatPointer(variablesPath), value: nextVariables }],
      inverse: [{ op: "replace", path: formatPointer(variablesPath), value: variables }]
    };

    const combined = combineCommandParts([nodesFragment, removeFragment]);
    return {
      id: makeCommandId("remove-variable"),
      label: `Remove variable${variable.id ? ` "${variable.id}"` : ` #${variableIndex}`}`,
      patches: combined.patches,
      inverse: combined.inverse
    };
  },

  /** `renameVariable`'s counterpart for `graph.events`. */
  renameCustomEvent(document: EditorDocument, graphIndex: number, eventIndex: number, id: string): Command {
    const graph = getGraph(document.json, graphIndex);
    if (!graph.events?.[eventIndex]) {
      throw new Error(`No event at index ${eventIndex} in graph ${graphIndex}.`);
    }
    const path = [...graphPath(graphIndex), "events", eventIndex, "id"];
    const fragment = setPathFragment(document.json, path, id);
    return { id: makeCommandId("rename-custom-event"), label: `Rename event to "${id}"`, patches: fragment.patches, inverse: fragment.inverse };
  },

  /** `removeVariable`'s counterpart for `graph.events` — same block-when-used policy (`CustomEventInUseError`), same shift-don't-dangle fixup (`shiftEventRefsInNodes`) for surviving `event/send|receive` references above the removed index. Events carry no type/default to resize (DOC-055's "same treatment... trivial" scope: declare/rename/delete only). */
  removeCustomEvent(document: EditorDocument, graphIndex: number, eventIndex: number): Command {
    const graph = getGraph(document.json, graphIndex);
    const events = graph.events ?? [];
    const event = events[eventIndex];
    if (!event) {
      throw new Error(`No event at index ${eventIndex} in graph ${graphIndex}.`);
    }
    const usageCount = countEventUsage(graph, eventIndex);
    if (usageCount > 0) {
      throw new CustomEventInUseError(eventIndex, usageCount, event.id);
    }

    const nodesPath = [...graphPath(graphIndex), "nodes"];
    const shifted = shiftEventRefsInNodes(graph.nodes, graph.declarations ?? [], eventIndex);
    const nodesFragment: PatchPair = shifted.changed
      ? { patches: [{ op: "replace", path: formatPointer(nodesPath), value: shifted.nodes }], inverse: [{ op: "replace", path: formatPointer(nodesPath), value: graph.nodes }] }
      : { patches: [], inverse: [] };

    const eventsPath = [...graphPath(graphIndex), "events"];
    const nextEvents = [...events.slice(0, eventIndex), ...events.slice(eventIndex + 1)];
    const removeFragment: PatchPair = {
      patches: [{ op: "replace", path: formatPointer(eventsPath), value: nextEvents }],
      inverse: [{ op: "replace", path: formatPointer(eventsPath), value: events }]
    };

    const combined = combineCommandParts([nodesFragment, removeFragment]);
    return {
      id: makeCommandId("remove-custom-event"),
      label: `Remove event${event.id ? ` "${event.id}"` : ` #${eventIndex}`}`,
      patches: combined.patches,
      inverse: combined.inverse
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
