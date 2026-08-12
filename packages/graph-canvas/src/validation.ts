// Validation overlay pipeline: runs the vendored @gltfi/ir importer +
// invariant checker, plus @gltfi/verify's structural validator, over the
// raw KHR_interactivity graph JSON, and joins every diagnostic that can be
// attributed to a source node back to that node's INDEX (never canvas
// position, per UX-506) so a red corner badge/tooltip can be attached to the
// right OpNode even after a re-layout moves it around.
//
// Three diagnostic sources, merged:
//  - @gltfi/verify's validateGraph: structural invariants directly over the
//    graph JSON (out-of-range indices, missing required config, ...) —
//    nearly every diagnostic already carries a `nodeIndex`.
//  - @gltfi/ir's importGraph: graph -> IR raising; also emits `nodeIndex`
//    diagnostics for things it had to guess/default (unresolved types,
//    cross-context reads lowered to intrinsics, ...).
//  - @gltfi/ir's checkModule: IR-level invariant checks (unknown ops, arg
//    type mismatches, proc-call cycles, ...) — these operate on the
//    already-lowered IR and never carry a `nodeIndex`; still surfaced (e.g.
//    in a console-tab line) but can't drive a per-node badge.
//
// Never throws: a validator crashing on a malformed/mid-edit graph must not
// take down the canvas — any thrown error is captured as a single
// diagnostic instead (mirrors map-graph.ts's own "never throws" contract).
import { importGraph, checkModule, type Diagnostic, type Graph as IRGraph } from "@gltfi/ir";
import { validateGraph, type VGraph } from "@gltfi/verify";

export type DiagnosticSource = "structural" | "import" | "check" | "doc";

export type GraphDiagnostic = Diagnostic & { source: DiagnosticSource };

export type ValidationResult = {
  ok: boolean;
  diagnostics: GraphDiagnostic[];
  /** Diagnostics keyed by the graph node index they were attributed to (UX-506: identity, never position). */
  byNodeIndex: Map<number, GraphDiagnostic[]>;
  /** Diagnostics with no attributable node index (checkModule's IR-level findings). */
  unindexed: GraphDiagnostic[];
};

// Minimal structural shapes for the doc-level handler-target check below —
// mirrors `@gltf-studio/usage-index`'s own minimal-shape convention (not
// imported: this module has no dependency on that package, nor on
// `map-graph.ts`'s richer `InteractivityGraph`, keeping this check usable
// against the exact same raw JSON `validateGraph`/`importGraph` above take).
interface HandlerCheckNode {
  declaration: number;
  configuration?: Record<string, { value?: Array<number | boolean | string> } | undefined>;
}
interface HandlerCheckGraph {
  declarations?: Array<{ op: string }>;
  nodes?: HandlerCheckNode[];
}

const HANDLER_OPS = new Set(["event/onSelect", "event/onHoverIn", "event/onHoverOut"]);

/**
 * Task ("handler nodes show their target"): `@gltfi/verify`'s `validateGraph`
 * only ever sees the isolated `KHR_interactivity` graph object — it has no
 * way to know how many scene nodes the actual glTF document has, so it can
 * never flag a handler's `configuration.nodeIndex` as dangling (e.g. after
 * `SceneEdit.removeNode`'s DOC-049 "left dangling, not repaired" policy
 * deletes the scene node a handler was scoped to). This is the one check in
 * this pipeline that DOES have that document-level context — supplied by the
 * caller (`graph-canvas.tsx`) as `sceneNodeCount`, never assumed. Severity is
 * `warning`, not `error`: a dangling handler target is a real authoring bug
 * (that handler will now scope to nothing, per the registry's own
 * out-of-range-is-inert runtime behavior) but not a structurally invalid
 * graph the way `validateGraph`'s own findings are.
 */
function checkHandlerTargets(rawGraph: HandlerCheckGraph, sceneNodeCount: number): Diagnostic[] {
  const declarations = rawGraph.declarations ?? [];
  const out: Diagnostic[] = [];
  (rawGraph.nodes ?? []).forEach((node, nodeIndex) => {
    const op = declarations[node.declaration]?.op;
    if (!op || !HANDLER_OPS.has(op)) return;
    const raw = node.configuration?.nodeIndex?.value?.[0];
    const target = typeof raw === "number" ? raw : -1;
    if (target === -1) return; // the registry's own "any node" sentinel — never a dangling reference (@gltf-studio/usage-index's identical convention).
    if (target < 0 || target >= sceneNodeCount) {
      out.push({
        severity: "warning",
        code: "GCANVAS-HANDLER-TARGET-MISSING",
        message: `${op} node ${nodeIndex}: target scene node #${target} does not exist (document has ${sceneNodeCount} scene node(s)) — this handler will never fire.`,
        nodeIndex
      });
    }
  });
  return out;
}

function safeRun(source: DiagnosticSource, fn: () => Diagnostic[]): GraphDiagnostic[] {
  try {
    return fn().map((d) => ({ ...d, source }));
  } catch (err) {
    return [
      {
        severity: "error",
        code: "GCANVAS-VALIDATOR-THREW",
        message: `${source} validator threw: ${err instanceof Error ? err.message : String(err)}`,
        source
      }
    ];
  }
}

/**
 * Runs the full validation pipeline over one raw KHR_interactivity graph JSON
 * object. `sceneNodeCount` (the document's `json.nodes.length`, when the
 * caller has one — `@gltf-studio/graph-canvas`'s `graph-canvas.tsx` always
 * does) additionally runs `checkHandlerTargets` above; omitted by callers
 * with no document context (e.g. `packages/agent-mock`'s `validate.ts`,
 * which only ever validates a graph in isolation), in which case this
 * doc-level check is simply skipped — every other diagnostic source is
 * unaffected either way.
 */
export function validateInteractivityGraph(rawGraph: unknown, sceneNodeCount?: number): ValidationResult {
  const diagnostics: GraphDiagnostic[] = [];

  diagnostics.push(...safeRun("structural", () => validateGraph(rawGraph as VGraph).diagnostics));
  if (sceneNodeCount !== undefined) {
    diagnostics.push(...safeRun("doc", () => checkHandlerTargets(rawGraph as HandlerCheckGraph, sceneNodeCount)));
  }

  let irModule: ReturnType<typeof importGraph>["module"] | undefined;
  diagnostics.push(
    ...safeRun("import", () => {
      const result = importGraph(rawGraph as IRGraph);
      irModule = result.module;
      return result.diagnostics;
    })
  );
  if (irModule) {
    const module = irModule;
    diagnostics.push(...safeRun("check", () => checkModule(module)));
  }

  const byNodeIndex = new Map<number, GraphDiagnostic[]>();
  const unindexed: GraphDiagnostic[] = [];
  for (const d of diagnostics) {
    if (d.nodeIndex !== undefined) {
      const list = byNodeIndex.get(d.nodeIndex);
      if (list) {
        list.push(d);
      } else {
        byNodeIndex.set(d.nodeIndex, [d]);
      }
    } else {
      unindexed.push(d);
    }
  }

  return { ok: diagnostics.every((d) => d.severity !== "error"), diagnostics, byNodeIndex, unindexed };
}
