// Drives the EQUIV/DIVERGED badge (specs/ux-script.md UX-703/UX-710): the
// UI's own job is only to DISPLAY the result of `@gltfi/verify`'s
// equivalence-verification tooling (UX-703's own citation of `AG-007`), not
// to reimplement it — this module is a thin wrapper that shapes that
// tooling's inputs/outputs for ScriptPanel, nothing more.
import { exportGraph, type Graph, type IRModule } from "@gltfi/ir";
import { compareDeclarations, equivalentGraphs, type VGraph } from "@gltfi/verify";

export type EquivalenceResult =
  | { status: "equiv" }
  | { status: "diverged"; firstDivergence?: string; declarationChanges: string[] };

/**
 * Compares the document's current graph against a freshly parsed module's
 * re-exported graph. `Graph` (import.ts) and `GraphJson` (export.ts) are
 * both structurally assignable to `@gltfi/verify`'s `VGraph` — same field
 * shapes, `VGraph`'s just optional where the others are required/optional
 * in slightly different combinations — so no adapter object is needed
 * beyond the cast.
 */
export function checkEquivalence(documentGraph: Graph, parsedModule: IRModule): EquivalenceResult {
  const exported = exportGraph(parsedModule);
  const a = documentGraph as unknown as VGraph;
  const b = exported.graph as unknown as VGraph;
  const result = equivalentGraphs(a, b);
  if (result.equivalent) return { status: "equiv" };
  const declarations = compareDeclarations(a, b);
  return { status: "diverged", firstDivergence: result.firstDivergence, declarationChanges: declarations.changes };
}
