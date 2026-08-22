// Top-level behavior-graph canvas component (specs/ux-graph-canvas.md):
// reads the raw KHR_interactivity graph out of `document.json`, maps it
// (map-graph.ts), and wires the palette/canvas/details three-pane layout
// together with full editing — every edit gesture GraphView/PalettePanel
// report is translated here into a GraphEdit (or graph-edit-ext/ensure-graph)
// Command and handed to `dispatchCommand`; this is the ONLY module in the
// package that calls those command factories.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GraphEdit,
  applyPatches,
  combineCommandParts,
  countEventUsage,
  countVariableUsage,
  getIn,
  makeCommandId,
  VariableInUseError,
  CustomEventInUseError,
  type Command,
  type EditorDocument
} from "@gltf-studio/editor-core";
import type { ValueType } from "@gltfi/kernel";
import { graphNodeSceneRef, type UsageDocJson, type UsageGraphNode } from "@gltf-studio/usage-index";
import { mapGraph, type InteractivityGraph, type MappedGraph } from "./map-graph.js";
import { GraphView } from "./graph-view.js";
import { PalettePanel } from "./palette-panel.js";
import { NodeDetails } from "./node-details.js";
import { VariablesPanel } from "./variables-panel.js";
import type { LiteralValue } from "./literal-editors.js";
import { validateInteractivityGraph, type ValidationResult } from "./validation.js";
import { setLiteralValue } from "./graph-edit-ext.js";
import { ensureGraphScaffold } from "./ensure-graph.js";

const VALIDATION_DEBOUNCE_MS = 300;

/** A zero-valued literal shaped for `signature` — used as a freshly-created variable's initial `value` (the config editor's "+ new variable…" flow doesn't ask the user for a starting value). */
function defaultLiteralFor(signature: ValueType): Array<number | boolean> {
  switch (signature) {
    case "bool":
      return [false];
    case "float2":
      return [0, 0];
    case "float3":
      return [0, 0, 0];
    case "float4":
    case "float4x4":
      return signature === "float4x4" ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [0, 0, 0, 0];
    case "float3x3":
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    case "float2x2":
      return [1, 0, 0, 1];
    case "int":
    case "float":
    case "ref":
    default:
      return [0];
  }
}

const EMPTY_VALIDATION: ValidationResult = { ok: true, diagnostics: [], byNodeIndex: new Map(), unindexed: [] };

export type GraphCanvasProps = {
  document: EditorDocument;
  /** Which `extensions.KHR_interactivity.graphs[N]` to show/edit. Defaults to 0. */
  graphIndex?: number;
  dispatchCommand: (command: Command) => void;
  selectedNodeIndex: number | null;
  onSelectNode: (index: number | null) => void;
  onLog?: (level: "info" | "warn" | "error", text: string) => void;
  onToast?: (text: string) => void;
  onAskCopilot?: () => void;
  /**
   * specs/ux-graph-canvas.md UX-509: clicking a pointer node's config TEXT —
   * out of scope for this package (it reaches into the Data tab, owned by
   * `packages/app`). Omitted, this click is a no-op (structurally distinct
   * from the `✎` icon regardless, per UX-505/UX-508).
   */
  onJumpToData?: (pointerPath: string) => void;
  /**
   * specs/ux-graph-canvas.md UX-509 / specs/ux-pointer-picker.md: clicking a
   * pointer node's `✎` icon — likewise out of scope here (the picker dialog
   * itself is owned by `packages/app`, no dedicated ownership glob yet per
   * that spec's "Owns" note). `currentPath`/`currentType` seed the dialog's
   * preselection (UX-907); either may be `undefined` for a pointer node with
   * no config yet.
   */
  onOpenPointerPicker?: (info: { nodeIndex: number; currentPath?: string; currentType?: string }) => void;
  /** UX-1107 (specs/ux-usage-mapping.md): forwarded to GraphView — see its own doc comment. */
  focusRequest?: { nodeIndex: number; seq: number } | null;
  /** UX-1111: the node-details "Reveal in viewport" control, when the selected node addresses a scene node (`graphNodeSceneRef`, below). Omitted (button hidden) when the host has no viewport to reveal into. */
  onRevealInViewport?: (sceneNodeIndex: number) => void;
  /**
   * Task ("handler nodes show their target"): a handler node's target chip
   * (op-node.tsx) or the node-details "Target node" selector's own scene-tree
   * reflection was clicked/changed — selects that scene node in the HOST's
   * own scene-selection store (tree/inspector/viewport all react), the same
   * store action a scene-tree row click makes. This is direct selection,
   * complementary to (not a replacement for) the existing amber reference-
   * highlight (UX-1110), which is driven purely by the CURRENT graph-node
   * selection one layer up and stays exactly as-is. Omitted (chip renders
   * inert, `title` still shows the resolved name) when the host has no scene
   * selection to drive — same optional-callback convention as
   * `onRevealInViewport` above.
   */
  onSelectSceneNode?: (sceneNodeIndex: number) => void;
  /** D2 (specs/ux-debugger.md UX-1506): forwarded straight to GraphView — see its own doc comment. */
  breakpointNodeIndices?: ReadonlySet<number>;
  /** D2 (specs/ux-debugger.md UX-1507): whether the CURRENTLY SELECTED node can "Break here" — resolved one layer up (`packages/app`'s BehaviorGraphPanel.tsx) since that resolution needs `@gltf-studio/script-panel`'s emit/cross-highlight machinery, which this package deliberately does not depend on (same "canvas package doesn't import the editing package" posture the docNames/onJumpToData props above already establish). Omitted (button hidden) when the host has no script-breakpoint concept. */
  canBreakHere?: boolean;
  /** D2: forwarded to NodeDetails — see its own doc comment. */
  onBreakHere?: (nodeIndex: number) => void;
};

