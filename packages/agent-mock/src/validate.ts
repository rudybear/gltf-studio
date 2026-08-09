// AG-006: runs the same three-source validation pipeline
// `packages/graph-canvas/src/validation.ts`'s `validateInteractivityGraph`
// runs (`@gltfi/verify`'s `validateGraph`, `@gltfi/ir`'s `importGraph` +
// `checkModule`), reimplemented here in ~30 lines rather than imported.
//
// Deliberately NOT importing `@gltf-studio/graph-canvas`: that package's
// `index.ts` pulls in React/`@xyflow/react`/`elkjs` as real (non-peer)
// runtime imports for its canvas component, even though React itself is
// only a peerDependency — importing anything from that package's public
// surface drags that whole dependency graph in. `@gltf-studio/agent-mock`
// must stay usable in a plain Node context (no DOM, no bundler) since it is
// exercised by contract tests today and, if a headless/CLI Copilot path is
// ever added, could run outside a browser entirely. Duplicating this one
// small pipeline is an accepted, deliberate tradeoff for that boundary.
import { checkModule, importGraph, type Diagnostic, type Graph as IRGraph } from "@gltfi/ir";
import { validateGraph, type VGraph } from "@gltfi/verify";
import type { ValidationReport } from "@gltf-studio/engine-api";
import { getIn } from "@gltf-studio/editor-core";

function toFinding(d: Diagnostic, graphIndex: number): ValidationReport["findings"][number] {
  return {
    severity: d.severity,
    message: `${d.code}: ${d.message}`,
    ...(d.nodeIndex !== undefined
      ? { pointer: `/extensions/KHR_interactivity/graphs/${graphIndex}/nodes/${d.nodeIndex}` }
      : {})
  };
}

/**
 * Validates one `extensions.KHR_interactivity.graphs[graphIndex]` (against
 * the SCRATCH `json` a proposal's commands were previewed onto — never the
 * real document). Templates that don't touch the interactivity graph (e.g.
 * a direct `SceneEdit.setTransform`-only "move" proposal) can skip calling
 * this entirely and return `{ findings: [] }` directly — there is nothing
 * for it to meaningfully validate in that case, and this function has
 * nothing to run if no graph exists at `graphIndex` (returns no findings
 * rather than an error, since "no graph" isn't itself a validity problem
 * for a proposal that never claimed to touch one).
 */
export function validateProposalGraph(json: unknown, graphIndex: number): ValidationReport {
  const graph = getIn(json, ["extensions", "KHR_interactivity", "graphs", graphIndex]);
  if (graph === undefined) {
    return { findings: [] };
  }

  const findings: ValidationReport["findings"] = [];
  const safe = (label: string, fn: () => Diagnostic[]) => {
    try {
      for (const d of fn()) findings.push(toFinding(d, graphIndex));
    } catch (err) {
      findings.push({ severity: "error", message: `${label} threw: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  safe("structural validator", () => validateGraph(graph as VGraph).diagnostics);

  let irModule: ReturnType<typeof importGraph>["module"] | undefined;
  safe("import", () => {
    const result = importGraph(graph as IRGraph);
    irModule = result.module;
    return result.diagnostics;
  });
  if (irModule) {
    const module = irModule;
    safe("checkModule", () => checkModule(module));
  }

  return { findings };
}
