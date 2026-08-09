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

export type DiagnosticSource = "structural" | "import" | "check";

export type GraphDiagnostic = Diagnostic & { source: DiagnosticSource };

export type ValidationResult = {
  ok: boolean;
  diagnostics: GraphDiagnostic[];
  /** Diagnostics keyed by the graph node index they were attributed to (UX-506: identity, never position). */
  byNodeIndex: Map<number, GraphDiagnostic[]>;
  /** Diagnostics with no attributable node index (checkModule's IR-level findings). */
  unindexed: GraphDiagnostic[];
};

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

/** Runs the full validation pipeline over one raw KHR_interactivity graph JSON object. */
export function validateInteractivityGraph(rawGraph: unknown): ValidationResult {
  const diagnostics: GraphDiagnostic[] = [];

  diagnostics.push(...safeRun("structural", () => validateGraph(rawGraph as VGraph).diagnostics));

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
