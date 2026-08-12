// Pure mapping from a raw KHR_interactivity `graph` JSON object (as found at
// `json.extensions.KHR_interactivity.graphs[N]` of a .gltf/.glb) to a
// structured-clone-safe `MappedGraph` the webview can render. No VS Code API,
// no file I/O, no throwing on malformed/unknown input — this module must
// tolerate every corpus asset and degrade gracefully (unknown ops render
// gray with structural-only ports; malformed config is recorded as a
// warning, never a crash).
//
// Design (see plan, Workstream B, "mapGraph (pure, unit-tested)"):
//   - per node: op from declarations, spec from kernel getOpSpec (tolerate
//     unknown -> gray/unknownSpec)
//   - value in-ports  = node.values keys UNION spec inputs
//   - value out-ports = spec outputs UNION sockets discovered from every
//     OTHER node's value ref that targets this node as a source
//   - flow out-ports = node.flows keys UNION spec.outputFlows
//   - flow in-ports  = spec.inputFlows UNION sockets discovered from every
//     OTHER node's flow ref that targets this node as a destination
//     (covers dynamic ops like flow/sequence, flow/multiGate)
//   - value refs are stored REVERSED (a node's `values[x]` points at its
//     *source* node) - edges are derived by flipping that into
//     source-output -> target-input
//   - types are resolved best-effort via the graph's `types` table
//     (variable/pointer/event declarations carry explicit type-table
//     indices) plus kernel's overload resolver and a small forward/backward
//     propagation pass across value edges; anything left unresolved (e.g.
//     deep generic chains) is left `undefined` rather than guessed
//   - inline literal values render in-node (not as edges)
//   - one color/category token per registry OpCategory (+ "unknown")

import { getOpSpec, resolveOverload, type OpCategory, type OpSpec, type TypeSig } from "@gltfi/kernel";

const GENERIC = new Set(["F", "V", "M", "T"]);

// ---------------------------------------------------------------------------
// Raw KHR_interactivity graph JSON shapes (structurally compatible with
// @gltfi/ir's `Graph`, redeclared here so this module has zero dependency on
// @gltfi/ir and works directly off glTF JSON per the plan).
// ---------------------------------------------------------------------------

export type JsonScalar = number | boolean | string;

export type InteractivityTypeDecl = { signature: string; [extra: string]: unknown };

export type InteractivityVariable = {
  id?: string;
  type: number;
  value?: JsonScalar[];
};

export type InteractivityEventValue = { type: number; value?: JsonScalar[] };

export type InteractivityEvent = {
  id?: string;
  values?: Record<string, InteractivityEventValue>;
};

export type InteractivityDeclaration = { op: string; extension?: string };

export type GraphValueRef = { node: number; socket?: string };
export type GraphValueLiteral = { type: number; value: JsonScalar[] };
export type GraphNodeValue = GraphValueRef | GraphValueLiteral;
export type GraphFlowRef = { node: number; socket: string };

export type InteractivityConfigValue = { value: JsonScalar[] };

export type InteractivityNode = {
  declaration: number;
  configuration?: Record<string, InteractivityConfigValue>;
  values?: Record<string, GraphNodeValue>;
  flows?: Record<string, GraphFlowRef>;
};

/** The raw per-graph object: `json.extensions.KHR_interactivity.graphs[N]`. */
export type InteractivityGraph = {
  types: InteractivityTypeDecl[];
  variables?: InteractivityVariable[];
  events?: InteractivityEvent[];
  declarations: InteractivityDeclaration[];
  nodes: InteractivityNode[];
};

// ---------------------------------------------------------------------------
// Mapped (output) shapes
// ---------------------------------------------------------------------------

export type PortKind = "flow-in" | "flow-out" | "value-in" | "value-out";

export type MappedPort = {
  /** Stable within the node: `${kind}:${name}`. */
  id: string;
  name: string;
  kind: PortKind;
  /** Resolved type signature (e.g. "float3"), when determinable. */
  type?: string;
};

export type MappedLiteral = {
  /** Resolved type signature, when the type-table index is valid. */
  type?: string;
  value: JsonScalar[];
};

