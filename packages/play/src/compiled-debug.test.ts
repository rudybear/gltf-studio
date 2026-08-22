// PC-009 / docs/adr/0006-devtools-script-debugging.md / specs/ux-debugger.md
// UX-1502/UX-1503: the debug compiled-play pipeline's text-identity
// guarantee and non-debug-path regression guard.
//
// This runs entirely under plain Node. `engine-host.ts`'s `buildDebugModule`
// (and, transitively, `computeCompiledCode(debug: true)`) is NOT exercised
// directly here — it calls `debug-transform.ts`'s `transformForDebug`, which
// constructs a real browser `Worker` (`new Worker(new URL(...))`), same
// category of Node-unsupported browser-only step as `buildCompiledEngine`'s
// own `import(blob:)` (see this package's pre-existing engine-host.test.ts
// for that precedent, and its `it.todo` below for this file's own). Instead,
// this file exercises the exact same PRODUCTION functions
// `buildDebugModule` composes — `esbuild-transform.ts`'s `transformTsToDebugJs`
// (the piece that actually needs esbuild-wasm — its Node entry point works
// fine directly, unlike the browser `Worker` wrapper around it) and
// `debug-source.ts`'s `appendDebugSourceUrl` — proving the SAME text-
// identity and source-map-shape guarantees the shipped `buildDebugModule`
// relies on, without needing a browser to do it.
import { describe, expect, it } from "vitest";
import { importGraph, type Graph as IrGraph } from "@gltfi/ir";
import { emitModule } from "@gltfi/emit-ts";
import { buildEmitView } from "@gltf-studio/script-panel/emit-view";
import { computeCompiledCode, PLAY_GRAPH_INDEX } from "./engine-host.js";
import { appendDebugSourceUrl, debugVirtualSourceUrl } from "./debug-source.js";
import { transformTsToDebugJs } from "./esbuild-transform.js";
import { tickCounterGltfJson } from "./test-fixtures.js";

function tickCounterGraph(): IrGraph {
  const json = tickCounterGltfJson() as {
    extensions: { KHR_interactivity: { graphs: [IrGraph] } };
  };
  return json.extensions.KHR_interactivity.graphs[0];
}

/** Decodes a `//# sourceMappingURL=data:application/json;base64,...` inline map out of a compiled JS string. */
function decodeInlineSourceMap(code: string): { version: number; sources: string[]; sourcesContent: string[]; mappings: string } {
  const match = /\/\/# sourceMappingURL=data:application\/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)/.exec(code);
  if (!match) throw new Error("no inline sourceMappingURL comment found");
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}

describe("PC-009 compiled-debug pipeline (docs/adr/0006, specs/ux-debugger.md UX-1502/UX-1503)", () => {
  it("non-debug branch is byte-identical to the pre-existing emitModule(flavor:'js') call — computeCompiledCode(debug=false) regression guard", async () => {
    const graph = tickCounterGraph();
    const { module } = importGraph(graph);
    const code = await computeCompiledCode(graph, module, false);
    expect(code).toBe(emitModule(module, { flavor: "js" }).code);
  });

  it("esbuild-transform's inline source map decodes with sources=[virtual name] and sourcesContent[0] === the Script tab's EXACT emitted text (UX-1503) — the same buildEmitView + transformTsToDebugJs composition buildDebugModule uses in production", async () => {
    const graph = tickCounterGraph();
    const sourceUrl = debugVirtualSourceUrl(PLAY_GRAPH_INDEX);
    const scriptTabText = buildEmitView(graph, PLAY_GRAPH_INDEX).code;

    const debugCode = await transformTsToDebugJs(scriptTabText, sourceUrl);

    const map = decodeInlineSourceMap(debugCode);
    expect(map.sources).toEqual([sourceUrl]);
    expect(map.sourcesContent).toHaveLength(1);
    expect(map.sourcesContent[0]).toBe(scriptTabText);
  });

  it("the transformed JS is valid, runnable-shaped ESM, not a passthrough of the untranspiled TS text (esbuild-wasm really ran)", async () => {
    const graph = tickCounterGraph();
    const sourceUrl = debugVirtualSourceUrl(PLAY_GRAPH_INDEX);
    const scriptTabText = buildEmitView(graph, PLAY_GRAPH_INDEX).code;
    const debugCode = await transformTsToDebugJs(scriptTabText, sourceUrl);

    expect(debugCode).toContain("sourceMappingURL=data:application/json;base64,");
    // The Script-tab text opens with UX-705's provenance comment; the
    // TRANSFORMED output must not simply equal (or start with) that same
    // text verbatim, or esbuild never actually ran.
    expect(debugCode.startsWith("// Behavior script")).toBe(false);
  });

  it("appendDebugSourceUrl (buildDebugModule's final step) appends a //# sourceURL= comment matching the same virtual name — so a raw CDP client can address the running compiled script directly by that name", () => {
    const sourceUrl = debugVirtualSourceUrl(PLAY_GRAPH_INDEX);
    const result = appendDebugSourceUrl("console.log(1);", sourceUrl);
    expect(result.trimEnd().split("\n").at(-1)).toBe(`//# sourceURL=${sourceUrl}`);
  });

  it("debugVirtualSourceUrl is stable and index-parameterized (UX-1502)", () => {
    expect(debugVirtualSourceUrl(0)).toBe("gltf-studio:///behavior/graph0.ts");
    expect(debugVirtualSourceUrl(2)).toBe("gltf-studio:///behavior/graph2.ts");
  });

  it.todo(
    "buildDebugModule / computeCompiledCode(debug: true) end-to-end (worker construction + esbuild-wasm's BROWSER entry via debug-transform.ts) needs a real browser or Vitest browser-mode environment — same category of gap engine-host.test.ts already documents for buildCompiledEngine's import(blob:) step. The e2e CDP suite (e2e/debugger.spec.ts) is this pipeline's real end-to-end proof."
  );
});
