// PC-012: load-time validation (spec "Validation") makes Play refuse any spec-invalid
// KHR_interactivity graph, so every graph Studio ships or generates by default must validate.
// Covers the sources not already covered by packages/play/src/sample-assets.test.ts (samples/*.glb):
//   - the "Empty scene" starter (empty-scene.ts),
//   - every Copilot mock-agent template (spin, move, play-sound, add-cube, neutral-claim),
//   - the Inspector "Attach behavior" store actions (On select -> set/interpolate/play sound/animation, pointer retarget).
// Every result is exported exactly as "Export .glb" does (editor-core `save`), re-parsed, then
// validated and run through the interpreter (construct, start, tick once).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseContainer, writeContainer, type Container } from "@gltfi/gltf";
import { InteractivityRuntime, isInteractivityValidationError, resolveGraph, validateExtension } from "@gltfi/runtime";
import { createDocument, HistoryStack, save, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import {
  MockAgentProvider,
  buildBehaviorNeutralProposalForTests,
  buildDeliberatelyBrokenProposalForTests
} from "@gltf-studio/agent-mock";
import type { AgentContextRef, Proposal } from "@gltf-studio/engine-api";
import { buildEmptySceneGlb } from "./empty-scene.js";

vi.mock("@gltf-studio/play", () => ({ createPlayController: vi.fn(), PLAY_GRAPH_INDEX: 0 }));
vi.mock("@gltf-studio/storage", () => ({
  IndexedDBStorage: class {
    capabilities = { fileHandles: false, remote: false };
    autosaveJournal = vi.fn(async () => {});
  }
}));
const { useAppStore } = await import("../store/app-store.js");

const samplesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../samples");

function loadDoc(bytes: Uint8Array): EditorDocument {
  return createDocument(parseContainer(bytes));
}
function champagne(): EditorDocument {
  return loadDoc(new Uint8Array(readFileSync(resolve(samplesDir, "champagne.glb"))));
}
function emptyScene(): EditorDocument {
  return loadDoc(buildEmptySceneGlb());
}
function withJson(doc: EditorDocument, mutate: (json: Record<string, unknown>) => void): EditorDocument {
  const json = JSON.parse(JSON.stringify(doc.json)) as Record<string, unknown>;
  mutate(json);
  const jsonText = JSON.stringify(json);
  const container: Container = {
    kind: "glb",
    chunks: [{ type: 0x4e4f534a, bytes: new TextEncoder().encode(jsonText) }],
    jsonChunkIndex: 0,
    jsonText,
    json
  };
  return loadDoc(writeContainer(container) as Uint8Array);
}

/** Applies commands through the real HistoryStack, then exports like "Export .glb" and re-parses the bytes. */
function exportJson(doc: EditorDocument, commands: readonly Command[]): { json: Record<string, unknown>; bin: Uint8Array | null } {
  const history = new HistoryStack(doc);
  for (const c of commands) history.push(c);
  const exported = parseContainer(save(history.document).report.bytes);
  const bin = exported.kind === "glb" ? exported.binaryChunk : undefined;
  return { json: exported.json as Record<string, unknown>, bin: bin ? new Uint8Array(bin) : null };
}

function expectValidAndRuns(json: Record<string, unknown>, bin: Uint8Array | null): void {
  const ext = (json.extensions as { KHR_interactivity?: unknown } | undefined)?.KHR_interactivity;
  expect(ext).toBeDefined();
  const result = validateExtension(ext);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.ok).toBe(true);
  const runtime = new InteractivityRuntime(resolveGraph(json), json, bin);
  runtime.bindAdapter({ applyPointer: () => undefined });
  runtime.start();
  runtime.tick(1 / 60);
}