export type MappedNode = {
  index: number;
  op: string;
  /**
   * Widened from `OpCategory | "unknown"` to a plain `string` (M7, for
   * `@gltf-studio/audio-canvas`'s reuse of this shape + `GraphView`/
   * `NodeDetails` for `KHR_audio_graph` — specs/ux-audio-graph.md UX-600 —
   * which has its own category namespace, e.g. `"audio"`, entirely outside
   * `@gltfi/kernel`'s `OpCategory` registry). Every existing
   * `KHR_interactivity` `OpCategory` value is still a valid `string`, so
   * this is source-compatible for every caller of `mapGraph` — see
   * `palette.ts`'s matching widening.
   */
  category: string;
  /** Op tail, e.g. "doN" for "flow/doN". */
  label: string;
  /** Variable/event/pointer name, when resolvable from configuration. */
  subtitle?: string;
  /** True when `subtitle` reflects a dangling reference (e.g. `variable/get`'s `configuration.variable` index no longer exists in the graph's own `variables[]` table) rather than a resolved id or an anonymous `var#N`/`event#N` fallback — lets the renderer apply the same "missing" treatment `handlerTarget` below gets. */
  subtitleMissing?: boolean;
  /**
   * `event/onSelect`/`onHoverIn`/`onHoverOut`'s `configuration.nodeIndex`
   * (the SCENE node — not a graph node — this handler is scoped to) plus
   * `configuration.stopPropagation`, extracted here (pure — no document.json
   * access) so a caller with document context (`@gltf-studio/graph-canvas`'s
   * `graph-canvas.tsx`) can resolve `nodeIndex` to that scene node's name for
   * the card's "target: <name> (#N)" chip (specs/ux-graph-canvas.md, task:
   * "handler nodes show their target") without this module ever reaching
   * into `document.json` itself — mapGraph stays pure over the graph object
   * alone. `nodeIndex` is the raw configured value (default `-1`, the
   * registry's own "any node" sentinel per `@gltf-studio/usage-index`'s
   * identical convention) — resolving it to a name, an "any node" label, or
   * a "missing" dangling state against the document's actual scene-node
   * count is the RENDERER's job (`op-node.tsx`), not this pure mapper's.
   */
  handlerTarget?: { nodeIndex: number; stopPropagation: boolean };
  /** False when `op` isn't in the kernel registry (renders gray). */
  knownSpec: boolean;
  ports: MappedPort[];
  /** Inline constant values keyed by the value-in port name they occupy. */
  literals: Record<string, MappedLiteral>;
  /**
   * The raw per-graph-format node object this was mapped from (for the
   * details panel's raw-JSON view). Widened from `InteractivityNode` to
   * `unknown` alongside `category` above, for the same
   * `@gltf-studio/audio-canvas` reuse reason — its raw node shape is a
   * `KHRGraphNodeSpec` (audio-graph-js), not an `InteractivityNode`.
   * `node-details.tsx`'s one read of this field already defends with a
   * local cast rather than assuming the interactivity shape.
   */
  raw: unknown;
};

export type MappedEdge = {
  id: string;
  kind: "flow" | "value";
  sourceNode: number;
  sourcePort: string;
  targetNode: number;
  targetPort: string;
  /** Resolved type signature, value edges only. */
  type?: string;
  /** UX-603 (audio-graph canvas): drawn with a dashed stroke instead of hidden/omitted. Unused (always falsy) by the behavior-graph canvas. */
  invalid?: boolean;
};

export type MappedGraph = {
  graphIndex: number;
  nodeCount: number;
  edgeCount: number;
  variableCount: number;
  eventCount: number;
  nodes: MappedNode[];
  edges: MappedEdge[];
  /** Non-fatal issues encountered while mapping (unknown ops, bad config, ...). */
  warnings: string[];
};