export function GraphCanvas({
  document,
  graphIndex = 0,
  dispatchCommand,
  selectedNodeIndex,
  onSelectNode,
  onLog,
  onToast,
  onAskCopilot,
  onJumpToData,
  onOpenPointerPicker,
  focusRequest,
  onRevealInViewport,
  onSelectSceneNode,
  breakpointNodeIndices,
  canBreakHere,
  onBreakHere
}: GraphCanvasProps): JSX.Element {
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  // Task ("in the node graph there is no way to edit variables"): defaults
  // COLLAPSED (unlike `detailsCollapsed` above) — this is a brand new panel
  // with no prior on-screen footprint, and every existing e2e/graph-canvas.spec.ts
  // pixel/zoom assertion was written against the pre-existing three-pane
  // (palette/canvas/details) layout; starting collapsed keeps that geometry
  // byte-for-byte unchanged for anyone who never opens it, while still
  // giving it the always-visible collapsed-rail expand affordance
  // `NodeDetails`'s own collapse pattern already establishes.
  const [variablesCollapsed, setVariablesCollapsed] = useState(true);
  const [validation, setValidation] = useState<ValidationResult>(EMPTY_VALIDATION);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoggedKey = useRef<string>("");

  const graphs = getIn(document.json, ["extensions", "KHR_interactivity", "graphs"]) as unknown[] | undefined;
  const hasGraph = graphs !== undefined && graphs.length > graphIndex;
  const rawGraph = hasGraph ? (graphs![graphIndex] as InteractivityGraph) : undefined;
  const animationNames = useMemo(
    () => ((getIn(document.json, ["animations"]) as Array<{ name?: string }> | undefined) ?? []).map((a, i) => a.name ?? `Animation ${i}`),
    [document.json]
  );
  /**
   * Task ("handler nodes show their target"): scene-node names for
   * `OpNode`'s target chip + the node-details "Target node" selector — the
   * same `name ?? "Node {i}"` fallback convention `packages/app`'s
   * `Viewport.tsx`/`app-store.ts` (`revealSceneNodeInViewport`) already use.
   * Threaded down as `docNames` (op-node.ts) rather than widening
   * `mapGraph`'s own contract — see that type's doc comment for why.
   */
  const sceneNodeNames = useMemo(
    () => ((getIn(document.json, ["nodes"]) as Array<{ name?: string }> | undefined) ?? []).map((n, i) => n.name ?? `Node ${i}`),
    [document.json]
  );
  const docNames = useMemo(() => ({ sceneNodeNames, animationNames }), [sceneNodeNames, animationNames]);

  const mapped: MappedGraph | null = useMemo(() => (rawGraph ? mapGraph(rawGraph, graphIndex) : null), [rawGraph, graphIndex]);

  // DOC-055: usage counts for the Variables panel's "Used" column + delete-button gate — the SAME `GraphEdit.countVariableUsage`/`countEventUsage` `removeVariable`/`removeCustomEvent` themselves use, so the panel's displayed count and the command's actual block/allow decision can never drift apart.
  const variableUsageCounts = useMemo(
    () => (rawGraph?.variables ?? []).map((_, i) => countVariableUsage(rawGraph as unknown as Parameters<typeof countVariableUsage>[0], i)),
    [rawGraph]
  );
  const eventUsageCounts = useMemo(
    () => (rawGraph?.events ?? []).map((_, i) => countEventUsage(rawGraph as unknown as Parameters<typeof countEventUsage>[0], i)),
    [rawGraph]
  );

  // UX-506: validation runs debounced on graph changes, joined by node index.
  // `sceneNodeNames.length` (the document's real scene-node count) additionally
  // runs `checkHandlerTargets` (validation.ts) — the one check in this
  // pipeline with the document-level context `@gltfi/verify`'s own
  // `validateGraph` never has (see that function's doc comment).
  useEffect(() => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
    if (!rawGraph) {
      setValidation(EMPTY_VALIDATION);
      return;
    }
    validationTimer.current = setTimeout(() => {
      const result = validateInteractivityGraph(rawGraph, sceneNodeNames.length);
      setValidation(result);
      const errorKey = result.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => `${d.nodeIndex ?? "-"}:${d.code}`)
        .sort()
        .join(",");
      if (errorKey !== lastLoggedKey.current) {
        lastLoggedKey.current = errorKey;
        if (errorKey) {
          const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;
          onLog?.("error", `Behavior graph ${graphIndex}: ${errorCount} validation error(s) — see the graph canvas for details.`);
        }
      }
    }, VALIDATION_DEBOUNCE_MS);
    return () => {
      if (validationTimer.current) clearTimeout(validationTimer.current);
    };
  }, [rawGraph, graphIndex, sceneNodeNames.length]);

  function resolveTargetDocumentAndGraphIndex(): { workingDocument: EditorDocument; index: number } {
    if (hasGraph) return { workingDocument: document, index: graphIndex };
    const scaffold = ensureGraphScaffold(document);
    if (scaffold.command) dispatchCommand(scaffold.command);
    return { workingDocument: scaffold.documentAfter, index: scaffold.graphIndex };
  }

  function handleAddNode(op: string, position?: { x: number; y: number }) {
    const { workingDocument, index } = resolveTargetDocumentAndGraphIndex();
    // Cascade a small offset per existing node so repeated click-to-add
    // (no drop point available) doesn't stack every new node exactly on
    // top of the last one.
    const existingCount = (getIn(workingDocument.json, ["extensions", "KHR_interactivity", "graphs", index, "nodes"]) as unknown[] | undefined)?.length ?? 0;
    const fallbackPosition = { x: 40 + (existingCount % 6) * 24, y: 40 + (existingCount % 6) * 24 };
    const command = GraphEdit.addNode(workingDocument, index, op, { position: position ?? fallbackPosition });
    dispatchCommand(command);
    onSelectNode(existingCount);
  }

  function handleConnectValue(nodeIndex: number, socket: string, sourceNode: number, sourceSocket: string) {
    dispatchCommand(GraphEdit.connectValue(document, graphIndex, nodeIndex, socket, sourceNode, sourceSocket));
  }

  function handleConnectFlow(fromNode: number, fromSocket: string, toNode: number, toSocket: string) {
    dispatchCommand(GraphEdit.connectFlow(document, graphIndex, fromNode, fromSocket, toNode, toSocket));
  }

  function handleConnectRejected(reason: string) {
    onToast?.(`Connection rejected: ${reason}`);
    onLog?.("warn", `Behavior graph ${graphIndex}: rejected connection — ${reason}`);
  }

  function handleDisconnectEdge(nodeIndex: number, socket: string, kind: "value" | "flow") {
    dispatchCommand(GraphEdit.disconnect(document, graphIndex, nodeIndex, socket, kind));
  }

  function handleRemoveNodes(nodeIndices: number[]) {
    // Removed in descending index order, threading the JSON locally between
    // dispatches: each dispatchCommand only updates the app store's document
    // on its NEXT render, so computing every removal in this same
    // synchronous handler against a shared, locally-advanced copy is what
    // keeps fixupReferences (DOC-019) correct for a multi-select delete.
    const sorted = [...new Set(nodeIndices)].sort((a, b) => b - a);
    let working = document;
    for (const nodeIndex of sorted) {
      const command = GraphEdit.removeNode(working, graphIndex, nodeIndex);
      dispatchCommand(command);
      working = { ...working, json: applyPatches(working.json, command.patches) };
    }
    if (selectedNodeIndex !== null && sorted.includes(selectedNodeIndex)) {
      onSelectNode(null);
    }
  }

  function handleMoveNode(nodeIndex: number, x: number, y: number) {
    dispatchCommand(GraphEdit.setNodePosition(document, graphIndex, nodeIndex, x, y));
  }

  /** The M4 config-field editor's generic fallback (node-details.tsx's ConfigEditor) — every OTHER case below builds a more specific command. */
  function handleSetConfigField(nodeIndex: number, field: string, value: Array<number | boolean | string>) {
    dispatchCommand(GraphEdit.setNodeConfig(document, graphIndex, nodeIndex, field, value));
  }

  /**
   * The config editor's "variable/set|get variable selector ... + 'new
   * variable…'" case: ensures a `types[]` entry for `signature` (a brand new
   * variable needs its OWN type, unlike a config field that reuses an
   * already-declared one), appends the variable, then points `field` (
   * "variable" for get/interpolate, "variables" for set — `arraySlot`
   * disambiguates which slot of the latter) at its fresh index, as ONE
   * combined undo/redo step.
   */
  function handleAddVariableAndSetConfig(nodeIndex: number, field: string, id: string, signature: ValueType, arraySlot?: number) {
    const { command: ensureTypeCmd, index: typeIndex } = GraphEdit.ensureType(document, graphIndex, signature);
    const jsonAfterType = ensureTypeCmd.patches.length > 0 ? applyPatches(document.json, ensureTypeCmd.patches) : document.json;
    const docAfterType: EditorDocument = { ...document, json: jsonAfterType };

    const addVarCmd = GraphEdit.addVariable(docAfterType, graphIndex, { id, type: typeIndex, value: defaultLiteralFor(signature) });
    const jsonAfterVar = applyPatches(jsonAfterType, addVarCmd.patches);
    const newVarIndex = ((getIn(jsonAfterType, ["extensions", "KHR_interactivity", "graphs", graphIndex, "variables"]) as unknown[] | undefined)?.length ?? 0);

    const currentArray = field === "variables" ? (getIn(document.json, ["extensions", "KHR_interactivity", "graphs", graphIndex, "nodes", nodeIndex, "configuration", "variables", "value"]) as number[] | undefined) ?? [] : undefined;
    const configValue: Array<number | boolean | string> =
      field === "variables"
        ? (() => {
            const next = currentArray!.slice();
            next[arraySlot ?? 0] = newVarIndex;
            return next;
          })()
        : [newVarIndex];

    const setCfgCmd = GraphEdit.setNodeConfig({ ...document, json: jsonAfterVar }, graphIndex, nodeIndex, field, configValue);
    const combined = combineCommandParts([ensureTypeCmd, addVarCmd, setCfgCmd]);
    dispatchCommand({ id: makeCommandId("add-variable-and-set"), label: `Add variable "${id}" and assign to node ${nodeIndex}`, patches: combined.patches, inverse: combined.inverse });
  }

  function handleSetEventConfig(nodeIndex: number, eventIndex: number) {
    dispatchCommand(GraphEdit.setNodeConfig(document, graphIndex, nodeIndex, "event", [eventIndex]));
  }

  function handleAddEventAndSetConfig(nodeIndex: number, id: string) {
    const addEventCmd = GraphEdit.addCustomEvent(document, graphIndex, { id });
    const jsonAfterEvent = applyPatches(document.json, addEventCmd.patches);
    const newEventIndex = ((getIn(document.json, ["extensions", "KHR_interactivity", "graphs", graphIndex, "events"]) as unknown[] | undefined)?.length ?? 0);
    const setCfgCmd = GraphEdit.setNodeConfig({ ...document, json: jsonAfterEvent }, graphIndex, nodeIndex, "event", [newEventIndex]);
    const combined = combineCommandParts([addEventCmd, setCfgCmd]);
    dispatchCommand({ id: makeCommandId("add-event-and-set"), label: `Add event "${id}" and assign to node ${nodeIndex}`, patches: combined.patches, inverse: combined.inverse });
  }

  /**
   * DOC-055: the Variables panel's "+ Add variable" — a fresh, unreferenced
   * `bool`-typed variable named "New Variable" (renamed inline immediately
   * after, same "create blank, then edit" flow the config editor's own
   * `DeclarationSelect` "+ New variable..." mini-form uses, just without
   * that form's up-front name/type prompt — this affordance has no node
   * context to ask "assign to which field" the config editor's version
   * does).
   */
  function handleAddVariable() {
    const { workingDocument, index } = resolveTargetDocumentAndGraphIndex();
    const command = GraphEdit.addVariable(workingDocument, index, { id: "New Variable", type: 0, value: [false] });
    dispatchCommand(command);
  }

  function handleRenameVariable(variableIndex: number, id: string) {
    dispatchCommand(GraphEdit.renameVariable(document, graphIndex, variableIndex, id));
  }

  function handleSetVariableType(variableIndex: number, signature: string) {
    dispatchCommand(GraphEdit.setVariableType(document, graphIndex, variableIndex, signature));
  }

  function handleSetVariableDefault(variableIndex: number, value: LiteralValue) {
    dispatchCommand(GraphEdit.setVariableDefault(document, graphIndex, variableIndex, value));
  }

  /** DOC-055's block-when-used policy surfaces here as a toast (mirroring `handleConnectRejected`'s own "reject, don't throw past the UI" convention) rather than an uncaught exception reaching the app shell. */
  function handleRemoveVariable(variableIndex: number) {
    try {
      dispatchCommand(GraphEdit.removeVariable(document, graphIndex, variableIndex));
    } catch (err) {
      if (err instanceof VariableInUseError) {
        onToast?.(err.message);
      } else {
        throw err;
      }
    }
  }

  function handleAddEvent() {
    const { workingDocument, index } = resolveTargetDocumentAndGraphIndex();
    dispatchCommand(GraphEdit.addCustomEvent(workingDocument, index, { id: "New Event" }));
  }

  function handleRenameEvent(eventIndex: number, id: string) {
    dispatchCommand(GraphEdit.renameCustomEvent(document, graphIndex, eventIndex, id));
  }

  function handleRemoveEvent(eventIndex: number) {
    try {
      dispatchCommand(GraphEdit.removeCustomEvent(document, graphIndex, eventIndex));
    } catch (err) {
      if (err instanceof CustomEventInUseError) {
        onToast?.(err.message);
      } else {
        throw err;
      }
    }
  }

  /**
   * Task ("wire selection/usage to the existing usage-index if cheap"):
   * clicking a variable's usage-count chip selects the FIRST graph node that
   * references it (`variable/get|set|interpolate`'s `configuration.variable`/
   * `variables`) — a real but intentionally minimal wiring (a variable can be
   * referenced by many nodes; this is "jump to one of them", not a
   * multi-select highlight-all, which `onSelectNode`'s single-selection
   * contract doesn't support today anyway).
   */
  function handleSelectVariableUsage(variableIndex: number) {
    if (!rawGraph) return;
    const declarations = rawGraph.declarations ?? [];
    const idx = rawGraph.nodes.findIndex((node) => {
      const op = declarations[node.declaration]?.op;
      if (op === "variable/get" || op === "variable/interpolate") return node.configuration?.variable?.value?.[0] === variableIndex;
      if (op === "variable/set") {
        const arr = node.configuration?.variables?.value;
        return Array.isArray(arr) && arr.includes(variableIndex);
      }
      return false;
    });
    if (idx !== -1) onSelectNode(idx);
  }

  function handleSelectEventUsage(eventIndex: number) {
    if (!rawGraph) return;
    const declarations = rawGraph.declarations ?? [];
    const idx = rawGraph.nodes.findIndex((node) => {
      const op = declarations[node.declaration]?.op;
      return (op === "event/send" || op === "event/receive") && node.configuration?.event?.value?.[0] === eventIndex;
    });
    if (idx !== -1) onSelectNode(idx);
  }

  /** `animation/start`/`animation/stop`'s "animation" socket is a VALUE (ref-typed literal), not a `configuration` field — see handleCreateFromDrop's own doc comment for why `ref` needs its own `types[]` entry. */
  function handleSetAnimationValue(nodeIndex: number, animationIndex: number) {
    dispatchCommand(setLiteralValue(document, graphIndex, nodeIndex, "animation", "ref", [animationIndex]));
  }

  function handleLiteralCommit(nodeIndex: number, socket: string, type: ValueType, value: Array<number | boolean | string>) {
    dispatchCommand(setLiteralValue(document, graphIndex, nodeIndex, socket, type, value));
  }

  function handlePointerTextClick(nodeIndex: number) {
    // UX-509: the pointer path IS the node's subtitle (map-graph.ts's
    // nodeSubtitle returns `configuration.pointer`'s string for every
    // pointer/* op) — no config with a pointer isn't clickable text in the
    // first place (OpNode only renders this row when `node.subtitle` is set).
    const node = mapped?.nodes.find((n) => n.index === nodeIndex);
    if (node?.subtitle) {
      onJumpToData?.(node.subtitle);
    } else {
      onLog?.("warn", `Pointer node ${nodeIndex}: no pointer configured yet — nothing to jump to.`);
    }
  }

  function handlePointerIconClick(nodeIndex: number) {
    const node = mapped?.nodes.find((n) => n.index === nodeIndex);
    if (!node) return;
    // The pointer's resolved value type: pointer/get exposes it on its
    // "value" OUTPUT port, pointer/set|interpolate on their "value" INPUT
    // port — map-graph.ts already resolved this from `configuration.type`.
    const valuePort = node.ports.find((p) => p.name === "value" && (p.kind === "value-in" || p.kind === "value-out"));
    onOpenPointerPicker?.({ nodeIndex, currentPath: node.subtitle, currentType: valuePort?.type });
  }

  /**
   * specs/ux-graph-canvas.md UX-508 (scene-tree-row / Animations-tab-clip
   * drag-drop): builds the chosen drop-menu option's node as one command,
   * scaffolding the graph first if needed (same `resolveTargetDocumentAndGraphIndex`
   * `handleAddNode` uses) — `pointer/get|set|interpolate` default to the
   * dragged node's `translation` (every node has one; the picker's `✎` icon
   * lets the user retarget afterward, same as the Inspector's `◈`
   * shortcuts), `event/onSelect (this node)` sets `configuration.nodeIndex`,
   * `animation/start|stop` set a `ref`-typed `values.animation` literal
   * pointing at the dragged clip's index.
   */
  function handleCreateFromDrop(kind: "node" | "anim", refId: number, optionKey: string, position: { x: number; y: number }) {
    const { workingDocument, index } = resolveTargetDocumentAndGraphIndex();
    const existingCount = (getIn(workingDocument.json, ["extensions", "KHR_interactivity", "graphs", index, "nodes"]) as unknown[] | undefined)?.length ?? 0;

    let command: Command;
    if (kind === "node" && optionKey === "pointer-get") {
      command = GraphEdit.addPointerNode(workingDocument, index, "get", `/nodes/${refId}/translation`, "float3", position);
    } else if (kind === "node" && optionKey === "pointer-set") {
      command = GraphEdit.addPointerNode(workingDocument, index, "set", `/nodes/${refId}/translation`, "float3", position);
    } else if (kind === "node" && optionKey === "pointer-interpolate") {
      command = GraphEdit.addPointerNode(workingDocument, index, "interpolate", `/nodes/${refId}/translation`, "float3", position);
    } else if (kind === "node" && optionKey === "event-onselect") {
      command = GraphEdit.addNode(workingDocument, index, "event/onSelect", {
        extension: "KHR_node_selectability",
        configuration: { nodeIndex: { value: [refId] } },
        position
      });
    } else if (kind === "anim" && (optionKey === "animation-start" || optionKey === "animation-stop")) {
      const { command: ensureRefCmd, index: refTypeIndex } = GraphEdit.ensureType(workingDocument, index, "ref");
      const jsonAfterType = ensureRefCmd.patches.length > 0 ? applyPatches(workingDocument.json, ensureRefCmd.patches) : workingDocument.json;
      const addCmd = GraphEdit.addNode(
        { ...workingDocument, json: jsonAfterType },
        index,
        optionKey === "animation-start" ? "animation/start" : "animation/stop",
        { values: { animation: { type: refTypeIndex, value: [refId] } }, position }
      );
      const combined = combineCommandParts([ensureRefCmd, addCmd]);
      command = { id: makeCommandId("add-anim-node"), label: addCmd.label, patches: combined.patches, inverse: combined.inverse };
    } else {
      onLog?.("warn", `Drop menu: unhandled option "${optionKey}" for ${kind} drop.`);
      return;
    }

    dispatchCommand(command);
    onSelectNode(existingCount);
    onToast?.(`Added node from drag-drop.`);
  }

  const selectedNode = mapped?.nodes.find((n) => n.index === selectedNodeIndex) ?? null;
  // UX-1110/UX-1111: the same resolution rule the reverse usage index
  // (@gltf-studio/usage-index's buildUsageIndex) is built from, applied
  // forward — "does the SELECTED graph node address a scene node?" — for
  // the reference highlight and the "Reveal in viewport" control. `null`
  // for animation/* ops (no single "the" scene node, UX-1102) and for any
  // op this module can't resolve with certainty (UX-1105).
  const selectedNodeSceneRef =
    rawGraph && selectedNode
      ? graphNodeSceneRef(selectedNode.op, rawGraph.nodes[selectedNode.index] as unknown as UsageGraphNode, document.json as UsageDocJson)
      : null;

  return (
    <div className="gcanvas-root" data-testid="gcanvas.root">
      <PalettePanel onAddNode={(op) => handleAddNode(op)} onAskCopilot={onAskCopilot} />
      <VariablesPanel
        collapsed={variablesCollapsed}
        onToggleCollapsed={() => setVariablesCollapsed((v) => !v)}
        variables={rawGraph?.variables ?? []}
        events={rawGraph?.events ?? []}
        types={rawGraph?.types ?? []}
        variableUsageCounts={variableUsageCounts}
        eventUsageCounts={eventUsageCounts}
        onAddVariable={handleAddVariable}
        onRenameVariable={handleRenameVariable}
        onSetVariableType={handleSetVariableType}
        onSetVariableDefault={handleSetVariableDefault}
        onRemoveVariable={handleRemoveVariable}
        onAddEvent={handleAddEvent}
        onRenameEvent={handleRenameEvent}
        onRemoveEvent={handleRemoveEvent}
        onSelectVariable={handleSelectVariableUsage}
        onSelectEvent={handleSelectEventUsage}
      />
      {mapped ? (
        <GraphView
          graph={mapped}
          selectedNodeIndex={selectedNodeIndex}
          onSelectNode={onSelectNode}
          diagnosticsByNode={validation.byNodeIndex}
          onLiteralCommit={handleLiteralCommit}
          onPointerTextClick={handlePointerTextClick}
          onPointerIconClick={handlePointerIconClick}
          onConnectValue={handleConnectValue}
          onConnectFlow={handleConnectFlow}
          onConnectRejected={handleConnectRejected}
          onDisconnectEdge={handleDisconnectEdge}
          onRemoveNodes={handleRemoveNodes}
          onMoveNode={handleMoveNode}
          onDropOp={handleAddNode}
          onCreateFromDrop={handleCreateFromDrop}
          focusRequest={focusRequest}
          docNames={docNames}
          onTargetChipClick={onSelectSceneNode}
          breakpointNodeIndices={breakpointNodeIndices}
        />
      ) : (
        <div className="gcanvas-empty-state" data-testid="gcanvas.empty">
          <p>No interactivity graph — add the first node from the palette to get started.</p>
        </div>
      )}
      {mapped ? (
        <NodeDetails
          graph={mapped}
          selectedNode={selectedNode}
          collapsed={detailsCollapsed}
          onToggleCollapsed={() => setDetailsCollapsed((v) => !v)}
          diagnosticsByNode={validation.byNodeIndex}
          unindexedDiagnostics={validation.unindexed}
          variables={rawGraph?.variables ?? []}
          events={rawGraph?.events ?? []}
          animationNames={animationNames}
          sceneNodeNames={sceneNodeNames}
          onSetConfigField={handleSetConfigField}
          onAddVariableAndSetConfig={handleAddVariableAndSetConfig}
          onSetEventConfig={handleSetEventConfig}
          onAddEventAndSetConfig={handleAddEventAndSetConfig}
          onSetAnimationValue={handleSetAnimationValue}
          onLiteralCommit={handleLiteralCommit}
          onOpenPointerPicker={onOpenPointerPicker ? (nodeIndex) => handlePointerIconClick(nodeIndex) : undefined}
          sceneRef={selectedNodeSceneRef}
          onRevealInViewport={onRevealInViewport}
          canBreakHere={canBreakHere}
          onBreakHere={onBreakHere}
        />
      ) : null}
    </div>
  );
}
