// AudioGraphJsHost: AudioGraphHost (specs/engine-api.md AGH-001) over
// vendored AudioGraphJS (docs/adr/0003-vendored-gltfi-tarballs.md's pattern
// extended to a non-@gltfi/* package — see scripts/refresh-vendor.mjs and
// pnpm-workspace.yaml's `audio-graph-js` override).
//
// `buildGraph()` only parses `KHR_audio_graph` (via AudioGraphJS's
// `parseLayeredExtensions`) and lints it (AudioGraphJS's own
// `lintLayeredGraph` plus this package's `validators.ts`) — no
// `AudioContext` is created there, so loading a document with a
// KHR_audio_graph extension never touches the browser's autoplay-gated
// audio subsystem on its own. Real Web Audio node construction (calling
// AudioGraphJS's `buildGraph`) is deferred to `audition()`, the one
// user-gesture-triggered entry point, and cached afterward.
import type { AudioGraphHost, AudioGraphLintResult } from "@gltf-studio/engine-api";
import {
  buildGraph as buildWebAudioGraph,
  createMemoryTrace,
  lintLayeredGraph,
  parseLayeredExtensions,
  type GltfDocument,
  type GraphSpec,
  type KHRGraph
} from "audio-graph-js";

// audio-graph-js's package index does not re-export its internal
// `TraceLogger` interface (only the `createMemoryTrace()` factory) — see
// its runtime/trace.ts. Derived here rather than widened upstream.
type TraceLogger = ReturnType<typeof createMemoryTrace>;
import { validateGraph } from "./validators.js";

export type AudioGraphInput = GltfDocument | { json: GltfDocument; binary?: ArrayBuffer | Uint8Array | null };

function isGltfDocument(value: unknown): value is GltfDocument {
  return typeof value === "object" && value !== null;
}

function normalizeInput(value: unknown): GltfDocument {
  if (value && typeof value === "object" && "json" in (value as Record<string, unknown>)) {
    const container = value as { json: unknown };
    if (!isGltfDocument(container.json)) {
      throw new TypeError("AudioGraphJsHost.buildGraph: container shape requires a glTF JSON object at .json");
    }
    return container.json;
  }
  if (isGltfDocument(value)) {
    return value;
  }
  throw new TypeError("AudioGraphJsHost.buildGraph: expected a glTF document, or { json, binary }");
}

interface ParsedGraphEntry {
  graphIndex: number;
  spec: GraphSpec;
  raw: KHRGraph;
}

export class AudioGraphJsHost implements AudioGraphHost {
  private context: AudioContext | null = null;
  private parsedGraphs: ParsedGraphEntry[] = [];
  private lintResults: AudioGraphLintResult[] = [];
  private builtByNodeId = new Map<string, { output: AudioNode }>();
  private tracer: TraceLogger = createMemoryTrace();

  /** See the file header and AGH-001's doc comment (packages/engine-api/src/audio-graph-host.ts) for why this never creates an AudioContext. */
  buildGraph(json: unknown): void {
    const doc = normalizeInput(json);
    this.parsedGraphs = [];
    this.lintResults = [];
    this.builtByNodeId.clear();

    const graphExt = doc.extensions?.KHR_audio_graph;
    if (!graphExt || !Array.isArray(graphExt.graphs) || graphExt.graphs.length === 0) {
      return; // AGH-001: no KHR_audio_graph -> reports empty gracefully
    }
    if (!doc.extensions?.KHR_audio_emitter) {
      this.lintResults.push({
        graphIndex: -1,
        severity: "error",
        code: "missing-emitter-extension",
        message: "extensions.KHR_audio_graph is present but extensions.KHR_audio_emitter is not — a KHR_audio_graph document requires the base emitter extension it binds sources/emitters against.",
        nodeIds: []
      });
      return;
    }

    let parsed;
    try {
      parsed = parseLayeredExtensions(doc);
    } catch (error) {
      this.lintResults.push({
        graphIndex: -1,
        severity: "error",
        code: "parse-failed",
        message: error instanceof Error ? error.message : String(error),
        nodeIds: []
      });
      return;
    }

    graphExt.graphs.forEach((raw, graphIndex) => {
      const spec = parsed.graphs[graphIndex];
      this.parsedGraphs.push({ graphIndex, spec, raw });
      this.lintResults.push(...validateGraph(graphIndex, raw, doc.extensions!.KHR_audio_emitter!.sources ?? []));
      const upstream = lintLayeredGraph(raw, doc.extensions!.KHR_audio_emitter!);
      for (const message of upstream.errors) {
        if (/cycle/i.test(message)) {
          continue; // superseded by validateGraph's named-path cycle result above
        }
        this.lintResults.push({ graphIndex, severity: "error", code: "upstream", message, nodeIds: [] });
      }
      for (const message of upstream.warnings) {
        this.lintResults.push({ graphIndex, severity: "warning", code: "upstream", message, nodeIds: [] });
      }
    });
  }