// One display token per OpCategory, plus "unknown" for unregistered ops.
// Consumed by the webview as a CSS class suffix (`.gi-cat-${token}`).
export const CATEGORY_TOKENS: Record<OpCategory | "unknown", string> = {
  math: "math",
  type: "type",
  ref: "ref",
  flow: "flow",
  variable: "variable",
  pointer: "pointer",
  animation: "animation",
  event: "event",
  debug: "debug",
  unknown: "unknown"
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isValueRef(v: GraphNodeValue): v is GraphValueRef {
  return typeof v === "object" && v !== null && "node" in v;
}

function opTail(op: string): string {
  const i = op.lastIndexOf("/");
  return i === -1 ? op : op.slice(i + 1);
}

function signatureOf(graph: InteractivityGraph, typeIndex: number | undefined, warnings: string[], context: string): string | undefined {
  if (typeIndex === undefined) {
    return undefined;
  }
  const decl = graph.types[typeIndex];
  if (!decl) {
    warnings.push(`${context}: type index ${typeIndex} out of range (types table has ${graph.types.length} entries)`);
    return undefined;
  }
  return decl.signature;
}

function configInt(node: InteractivityNode, field: string): number | undefined {
  const v = node.configuration?.[field]?.value;
  return Array.isArray(v) && typeof v[0] === "number" ? v[0] : undefined;
}

function configIntArray(node: InteractivityNode, field: string): number[] {
  const v = node.configuration?.[field]?.value;
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}

function configString(node: InteractivityNode, field: string): string | undefined {
  const v = node.configuration?.[field]?.value;
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
}

function configBool(node: InteractivityNode, field: string): boolean | undefined {
  const v = node.configuration?.[field]?.value;
  return Array.isArray(v) && typeof v[0] === "boolean" ? v[0] : undefined;
}

/** `@gltf-studio/usage-index`'s identical set (mirrored, not imported — this module has zero dependency on that package, same rationale as its own zero-dependency-on-`@gltfi/ir` header comment). */
const HANDLER_OPS = new Set(["event/onSelect", "event/onHoverIn", "event/onHoverOut"]);

// Extracts pointer-template segment names, e.g. "/nodes/[nodeIndex]/translation"
// -> [{name:"nodeIndex", kind:"int"}]; "/materials/{matIndex}/..." -> ref kind.
function pointerTemplateParams(template: string): Array<{ name: string; type: TypeSig }> {
  const out: Array<{ name: string; type: TypeSig }> = [];
  const re = /[[{]([^\]}]+)[\]}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    const name = m[1];
    if (name === undefined) continue;
    const isRef = template[m.index] === "{";
    out.push({ name, type: isRef ? "ref" : "int" });
  }
  return out;
}

// Sockets whose declared type is identical (and concrete) across every
// overload row that mentions them - safe to preset without evidence. A
// socket that's generic in any row, or concrete-but-different across rows,
// is omitted (left for resolveOverload to disambiguate once real evidence -
// literals, config, or propagated edge types - is available).
function invariantConcreteTypes(spec: OpSpec, side: "inputs" | "outputs"): Record<string, TypeSig> {
  const seen = new Map<string, TypeSig | null>();
  for (const row of spec.overloads) {
    for (const socket of side === "inputs" ? row.inputs : row.outputs) {
      if (GENERIC.has(socket.type)) {
        seen.set(socket.name, null);
        continue;
      }
      const type = socket.type as TypeSig;
      if (!seen.has(socket.name)) {
        seen.set(socket.name, type);
      } else if (seen.get(socket.name) !== type) {
        seen.set(socket.name, null);
      }
    }
  }
  const out: Record<string, TypeSig> = {};
  for (const [name, type] of seen) {
    if (type) out[name] = type;
  }
  return out;
}

