// Pure derived view (specs/ux-usage-mapping.md UX-1100..1105): entity ->
// which KHR_interactivity behavior-graph nodes reference it. No React, no
// RenderHost, no document mutation — a plain function over glTF JSON,
// memoized by IDENTITY at the call site (packages/app's Inspector.tsx keys a
// `useMemo` on `document.json`, the same identity-based memoization
// `@gltf-studio/graph-canvas`'s `mapGraph`/`buildPointerContentTree` already
// use — editor-core's patches always produce a fresh top-level `json`
// object on every edit, so this module needs no cache of its own; see
// UX-1113).
//
// Three source families a behavior-graph node can carry a scene-node
// reference through (UX-1100..1103):
//   - pointer/get|set|interpolate's `configuration.pointer` (a JSON Pointer
//     Template, @gltfi/kernel's parsePointerTemplate) whose resolved path
//     starts with `/nodes/{N}` — component suffixes (e.g. `/translation/1`)
//     don't change which node is referenced — or an
//     `/extensions/KHR_audio/emitters/{E}` pointer, reverse-resolved to the
//     scene node whose `KHR_audio_emitter` extension owns emitter `{E}`.
//   - event/onSelect|onHoverIn|onHoverOut's `configuration.nodeIndex` (a
//     literal int; the `-1` "any node" default is never attributed).
//   - animation/start|stop|stopAt's `animation` VALUE (a literal ref index,
//     not a `configuration` field — same convention `graph-canvas`'s
//     `handleSetAnimationValue` already uses), reverse-resolved to every
//     scene node targeted by that animation's own `channels[].target.node`.
//
// A reference this module cannot resolve with certainty (an unrecognized
// pointer family, a template parameter fed by a computed value-ref instead
// of a literal, an out-of-range animation/emitter index) is OMITTED, not
// guessed at (UX-1105) — the same "honest gap" convention
// packages/app/src/lib/pointer-vocab.ts's own header comment documents.
import { parsePointerTemplate } from "@gltfi/kernel";

// ---------------------------------------------------------------------------
// Minimal structural JSON shapes. Deliberately NOT importing packages/app's
// richer `GltfJsonShape` (this package sits BELOW packages/app in the
// dependency graph — graph-canvas and app both depend on this, not the
// reverse) — TypeScript's structural typing means any caller's real glTF
// JSON document satisfies this shape without a cast.
// ---------------------------------------------------------------------------

export interface UsageGraphValueLiteral {
  type?: number;
  value?: Array<number | boolean | string>;
}
export interface UsageGraphValueRef {
  node: number;
  socket?: string;
}
export type UsageGraphNodeValue = UsageGraphValueLiteral | UsageGraphValueRef;

export interface UsageGraphFlowRef {
  node: number;
  socket?: string;
}

export interface UsageGraphNode {
  declaration: number;
  configuration?: Record<string, { value?: Array<number | boolean | string> } | undefined>;
  values?: Record<string, UsageGraphNodeValue | undefined>;
  /** Outgoing flow-out sockets (`@gltf-studio/graph-canvas`'s `map-graph.ts` reads the identical field). Only used here by `findEnclosingHandlerRoot`'s reverse walk. */
  flows?: Record<string, UsageGraphFlowRef | undefined>;
}

export interface UsageGraphDeclaration {
  op: string;
}

export interface UsageInteractivityGraph {
  declarations?: UsageGraphDeclaration[];
  nodes?: UsageGraphNode[];
}

export interface UsageAnimationChannel {
  target?: { node?: number };
}
export interface UsageAnimation {
  name?: string;
  channels?: UsageAnimationChannel[];
}

export interface UsageDocJson {
  nodes?: Array<{ extensions?: { KHR_audio_emitter?: { emitter?: number } } }>;
  animations?: UsageAnimation[];
  extensions?: {
    KHR_interactivity?: { graphs?: UsageInteractivityGraph[] };
  };
}

export type UsageRefKind = "pointer" | "event-handler" | "animation";