  lint(): AudioGraphLintResult[] {
    return this.lintResults;
  }

  /**
   * Lazily builds real Web Audio nodes (gesture-triggered — see the file
   * header) and taps `nodeId`'s output to destination briefly.
   *
   * `buildWebAudioGraph` can throw for a node kind this vendored
   * `audio-graph-js@0.1.0` runtime doesn't implement yet even though it is
   * schema-valid `KHR_audio_graph` — `compressor`, the ratified schema's
   * PR #2572 review-fixes addition (`validators.ts`'s own header comment;
   * gap-analysis G1 is resolved upstream, but this runtime hasn't caught up)
   * is the concrete case today, and any FUTURE schema-legal kind this
   * runtime doesn't yet build would hit the same path. Per this method's own
   * documented "no-op if nodeId is not found" fault-tolerant posture
   * (specs/engine-api.md AGH-audition-signature-tbd), a build failure is
   * handled the same way — traced, not thrown — rather than letting an
   * exception escape into whatever React event handler called this and
   * crash the audio-graph canvas over one unauditionable node in an
   * otherwise-valid, schema-conformant document.
   */
  audition(nodeId: string): void {
    const entry = this.parsedGraphs.find((candidate) => candidate.spec.nodes.some((node) => node.id === nodeId));
    if (!entry) {
      return;
    }
    if (!this.context) {
      this.context = new AudioContext();
    }
    const context = this.context;
    if (!this.builtByNodeId.has(nodeId)) {
      let built: ReturnType<typeof buildWebAudioGraph>;
      try {
        built = buildWebAudioGraph(context, entry.spec, this.tracer);
      } catch (error) {
        this.tracer.log(`audition(${nodeId}): build failed — ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      for (const [id, node] of built.nodes) {
        this.builtByNodeId.set(id, { output: node });
      }
    }
    const target = this.builtByNodeId.get(nodeId);
    if (!target) {
      return;
    }
    void context.resume().catch(() => undefined);
    const tap = context.createGain();
    tap.gain.value = 1;
    target.output.connect(tap);
    tap.connect(context.destination);
    const AUDITION_SECONDS = 1.5;
    tap.gain.setValueAtTime(1, context.currentTime);
    tap.gain.setTargetAtTime(0, context.currentTime + AUDITION_SECONDS, 0.05);
    setTimeout(() => {
      try {
        target.output.disconnect(tap);
        tap.disconnect();
      } catch {
        // already disconnected
      }
    }, (AUDITION_SECONDS + 0.5) * 1000);
  }

  trace(): string[] {
    return this.tracer.getLines();
  }

  /** Non-interface extra (AGH-lifecycle-tbd is intentionally OPEN — see packages/engine-api/src/audio-graph-host.ts): closes the lazily-created AudioContext, if any. */
  close(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.builtByNodeId.clear();
  }
}