/** Maps one raw KHR_interactivity graph object to a MappedGraph. Never throws. */
export function mapGraph(graph: InteractivityGraph, graphIndex = 0): MappedGraph {
  const warnings: string[] = [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const declarations = Array.isArray(graph.declarations) ? graph.declarations : [];
  const variables = graph.variables ?? [];
  const events = graph.events ?? [];

  // -- discover inbound references (flow targets, value-ref sources) -------
  const inboundFlowTargets = new Map<number, Set<string>>(); // nodeIndex -> socket names targeted
  const inboundValueSources = new Map<number, Set<string>>(); // nodeIndex -> output socket names referenced

  for (const node of nodes) {
    for (const ref of Object.values(node.flows ?? {})) {
      if (!ref || typeof ref.node !== "number") continue;
      let set = inboundFlowTargets.get(ref.node);
      if (!set) {
        set = new Set();
        inboundFlowTargets.set(ref.node, set);
      }
      set.add(ref.socket);
    }
    for (const v of Object.values(node.values ?? {})) {
      if (v && isValueRef(v)) {
        let set = inboundValueSources.get(v.node);
        if (!set) {
          set = new Set();
          inboundValueSources.set(v.node, set);
        }
        set.add(v.socket ?? "value");
      }
    }
  }

  // -- per-node config-driven type overrides (variable/pointer ops) --------
  // portType key: `${nodeIndex}:${kind}:${name}`
  const portType = new Map<string, string>();
  const key = (nodeIndex: number, kind: PortKind, name: string) => `${nodeIndex}:${kind}:${name}`;

  function variableSignature(varIndex: number | undefined, context: string): string | undefined {
    if (varIndex === undefined) return undefined;
    const v = variables[varIndex];
    if (!v) {
      warnings.push(`${context}: variable index ${varIndex} out of range (${variables.length} declared)`);
      return undefined;
    }
    return signatureOf(graph, v.type, warnings, context);
  }

  nodes.forEach((node, i) => {
    const decl = declarations[node.declaration];
    const op = decl?.op;
    if (!op) return;
    const ctx = `node ${i} (${op})`;

    if (op === "variable/get") {
      const sig = variableSignature(configInt(node, "variable"), ctx);
      if (sig) portType.set(key(i, "value-out", "value"), sig);
    } else if (op === "variable/interpolate") {
      const sig = variableSignature(configInt(node, "variable"), ctx);
      if (sig) portType.set(key(i, "value-in", "value"), sig);
    } else if (op === "variable/set") {
      const varIndices = configIntArray(node, "variables");
      varIndices.forEach((varIndex, slot) => {
        const sig = variableSignature(varIndex, ctx);
        if (sig) portType.set(key(i, "value-in", String(slot)), sig);
      });
    } else if (op === "pointer/get" || op === "pointer/set" || op === "pointer/interpolate") {
      const typeIndex = configInt(node, "type");
      const sig = signatureOf(graph, typeIndex, warnings, ctx);
      if (sig) {
        portType.set(key(i, op === "pointer/get" ? "value-out" : "value-in", "value"), sig);
      }
      const template = configString(node, "pointer");
      if (template) {
        for (const param of pointerTemplateParams(template)) {
          portType.set(key(i, "value-in", param.name), param.type);
        }
      }
    }
  });

  // -- literal type-table lookups feed the resolver as known input types ---
  nodes.forEach((node, i) => {
    for (const [socketName, v] of Object.entries(node.values ?? {})) {
      if (v && !isValueRef(v) && typeof v.type === "number") {
        const sig = signatureOf(graph, v.type, warnings, `node ${i} literal ${socketName}`);
        if (sig && !portType.has(key(i, "value-in", socketName))) {
          portType.set(key(i, "value-in", socketName), sig);
        }
      }
    }
  });

  // -- spec-driven concrete (non-generic) socket types ----------------------
  // Only sockets whose declared type is the SAME concrete type across every
  // overload row are safe to preset here (e.g. math/eq's "value" output is
  // "bool" in all three of its overloads). A socket that varies by overload
  // (e.g. math/eq's "a"/"b", bool in row 0 but int in row 1) must NOT be
  // preset from an arbitrary row - that would silently commit to the wrong
  // overload before any real (literal/config) evidence is in. Those sockets
  // are instead resolved below by resolveOverload once real evidence exists.
  nodes.forEach((node, i) => {
    const decl = declarations[node.declaration];
    const spec = decl ? getOpSpec(decl.op) : undefined;
    if (!spec) return;
    const invariantInputs = invariantConcreteTypes(spec, "inputs");
    const invariantOutputs = invariantConcreteTypes(spec, "outputs");
    for (const [name, type] of Object.entries(invariantInputs)) {
      const k = key(i, "value-in", name);
      if (!portType.has(k)) portType.set(k, type);
    }
    for (const [name, type] of Object.entries(invariantOutputs)) {
      const k = key(i, "value-out", name);
      if (!portType.has(k)) portType.set(k, type);
    }
  });

  // -- overload resolution + value-edge propagation (fixed-point, bounded) -
  const valueEdgesForResolution: Array<{ sn: number; sp: string; tn: number; tp: string }> = [];
  nodes.forEach((node, i) => {
    for (const [socketName, v] of Object.entries(node.values ?? {})) {
      if (v && isValueRef(v)) {
        valueEdgesForResolution.push({ sn: v.node, sp: v.socket ?? "value", tn: i, tp: socketName });
      }
    }
  });

  for (let round = 0; round < 6; round += 1) {
    let changed = false;

    // overload resolution per node from currently-known input types
    nodes.forEach((node, i) => {
      const decl = declarations[node.declaration];
      if (!decl) return;
      const known: Record<string, TypeSig> = {};
      const row = getOpSpec(decl.op)?.overloads[0];
      if (!row) return;
      for (const input of row.inputs) {
        const t = portType.get(key(i, "value-in", input.name));
        if (t) known[input.name] = t as TypeSig;
      }
      if (Object.keys(known).length === 0) return;
      const resolved = resolveOverload(decl.op, known);
      if (!resolved) return;
      for (const [name, t] of Object.entries(resolved.inputs)) {
        const k = key(i, "value-in", name);
        if (!portType.has(k)) {
          portType.set(k, t);
          changed = true;
        }
      }
      for (const [name, t] of Object.entries(resolved.outputs)) {
        const k = key(i, "value-out", name);
        if (!portType.has(k)) {
          portType.set(k, t);
          changed = true;
        }
      }
    });

    // propagate across value edges both directions (edges are same-typed)
    for (const e of valueEdgesForResolution) {
      const sourceKey = key(e.sn, "value-out", e.sp);
      const targetKey = key(e.tn, "value-in", e.tp);
      const sourceType = portType.get(sourceKey);
      const targetType = portType.get(targetKey);
      if (sourceType && !targetType) {
        portType.set(targetKey, sourceType);
        changed = true;
      } else if (targetType && !sourceType) {
        portType.set(sourceKey, targetType);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // -- assemble nodes ---------------------------------------------------
  const mappedNodes: MappedNode[] = nodes.map((node, i) => {
    const decl = declarations[node.declaration];
    const op = decl?.op ?? `<unknown declaration ${node.declaration}>`;
    if (!decl) {
      warnings.push(`node ${i}: declaration index ${node.declaration} out of range`);
    }
    const spec = getOpSpec(op);
    const knownSpec = spec !== undefined;
    if (!knownSpec) {
      warnings.push(`node ${i}: op "${op}" not in kernel registry (unknown/extension op)`);
    }
    const category: OpCategory | "unknown" = spec?.category ?? "unknown";

    const valueInNames = new Set<string>(spec?.overloads[0]?.inputs.map((s) => s.name) ?? []);
    Object.keys(node.values ?? {}).forEach((n) => valueInNames.add(n));

    const valueOutNames = new Set<string>(spec?.overloads[0]?.outputs.map((s) => s.name) ?? []);
    for (const n of inboundValueSources.get(i) ?? []) valueOutNames.add(n);

    const flowOutNames = new Set<string>(spec?.outputFlows ?? []);
    Object.keys(node.flows ?? {}).forEach((n) => flowOutNames.add(n));

    const flowInNames = new Set<string>(spec?.inputFlows ?? []);
    for (const n of inboundFlowTargets.get(i) ?? []) flowInNames.add(n);

    const literals: Record<string, MappedLiteral> = {};
    for (const [socketName, v] of Object.entries(node.values ?? {})) {
      if (v && !isValueRef(v)) {
        literals[socketName] = {
          type: signatureOf(graph, v.type, warnings, `node ${i} literal ${socketName}`),
          value: v.value ?? []
        };
        // literals occupy a value-in port slot too, so they show up in the
        // port list even when spec doesn't declare that socket.
        valueInNames.add(socketName);
      }
    }

    const ports: MappedPort[] = [];
    for (const name of flowInNames) ports.push({ id: `flow-in:${name}`, name, kind: "flow-in" });
    for (const name of flowOutNames) ports.push({ id: `flow-out:${name}`, name, kind: "flow-out" });
    for (const name of valueInNames) {
      ports.push({ id: `value-in:${name}`, name, kind: "value-in", type: portType.get(key(i, "value-in", name)) });
    }
    for (const name of valueOutNames) {
      ports.push({ id: `value-out:${name}`, name, kind: "value-out", type: portType.get(key(i, "value-out", name)) });
    }

    const subtitleResult = nodeSubtitle(graph, node, op, warnings, i);
    const handlerTarget = HANDLER_OPS.has(op)
      ? { nodeIndex: configInt(node, "nodeIndex") ?? -1, stopPropagation: configBool(node, "stopPropagation") ?? false }
      : undefined;

    return {
      index: i,
      op,
      category,
      label: opTail(op),
      subtitle: subtitleResult?.text,
      subtitleMissing: subtitleResult?.missing,
      handlerTarget,
      knownSpec,
      ports,
      literals,
      raw: node
    };
  });

  // -- assemble edges -----------------------------------------------------
  const edges: MappedEdge[] = [];
  nodes.forEach((node, i) => {
    for (const [socketName, ref] of Object.entries(node.flows ?? {})) {
      if (!ref || typeof ref.node !== "number") continue;
      edges.push({
        id: `flow:${i}:${socketName}->${ref.node}:${ref.socket}`,
        kind: "flow",
        sourceNode: i,
        sourcePort: `flow-out:${socketName}`,
        targetNode: ref.node,
        targetPort: `flow-in:${ref.socket}`
      });
    }
    for (const [socketName, v] of Object.entries(node.values ?? {})) {
      if (v && isValueRef(v)) {
        const sourceSocket = v.socket ?? "value";
        edges.push({
          id: `value:${v.node}:${sourceSocket}->${i}:${socketName}`,
          kind: "value",
          sourceNode: v.node,
          sourcePort: `value-out:${sourceSocket}`,
          targetNode: i,
          targetPort: `value-in:${socketName}`,
          type: portType.get(key(v.node, "value-out", sourceSocket)) ?? portType.get(key(i, "value-in", socketName))
        });
      }
    }
  });

  return {
    graphIndex,
    nodeCount: mappedNodes.length,
    edgeCount: edges.length,
    variableCount: variables.length,
    eventCount: events.length,
    nodes: mappedNodes,
    edges,
    warnings
  };
}

type SubtitleResult = { text: string; missing?: boolean };

/**
 * A `variables[idx]`/`events[idx]` lookup out of range is a DANGLING
 * reference (the index itself no longer exists in the graph's own table,
 * e.g. after some future variable-removal feature) — distinct from a
 * perfectly valid entry that simply has no `id` set, which is a normal,
 * anonymous declaration, not an error. Only the former gets the `⚠ missing`
 * treatment (`missing: true`) other dangling-reference surfaces in this
 * package/`@gltf-studio/editor-core`'s `fixup-references.ts` use.
 */
function declRef(idx: number, entry: { id?: string } | undefined, fallbackPrefix: string): SubtitleResult {
  if (!entry) return { text: `⚠ missing (${fallbackPrefix}#${idx})`, missing: true };
  return { text: entry.id ?? `${fallbackPrefix}#${idx}` };
}

function nodeSubtitle(
  graph: InteractivityGraph,
  node: InteractivityNode,
  op: string,
  warnings: string[],
  nodeIndex: number
): SubtitleResult | undefined {
  const variables = graph.variables ?? [];
  const events = graph.events ?? [];
  const ctx = `node ${nodeIndex} (${op})`;

  if (op === "variable/get" || op === "variable/interpolate") {
    const idx = configInt(node, "variable");
    if (idx === undefined) return undefined;
    return declRef(idx, variables[idx], "var");
  }
  if (op === "variable/set") {
    const indices = configIntArray(node, "variables");
    if (indices.length === 0) return undefined;
    const parts = indices.map((idx) => declRef(idx, variables[idx], "var"));
    return { text: parts.map((p) => p.text).join(", "), missing: parts.some((p) => p.missing) };
  }
  if (op === "event/send" || op === "event/receive") {
    const idx = configInt(node, "event");
    if (idx === undefined) return undefined;
    if (!events[idx]) {
      warnings.push(`${ctx}: event index ${idx} out of range (${events.length} declared)`);
    }
    return declRef(idx, events[idx], "event");
  }
  if (op === "pointer/get" || op === "pointer/set" || op === "pointer/interpolate") {
    const text = configString(node, "pointer");
    return text === undefined ? undefined : { text };
  }
  return undefined;
}
