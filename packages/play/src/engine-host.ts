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
//
// PC-009 (docs/adr/0006-devtools-script-debugging.md): when `debug` is set
// (compiled engine only), buildCompiledEngine's code string instead comes
// from buildDebugModule below — the SAME flavor-TS text
// @gltf-studio/script-panel's Script tab shows (buildEmitView, imported from
// that package's narrow `./emit-view` subpath so this package never pulls in
// monaco-editor/React), transformed to JS + a real inline source map via
// esbuild-wasm (debug-transform.ts), with a stable virtual `sourceURL`
// appended so a real DevTools session shows and can set breakpoints against
// the user's own script.
import { resolveGraph, InteractivityRuntime, type Graph as InterpGraph } from "@gltfi/runtime";
import type { EngineInteractive } from "@gltfi/runtime";
import { importGraph, checkModule, type Graph as IrGraph, type IRModule } from "@gltfi/ir";
import { emitModule, EmitError } from "@gltfi/emit-ts";
import { buildEmitView } from "@gltf-studio/script-panel/emit-view";
import type { EngineFactory } from "@gltfi/runtime-lib";
import type { EngineKind } from "@gltf-studio/engine-api";
import { debugVirtualSourceUrl } from "./debug-source.js";
import { buildDebugModuleSource } from "./debug-compose.js";

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

/**
 * PC-001/PC-004/PC-009/PC-010: builds whichever engine kind `start({engine})`
 * asked for, bound to the fan-out `SceneAdapter`/`onPointerSet`. `debug` and
 * `breakpointLines` (D2, specs/ux-debugger.md UX-1505) are meaningful only
 * for `kind === "compiled"` — ignored otherwise (the interpreter has no
 * compile step, and therefore no injected `debugger;` statements to run).
 */
export async function createEngineHost(
  kind: EngineKind,
  documentJson: unknown,
  binary: ArrayBuffer | Uint8Array | undefined,
  fanOut: PointerFanOut,
  debug = false,
  breakpointLines?: readonly number[]
): Promise<EngineHost> {
  const graph = resolveGraphOrThrow(documentJson);
  if (kind === "interpreter") {
    const runtime = new InteractivityRuntime(graph, documentJson, binary ?? null);
    runtime.bindAdapter({ applyPointer: fanOut });
    return { graph, engine: runtime.asEngineLike() };
  }
  const engine = await buildCompiledEngine(graph, documentJson, binary, fanOut, debug, breakpointLines);
  return { graph, engine };
}

/**
 * PC-009: the graph index @gltf-studio/play always resolves — see
 * resolveGraphOrThrow above (`graphs[0]`) — kept as a named constant rather
 * than a bare `0` literal at each of this file's two use sites. Exported so
 * tests can build the same virtual name this file uses without duplicating
 * the literal `0`.
 */
export const PLAY_GRAPH_INDEX = 0;

/**
 * Produces the compiled module's code string ONLY — no blob/import step —
 * so the branch choice (debug vs. non-debug) is a small, pure,
 * Node-unit-testable function on its own (compiled-debug.test.ts): non-debug
 * is an unchanged, byte-identical call to `emitModule(module,
 * {flavor:"js"})`; debug delegates to buildDebugModule below. Exported for
 * that same reason — buildCompiledEngine itself is not unit-testable in
 * plain Node (its `import(blob:)` step isn't, see engine-host.test.ts), but
 * this pure, blob-free code-string computation is.
 */
export async function computeCompiledCode(graph: IrGraph, module: IRModule, debug: boolean, breakpointLines?: readonly number[]): Promise<string> {
  if (debug) {
    return buildDebugModule(graph, breakpointLines);
  }
  return emitModule(module, { flavor: "js" }).code;
}

/**
 * PC-009/specs/ux-debugger.md UX-1502/UX-1503: the exact flavor-TS text
 * @gltf-studio/script-panel's Script tab shows for this graph (`buildEmitView`
 * — the ONE function that turns a graph into displayable code, imported from
 * script-panel's narrow `./emit-view` subpath so this package never pulls in
 * monaco-editor/React), transformed to JS + a real inline source map via
 * esbuild-wasm, with a stable virtual `//# sourceURL=` appended — identical
 * to the source map's own `sources[0]` entry, so DevTools reports this exact
 * name for both the running compiled script (`Debugger.scriptParsed.url`)
 * and the source-mapped pretty TypeScript it groups under.
 *
 * `breakpointLines` (D2, specs/ux-debugger.md UX-1505): 1-based Script-tab
 * line numbers to inject a `debugger;` statement before — session breakpoints
 * set via the Script tab's own gutter, applied here at build time (the only
 * point this pipeline CAN apply them; there is no live CDP re-binding from
 * inside the page itself, see debug-breakpoints.ts's own header comment).
 */
export async function buildDebugModule(graph: IrGraph, breakpointLines?: readonly number[]): Promise<string> {
  const sourceUrl = debugVirtualSourceUrl(PLAY_GRAPH_INDEX);
  const { code: tsText } = buildEmitView(graph, PLAY_GRAPH_INDEX);
  return buildDebugModuleSource(tsText, sourceUrl, breakpointLines);
}

async function buildCompiledEngine(
  graph: InterpGraph,
  documentJson: unknown,
  binary: ArrayBuffer | Uint8Array | undefined,
  fanOut: PointerFanOut,
  debug: boolean,
  breakpointLines?: readonly number[]
): Promise<EngineInteractive> {
  // @gltfi/runtime's Graph and @gltfi/ir's Graph are two independently
  // declared but structurally identical types — no KHR_interactivity-graph
  // shape conversion actually happens here, just a type-system formality
  // (see gltf-interactivity's packages/conformance/src/run-compiled.ts for
  // the same cast).
  const irGraph = graph as unknown as IrGraph;
  const { module, diagnostics } = importGraph(irGraph);
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
    code = await computeCompiledCode(irGraph, module, debug, breakpointLines);
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