describe("Empty scene starter (PC-012)", () => {
  it("has no KHR_interactivity; Play refuses it with the plain 'no graph' error, never a validation error", () => {
    const doc = emptyScene();
    expect((doc.json as { extensions?: unknown }).extensions).toBeUndefined();
    let thrown: unknown;
    try {
      resolveGraph(doc.json as Record<string, unknown>);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(isInteractivityValidationError(thrown)).toBe(false);
  });
});

const sel = (n: number): AgentContextRef[] => [{ kind: "selection", nodeIndices: [n] }];

async function propose(doc: EditorDocument, prompt: string, node?: number): Promise<Proposal> {
  return new MockAgentProvider(doc).request(prompt, node === undefined ? [] : sel(node));
}

/** Targets: the Empty scene after a cube exists (node 0), a synthetic audio-bearing scene, and champagne (Cork = node 3 has audio). */
async function emptyWithCube(): Promise<EditorDocument> {
  const base = emptyScene();
  const history = new HistoryStack(base);
  for (const c of (await propose(base, "add a cube")).commands) history.push(c);
  return loadDoc(save(history.document).report.bytes);
}
function emptyWithAudio(): EditorDocument {
  return withJson(emptyScene(), (j) => {
    j.nodes = [{ name: "Speaker", extensions: { KHR_audio_emitter: { emitter: 0 } } }];
    j.scenes = [{ name: "Scene", nodes: [0] }];
    j.extensionsUsed = ["KHR_audio_emitter"];
    j.extensions = {
      KHR_audio_emitter: {
        audio: [{ uri: "data:audio/wav;base64,AAAA" }],
        sources: [{ audio: 0, gain: 1, loop: false }],
        emitters: [{ type: "positional", gain: 1, sources: [0] }]
      }
    };
  });
}

describe("Copilot mock-agent templates produce spec-valid graphs (PC-012)", () => {
  const cases: Array<{ name: string; prompt: string; empty: () => Promise<EditorDocument> | EditorDocument; node: number; champagneNode: number }> = [
    { name: "spin (onTick)", prompt: "spin it", empty: emptyWithCube, node: 0, champagneNode: 2 },
    { name: "spin (onSelect)", prompt: "spin on click", empty: emptyWithCube, node: 0, champagneNode: 2 },
    { name: "play-sound", prompt: "play the sound", empty: emptyWithAudio, node: 0, champagneNode: 3 }
  ];
  for (const c of cases) {
    it(`${c.name}: valid on the empty scene and on champagne.glb`, async () => {
      const empty = await c.empty();
      const p1 = await propose(empty, c.prompt, c.node);
      const r1 = exportJson(empty, p1.commands);
      expectValidAndRuns(r1.json, r1.bin);

      const champ = champagne();
      const p2 = await propose(champ, c.prompt, c.champagneNode);
      const r2 = exportJson(champ, p2.commands);
      expectValidAndRuns(r2.json, r2.bin);
    });
  }

  it("move: edits translation only, adds no graph, and leaves champagne valid", async () => {
    const empty = await emptyWithCube();
    const r1 = exportJson(empty, (await propose(empty, "move it up", 0)).commands);
    expect((r1.json.nodes as Array<{ translation?: number[] }>)[0].translation).toEqual([0, 1, 0]);
    expect((r1.json as { extensions?: unknown }).extensions).toBeUndefined();
    const champ = champagne();
    const r2 = exportJson(champ, (await propose(champ, "move it up", 2)).commands);
    expectValidAndRuns(r2.json, r2.bin);
  });

  it("add-cube: empty scene export stays valid (adds no graph) and champagne stays valid", async () => {
    const empty = emptyScene();
    const r1 = exportJson(empty, (await propose(empty, "add 2 cubes")).commands);
    expect(r1.json.nodes).toHaveLength(2);
    const champ = champagne();
    const r2 = exportJson(champ, (await propose(champ, "add a cube")).commands);
    expectValidAndRuns(r2.json, r2.bin);
  });

  it("neutral-claim (test-only no-op) keeps champagne valid", () => {
    const champ = champagne();
    const r = exportJson(champ, buildBehaviorNeutralProposalForTests(champ).commands);
    expectValidAndRuns(r.json, r.bin);
  });

  it("broken (test-only, intentionally invalid) IS rejected by validateExtension", async () => {
    const champ = champagne();
    const r = exportJson(champ, buildDeliberatelyBrokenProposalForTests(champ).commands);
    const result = validateExtension((r.json.extensions as { KHR_interactivity: unknown }).KHR_interactivity);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("Inspector 'Attach behavior' store actions produce spec-valid graphs (PC-012)", () => {
  function install(doc: EditorDocument): void {
    useAppStore.setState({ projectId: "p", document: doc, history: new HistoryStack(doc), playState: "stopped", toasts: [], consoleLines: [] });
  }
  function exported(): { json: Record<string, unknown>; bin: Uint8Array | null } {
    const doc = useAppStore.getState().history!.document;
    return exportJson(doc, []);
  }
  beforeEach(() => vi.clearAllMocks());

  it("On select -> play sound (champagne Cork)", () => {
    install(champagne());
    useAppStore.getState().attachOnSelectPlaySound(3);
    const r = exported();
    expectValidAndRuns(r.json, r.bin);
  });

  it("On select -> play animation", () => {
    install(withJson(emptyScene(), (j) => {
      j.nodes = [{ name: "N" }];
      j.scenes = [{ name: "Scene", nodes: [0] }];
      j.animations = [{ name: "A", samplers: [], channels: [] }];
    }));
    useAppStore.getState().attachOnSelectPlayAnimation(0, 0);
    const r = exported();
    expectValidAndRuns(r.json, r.bin);
  });

  // UX-132: Play refuses spec-invalid graphs, so these scaffolds must validate. Neutral scaffolds (value = current property value; interpolate: duration 1, p1 [0,0], p2 [1,1]):
  // Play accepts them straight away and they have no visible effect.
  const nodeGraph = (json: Record<string, unknown>) =>
    (json.extensions as { KHR_interactivity: { graphs: Array<{ types: Array<{ signature: string }>; nodes: Array<{ values?: Record<string, { type: number; value: unknown[] }> }> }> } }).KHR_interactivity.graphs[0];
  function literal(json: Record<string, unknown>, nodeIndex: number, socket: string): { signature: string; value: unknown[] } {
    const g = nodeGraph(json);
    const lit = g.nodes[nodeIndex].values![socket];
    return { signature: g.types[lit.type].signature, value: lit.value };
  }
  for (const kind of ["set", "interpolate"] as const) {
    it(`On select -> ${kind} property: neutral defaults, zero errors, interpreter runs`, () => {
      install(withJson(emptyScene(), (j) => {
        j.nodes = [{ name: "N", translation: [1, 2, 3] }];
        j.scenes = [{ name: "Scene", nodes: [0] }];
      }));
      useAppStore.getState().attachOnSelectPointerNode(0, kind);
      const r = exported();
      expectValidAndRuns(r.json, r.bin);
      expect(literal(r.json, 1, "value")).toEqual({ signature: "float3", value: [1, 2, 3] });
      if (kind === "interpolate") {
        expect(literal(r.json, 1, "duration")).toEqual({ signature: "float", value: [1] });
        expect(literal(r.json, 1, "p1")).toEqual({ signature: "float2", value: [0, 0] });
        expect(literal(r.json, 1, "p2")).toEqual({ signature: "float2", value: [1, 1] });
      }
    });

    it(`addPointerGraphNode ${kind}: neutral defaults, zero errors, interpreter runs`, () => {
      install(withJson(emptyScene(), (j) => {
        j.nodes = [{ name: "N" }];
        j.scenes = [{ name: "Scene", nodes: [0] }];
      }));
      useAppStore.getState().addPointerGraphNode(kind, "/nodes/0/translation", "float3");
      const r = exported();
      expectValidAndRuns(r.json, r.bin);
      expect(literal(r.json, 0, "value")).toEqual({ signature: "float3", value: [0, 0, 0] });
    });

    it(`retargeting an On select -> ${kind} node to a different-typed property keeps the graph valid`, () => {
      install(withJson(emptyScene(), (j) => {
        j.nodes = [{ name: "N", rotation: [0, 0.7071, 0, 0.7071] }];
        j.scenes = [{ name: "Scene", nodes: [0] }];
        j.materials = [{ pbrMetallicRoughness: { roughnessFactor: 0.25 } }];
      }));
      const store = useAppStore.getState();
      store.attachOnSelectPointerNode(0, kind);
      const retarget = (path: string, sig: string) => {
        useAppStore.getState().openPointerPicker({ nodeIndex: 1, currentPath: "/nodes/0/translation", currentType: "float3" });
        useAppStore.getState().confirmPointerPicker(path, sig);
        const r = exported();
        expectValidAndRuns(r.json, r.bin);
        return r.json;
      };
      expect(literal(retarget("/nodes/0/rotation", "float4"), 1, "value")).toEqual({ signature: "float4", value: [0, 0.7071, 0, 0.7071] });
      expect(literal(retarget("/materials/0/pbrMetallicRoughness/roughnessFactor", "float"), 1, "value")).toEqual({ signature: "float", value: [0.25] });
      expect(literal(retarget("/nodes/0/scale", "float3"), 1, "value")).toEqual({ signature: "float3", value: [1, 1, 1] });
      // bool cannot be interpolated (GV159, independent of the value literal), so only pointer/set retargets to it.
      if (kind === "set") expect(literal(retarget("/nodes/0/extensions/KHR_node_visibility/visible", "bool"), 1, "value")).toEqual({ signature: "bool", value: [false] });
    });
  }
});