export interface UsageRef {
  graphIndex: number;
  /** Index within `graph.nodes` — NOT the scene-node index this ref is filed under. */
  graphNodeIndex: number;
  op: string;
  /** `op`'s category prefix, e.g. "pointer", "event", "animation". */
  category: string;
  kind: UsageRefKind;
  /** UX-1106 row text: the pointer path, "nodeIndex: N", or "animation: N (name)". */
  pathText: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isValueRef(v: UsageGraphNodeValue | undefined): v is UsageGraphValueRef {
  return !!v && typeof v === "object" && "node" in v && typeof (v as UsageGraphValueRef).node === "number";
}

function literalNumber(node: UsageGraphNode, field: string): number | undefined {
  const raw = node.configuration?.[field]?.value?.[0];
  return typeof raw === "number" ? raw : undefined;
}

function literalString(node: UsageGraphNode, field: string): string | undefined {
  const raw = node.configuration?.[field]?.value?.[0];
  return typeof raw === "string" ? raw : undefined;
}

/** A `values[socket]` entry, only when it's a LITERAL (never a value-ref edge — a computed input has no static answer, UX-1105). */
function literalValueNumber(node: UsageGraphNode, socket: string): number | undefined {
  const v = node.values?.[socket];
  if (!v || isValueRef(v)) return undefined;
  const raw = (v as UsageGraphValueLiteral).value?.[0];
  return typeof raw === "number" ? raw : undefined;
}

function buildEmitterOwners(json: UsageDocJson): Map<number, number> {
  const owners = new Map<number, number>();
  (json.nodes ?? []).forEach((n, sceneNodeIndex) => {
    const emitter = n.extensions?.KHR_audio_emitter?.emitter;
    if (typeof emitter === "number" && !owners.has(emitter)) owners.set(emitter, sceneNodeIndex);
  });
  return owners;
}

/**
 * Resolves a (possibly templated) pointer to a concrete path. Only
 * int-kind template params (`parsePointerTemplate`'s `[name]` segments —
 * `{name}` ref-kind params never address `/nodes` this way) backed by a
 * LITERAL `values` entry of the same name are substituted; any other
 * param (unresolved, or fed by a value-ref edge computed at runtime)
 * makes the whole pointer unresolvable (UX-1105) rather than guessed at.
 */
function resolveConcretePointer(template: string, node: UsageGraphNode): string | null {
  const params = parsePointerTemplate(template);
  if (params.length === 0) return template;
  let out = template;
  for (const param of params) {
    if (param.kind !== "int") return null;
    const literal = literalValueNumber(node, param.name);
    if (literal === undefined) return null;
    out = out.replace(`[${param.name}]`, String(literal));
  }
  return out;
}

const POINTER_OPS = new Set(["pointer/get", "pointer/set", "pointer/interpolate"]);
const HANDLER_OPS = new Set(["event/onSelect", "event/onHoverIn", "event/onHoverOut"]);
const ANIMATION_OPS = new Set(["animation/start", "animation/stop", "animation/stopAt"]);

/**
 * UX-1100/UX-1101/UX-1103: resolves the single scene-node index a
 * pointer/handler graph node addresses, or `null`. Exported so
 * `@gltf-studio/graph-canvas`'s node-details "Reveal in viewport"
 * (UX-1111) and its selection-driven reference highlight (UX-1110) reuse
 * the EXACT same resolution rule `buildUsageIndex` is built from below —
 * one derivation, not two independently-maintained copies. Returns `null`
 * for `animation/*` ops (UX-1102's multi-target case has no single
 * "the" scene node — see `buildUsageIndex`/`animationSceneRefs` for that
 * family instead).
 */
export function graphNodeSceneRef(op: string, node: UsageGraphNode, json: UsageDocJson, emitterOwners?: Map<number, number>): number | null {
  if (HANDLER_OPS.has(op)) {
    const target = literalNumber(node, "nodeIndex");
    return target !== undefined && target >= 0 ? target : null;
  }
  if (POINTER_OPS.has(op)) {
    const template = literalString(node, "pointer");
    if (!template) return null;
    const resolved = resolveConcretePointer(template, node);
    if (!resolved) return null;
    const nodeMatch = /^\/nodes\/(\d+)(?:\/|$)/.exec(resolved);
    if (nodeMatch) return Number(nodeMatch[1]);
    const audioMatch = /^\/extensions\/KHR_audio\/emitters\/(\d+)(?:\/|$)/.exec(resolved);
    if (audioMatch) {
      const owners = emitterOwners ?? buildEmitterOwners(json);
      return owners.get(Number(audioMatch[1])) ?? null;
    }
    return null;
  }
  return null;
}

/** UX-1102: every distinct scene node targeted by an animation/start|stop|stopAt node's clip, or `[]` when unresolvable. */
function animationSceneRefs(node: UsageGraphNode, json: UsageDocJson): number[] {
  const animIndex = literalValueNumber(node, "animation");
  if (animIndex === undefined) return [];
  const anim = json.animations?.[animIndex];
  if (!anim) return [];
  const targets = new Set<number>();
  for (const ch of anim.channels ?? []) {
    if (typeof ch.target?.node === "number") targets.add(ch.target.node);
  }
  return [...targets];
}

/** UX-1106's row path/config text, one rule per op family. */
export function usageRefPathText(op: string, node: UsageGraphNode, json: UsageDocJson): string {
  if (HANDLER_OPS.has(op)) {
    const target = literalNumber(node, "nodeIndex");
    return `nodeIndex: ${target ?? "?"}`;
  }
  if (POINTER_OPS.has(op)) return literalString(node, "pointer") ?? "(no pointer set)";
  if (ANIMATION_OPS.has(op)) {
    const animIndex = literalValueNumber(node, "animation");
    const anim = animIndex !== undefined ? json.animations?.[animIndex] : undefined;
    return `animation: ${animIndex ?? "?"}${anim?.name ? ` (${anim.name})` : ""}`;
  }
  return op;
}

/**
 * UX-1100..1105: the full document -> per-scene-node usage index.
 * UX-1104: every graph in `extensions.KHR_interactivity.graphs[]` is
 * covered (never just graph 0), each ref recording its own `graphIndex`.
 * Returns an empty map for a document with no `KHR_interactivity` graphs
 * at all (never throws).
 */
export function buildUsageIndex(json: UsageDocJson): Map<number, UsageRef[]> {
  const result = new Map<number, UsageRef[]>();
  const graphs = json.extensions?.KHR_interactivity?.graphs ?? [];
  if (graphs.length === 0) return result;
  const emitterOwners = buildEmitterOwners(json);

  function addRef(sceneNodeIndex: number, ref: UsageRef): void {
    const list = result.get(sceneNodeIndex);
    if (list) list.push(ref);
    else result.set(sceneNodeIndex, [ref]);
  }

  graphs.forEach((graph, graphIndex) => {
    const declarations = graph.declarations ?? [];
    (graph.nodes ?? []).forEach((node, graphNodeIndex) => {
      const op = declarations[node.declaration]?.op;
      if (!op) return;
      const category = op.split("/")[0] ?? op;

      if (ANIMATION_OPS.has(op)) {
        for (const sceneNodeIndex of animationSceneRefs(node, json)) {
          addRef(sceneNodeIndex, { graphIndex, graphNodeIndex, op, category, kind: "animation", pathText: usageRefPathText(op, node, json) });
        }
        return;
      }

      const sceneRef = graphNodeSceneRef(op, node, json, emitterOwners);
      if (sceneRef === null) return;
      addRef(sceneRef, {
        graphIndex,
        graphNodeIndex,
        op,
        category,
        kind: HANDLER_OPS.has(op) ? "event-handler" : "pointer",
        pathText: usageRefPathText(op, node, json)
      });
    });
  });

  return result;
}

/** Convenience empty-array default for a component reading `index.get(nodeIndex)`. */
export const NO_USAGE_REFS: UsageRef[] = [];

const HANDLER_ROOT_OPS = new Set(["event/onStart", "event/onTick", "event/receive", "event/onSelect", "event/onHoverIn", "event/onHoverOut"]);

/**
 * specs/ux-usage-mapping.md UX-1108's Script-jump: a best-effort backward
 * flow-predecessor walk from `nodeIndex` to the nearest event/* handler root
 * that eventually flows into it. Used only to disambiguate WHICH of several
 * identical text occurrences (`@gltf-studio/script-panel`'s cross-highlight
 * pointer-path fallback, for a `pointer/set`/`pointer/interpolate` node with
 * no `sourceNodeIds` entry of its own — see that module's header comment) is
 * the one belonging to this reference's own graph context, when the exact
 * same pointer path string happens to be set from more than one place in the
 * graph. This is a disambiguation HINT, not a correctness guarantee (UX-1105's
 * "honest gap" convention): a node reachable from more than one handler (a
 * shared proc branch) resolves to whichever predecessor this bounded
 * breadth-first walk visits first — a stable, deterministic choice, not a
 * claim that it's the "right" one when the graph is genuinely ambiguous.
 * Returns `null` when no handler root is reachable within the step budget
 * (e.g. an orphaned/unreachable node) or when `nodeIndex` is itself a
 * handler root already carries no predecessor to walk to.
 */
export function findEnclosingHandlerRoot(graph: UsageInteractivityGraph, nodeIndex: number): number | null {
  const declarations = graph.declarations ?? [];
  const nodes = graph.nodes ?? [];

  const predecessors = new Map<number, number[]>();
  nodes.forEach((node, sourceIndex) => {
    for (const ref of Object.values(node.flows ?? {})) {
      if (!ref || typeof ref.node !== "number") continue;
      const list = predecessors.get(ref.node);
      if (list) list.push(sourceIndex);
      else predecessors.set(ref.node, [sourceIndex]);
    }
  });

  const MAX_STEPS = 5000; // generous bound — well above even the racer demo's node count, guards against a malformed cyclic graph spinning forever.
  const seen = new Set<number>([nodeIndex]);
  let frontier = [nodeIndex];
  let steps = 0;
  while (frontier.length > 0 && steps < MAX_STEPS) {
    const next: number[] = [];
    for (const current of frontier) {
      for (const predecessor of predecessors.get(current) ?? []) {
        steps += 1;
        if (seen.has(predecessor)) continue;
        seen.add(predecessor);
        const op = declarations[nodes[predecessor]?.declaration ?? -1]?.op;
        if (op && HANDLER_ROOT_OPS.has(op)) return predecessor;
        next.push(predecessor);
      }
    }
    frontier = next;
  }
  return null;
}
