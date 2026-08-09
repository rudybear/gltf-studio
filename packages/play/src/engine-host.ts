// Internal (not exported from index.ts) interpreter/compiled engine
// construction, mirroring gltf-interactivity's apps/viewer
// compiled-loader.ts + engine-host.ts pattern: resolveGraph (@gltfi/runtime)
// -> importGraph -> checkModule (@gltfi/ir) -> emitModule(flavor:"js")
// (@gltfi/emit-ts) -> a `blob:` module URL -> dynamic import() -> the
// module's default-exported EngineFactory -> factory(options) -> a running
// engine. Both engine kinds end up as the exact same `EngineInteractive`
// surface (@gltfi/runtime's InteractivityRuntime.asEngineLike() for the
// interpreter, @gltfi/runtime-lib's EngineFactory result for compiled), so
// play-controller.ts never has to branch on engine kind beyond the single
// call to createEngineHost below (PC-008's "pointer routing is identical
// across both engine kinds" note applies here too).
import { resolveGraph, InteractivityRuntime, type Graph as InterpGraph } from "@gltfi/runtime";
import type { EngineInteractive } from "@gltfi/runtime";
import { importGraph, checkModule, type Graph as IrGraph } from "@gltfi/ir";
import { emitModule, EmitError } from "@gltfi/emit-ts";
import type { EngineFactory } from "@gltfi/runtime-lib";
import type { EngineKind } from "@gltf-studio/engine-api";

/** Matches SceneAdapter.applyPointer / EngineOptions.onPointerSet's exact value union — both engines agree on this shape. */
export type PointerFanOut = (pointer: string, value: number[] | boolean[] | number | boolean) => void;

export interface EngineHost {
  /** The resolved KHR_interactivity graph (graphs[0]) — PC-002's inspect() needs its `variables[i].id` for the id-vs-index fallback. */
  readonly graph: InterpGraph;
  readonly engine: EngineInteractive;
}

/**
 * Reads `documentJson.extensions.KHR_interactivity.graphs[0]` and rejects
 * with a clear, specific `Error` when it's missing — rather than letting a
 * malformed document fall all the way into `resolveGraph`/`importGraph` and
 * surface whatever internal error they happen to throw first.
 */
function resolveGraphOrThrow(documentJson: unknown): InterpGraph {
  const graph = (documentJson as { extensions?: { KHR_interactivity?: { graphs?: unknown[] } } } | null | undefined)
    ?.extensions?.KHR_interactivity?.graphs?.[0];
  if (!graph) {
    throw new Error(
      "PlayController.start: the document has no extensions.KHR_interactivity.graphs[0] to run."
    );
  }
  return resolveGraph(documentJson);
}

/** PC-001/PC-004: builds whichever engine kind `start({engine})` asked for, bound to the fan-out `SceneAdapter`/`onPointerSet`. */
export async function createEngineHost(
  kind: EngineKind,
  documentJson: unknown,
  binary: ArrayBuffer | Uint8Array | undefined,
  fanOut: PointerFanOut
): Promise<EngineHost> {
  const graph = resolveGraphOrThrow(documentJson);
  if (kind === "interpreter") {
    const runtime = new InteractivityRuntime(graph, documentJson, binary ?? null);
    runtime.bindAdapter({ applyPointer: fanOut });
    return { graph, engine: runtime.asEngineLike() };
  }
  const engine = await buildCompiledEngine(graph, documentJson, binary, fanOut);
  return { graph, engine };
}

async function buildCompiledEngine(
  graph: InterpGraph,
  documentJson: unknown,
  binary: ArrayBuffer | Uint8Array | undefined,
  fanOut: PointerFanOut
): Promise<EngineInteractive> {
  // @gltfi/runtime's Graph and @gltfi/ir's Graph are two independently
  // declared but structurally identical types — no KHR_interactivity-graph
  // shape conversion actually happens here, just a type-system formality
  // (see gltf-interactivity's packages/conformance/src/run-compiled.ts for
  // the same cast).
  const { module, diagnostics } = importGraph(graph as unknown as IrGraph);
  const importErrors = diagnostics.filter((d) => d.severity === "error");
  if (importErrors.length > 0) {
    throw new Error(`PlayController.start: graph -> IR import errors: ${JSON.stringify(importErrors)}`);
  }
  const checkErrors = checkModule(module).filter((d) => d.severity === "error");
  if (checkErrors.length > 0) {
    throw new Error(`PlayController.start: IR check errors: ${JSON.stringify(checkErrors)}`);
  }
  let code: string;
  try {
    code = emitModule(module, { flavor: "js" }).code;
  } catch (err) {
    const message = err instanceof EmitError ? err.message : err instanceof Error ? err.message : String(err);
    throw new Error(`PlayController.start: emit-ts could not compile this graph to JS: ${message}`);
  }
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    // @vite-ignore: this specifier is a runtime-computed blob: URL, never a
    // static string a bundler could analyze/pre-bundle.
    const mod = (await import(/* @vite-ignore */ blobUrl)) as { default?: EngineFactory };
    if (typeof mod.default !== "function") {
      throw new Error("PlayController.start: compiled module has no default-exported EngineFactory.");
    }
    return mod.default({ gltf: documentJson, glbBin: binary, onPointerSet: fanOut });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
