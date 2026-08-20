// Resolves one tool-call's already-parsed `arguments` object into
// GraphEdit/SceneEdit factory calls pushed onto a CommandChain — the ONLY
// path from a model's tool_calls entry to a document mutation (AG-018).
// Each handler mirrors the equivalent packages/agent-mock template
// (spin.ts/move.ts/play-sound.ts/add-cube.ts), parameterized by the tool's
// arguments instead of values parsed out of a regex match.
//
// A handler throws (a plain Error, an out-of-range factory precondition, a
// malformed args shape) when it can't build a valid command sequence from
// `args` — response-parser.ts catches this per AG-020 and drops just that
// one operation rather than failing the whole request.
import { GraphEdit, SceneEdit, cubeGeometry, encodeCubeBuffer, getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { GeneratedAssetRef } from "@gltf-studio/engine-api";
import { CommandChain } from "@gltf-studio/agent-shared";

/** Threaded through every handler call so generate_cube (the only tool that introduces new assets) can record a GeneratedAssetRef (AG-016) alongside the commands it pushes — other handlers ignore this. */
export interface ToolExecutionContext {
  generatedAssets: GeneratedAssetRef[];
}

/** Every tool that touches the interactivity graph targets graph 0 — same convention agent-mock's templates/shared.ts uses; the schema's own graphIndex arg (add_pointer_interpolate_node) can still target a different graph explicitly. */
export const GRAPH_INDEX = 0;

/** Reads `extensions.KHR_interactivity.graphs[graphIndex].nodes.length` from `json` (0 if the graph doesn't exist yet) — mirrors agent-mock's templates/shared.ts `graphNodeCount`. */
function graphNodeCount(json: unknown, graphIndex: number): number {
  const nodes = getIn(json, ["extensions", "KHR_interactivity", "graphs", graphIndex, "nodes"]) as unknown[] | undefined;
  return nodes?.length ?? 0;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected a finite number for "${field}", got ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireNonNegativeInt(value: unknown, field: string): number {
  const n = requireNumber(value, field);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Expected a non-negative integer for "${field}", got ${JSON.stringify(value)}.`);
  }
  return n;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected a non-empty string for "${field}", got ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireVec(value: unknown, length: number, field: string): number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error(`Expected a ${length}-element number array for "${field}", got ${JSON.stringify(value)}.`);
  }
  return value as number[];
}

/** Rejects a nodeIndex that doesn't resolve to an existing nodes[] entry — factories themselves don't all check this, so tool handlers check it explicitly (AG-020's "out-of-range node index" case). */
function requireExistingNode(document: EditorDocument, nodeIndex: number): void {
  const node = getIn(document.json, ["nodes", nodeIndex]);
  if (node === undefined) {
    throw new Error(`No node at index ${nodeIndex}.`);
  }
}

const AXIS_UNIT: Record<string, [number, number, number]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** Quaternion [x,y,z,w] for a rotation of `degrees` about a unit `axis`. */
function quaternionForAxisAngle(axis: [number, number, number], degrees: number): [number, number, number, number] {
  const radians = (degrees * Math.PI) / 180;
  const half = radians / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/** A fixed, visible turn amount each spin_node_on_event call animates through — the rate (degreesPerSecond) only determines HOW LONG that turn takes, matching agent-mock's spin.ts fixed-120-degree convention (see that file's header) rather than inventing a continuous-loop primitive KHR_interactivity's pointer/interpolate doesn't have. */
const SPIN_TURN_DEGREES = 120;

function resolveEventNode(chain: CommandChain, eventOp: string, nodeIndex: number): number {
  chain.push(
    eventOp === "event/onSelect"
      ? GraphEdit.addNode(chain.doc, GRAPH_INDEX, eventOp, {
          extension: "KHR_node_selectability",
          configuration: { nodeIndex: { value: [nodeIndex] } }
        })
      : GraphEdit.addNode(chain.doc, GRAPH_INDEX, eventOp, {})
  );
  return graphNodeCount(chain.json, GRAPH_INDEX) - 1;
}

function handleSpinNodeOnEvent(chain: CommandChain, args: Record<string, unknown>, _ctx: ToolExecutionContext): void {
  const nodeIndex = requireNonNegativeInt(args.nodeIndex, "nodeIndex");
  requireExistingNode(chain.doc, nodeIndex);
  const eventOp = requireString(args.eventOp, "eventOp");
  const axisKey = requireString(args.axis, "axis");
  const axis = AXIS_UNIT[axisKey];
  if (!axis) throw new Error(`Unknown axis "${axisKey}" — expected "x", "y", or "z".`);
  const degreesPerSecond = requireNumber(args.degreesPerSecond, "degreesPerSecond");
  if (degreesPerSecond <= 0) throw new Error(`"degreesPerSecond" must be positive, got ${degreesPerSecond}.`);
  const durationSeconds = SPIN_TURN_DEGREES / degreesPerSecond;

  chain.push(GraphEdit.ensureGraph(chain.doc, GRAPH_INDEX));
  const eventNodeIndex = resolveEventNode(chain, eventOp, nodeIndex);

  const { command: float4TypeCmd, index: float4TypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "float4");
  chain.push(float4TypeCmd);
  const { command: floatTypeCmd, index: floatTypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "float");
  chain.push(floatTypeCmd);
  const { command: float2TypeCmd, index: float2TypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "float2");
  chain.push(float2TypeCmd);

  chain.push(
    GraphEdit.addNode(chain.doc, GRAPH_INDEX, "pointer/interpolate", {
      configuration: {
        pointer: { value: [`/nodes/${nodeIndex}/rotation`] },
        type: { value: [float4TypeIndex] }
      },
      values: {
        value: { type: float4TypeIndex, value: quaternionForAxisAngle(axis, SPIN_TURN_DEGREES) },
        duration: { type: floatTypeIndex, value: [durationSeconds] },
        p1: { type: float2TypeIndex, value: [0, 0] },
        p2: { type: float2TypeIndex, value: [1, 1] }
      }
    })
  );
  const interpolateNodeIndex = graphNodeCount(chain.json, GRAPH_INDEX) - 1;

  chain.push(GraphEdit.connectFlow(chain.doc, GRAPH_INDEX, eventNodeIndex, "out", interpolateNodeIndex, "in"));
}

function handleMoveNode(chain: CommandChain, args: Record<string, unknown>, _ctx: ToolExecutionContext): void {
  const nodeIndex = requireNonNegativeInt(args.nodeIndex, "nodeIndex");
  requireExistingNode(chain.doc, nodeIndex);
  const offset = requireVec(args.translation, 3, "translation");
  if (typeof args.relative !== "boolean") throw new Error(`Expected a boolean for "relative", got ${JSON.stringify(args.relative)}.`);

  let next: [number, number, number];
  if (args.relative) {
    const current = (getIn(chain.json, ["nodes", nodeIndex, "translation"]) as number[] | undefined) ?? [0, 0, 0];
    next = [current[0] + offset[0], current[1] + offset[1], current[2] + offset[2]];
  } else {
    next = [offset[0], offset[1], offset[2]];
  }

  chain.push(SceneEdit.setTransform(chain.doc, nodeIndex, { translation: next }));
}

/** Mirrors agent-mock's templates/play-sound.ts `resolveSourceIndex` — reads the first resolvable source index off a node's own KHR_audio_emitter reference. */
function resolveSourceIndex(json: unknown, nodeIndex: number): number | undefined {
  const emitterRef = getIn(json, ["nodes", nodeIndex, "extensions", "KHR_audio_emitter"]) as { emitter?: number; emitters?: number[] } | undefined;
  const emitterIndex = typeof emitterRef?.emitter === "number" ? emitterRef.emitter : emitterRef?.emitters?.[0];
  if (emitterIndex === undefined) return undefined;
  const emitter = getIn(json, ["extensions", "KHR_audio_emitter", "emitters", emitterIndex]) as { sources?: number[] } | undefined;
  return emitter?.sources?.[0];
}

function handlePlaySoundOnEvent(chain: CommandChain, args: Record<string, unknown>, _ctx: ToolExecutionContext): void {
  const nodeIndex = requireNonNegativeInt(args.nodeIndex, "nodeIndex");
  requireExistingNode(chain.doc, nodeIndex);
  const eventOp = requireString(args.eventOp, "eventOp");
  const soundNodeIndex = requireNonNegativeInt(args.soundNodeIndex, "soundNodeIndex");
  requireExistingNode(chain.doc, soundNodeIndex);

  const sourceIndex = resolveSourceIndex(chain.json, soundNodeIndex);
  if (sourceIndex === undefined) {
    throw new Error(`Node ${soundNodeIndex} has no resolvable KHR_audio_emitter source to play.`);
  }

  chain.push(GraphEdit.ensureGraph(chain.doc, GRAPH_INDEX));
  const eventNodeIndex = resolveEventNode(chain, eventOp, nodeIndex);

  const { command: boolTypeCmd, index: boolTypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "bool");
  chain.push(boolTypeCmd);

  // NONSTANDARD pointer: see agent-mock's templates/play-sound.ts for the
  // full rationale (packages/audio-webaudio/src/web-audio-host.ts's
  // "NONSTANDARD" comment) — this project's own prototype one-shot
  // playback-trigger extension to KHR_audio_emitter.
  chain.push(
    GraphEdit.addNode(chain.doc, GRAPH_INDEX, "pointer/set", {
      configuration: {
        pointer: { value: [`/extensions/KHR_audio_emitter/sources/${sourceIndex}/playing`] },
        type: { value: [boolTypeIndex] }
      },
      values: { value: { type: boolTypeIndex, value: [true] } }
    })
  );
  const setNodeIndex = graphNodeCount(chain.json, GRAPH_INDEX) - 1;

  chain.push(GraphEdit.connectFlow(chain.doc, GRAPH_INDEX, eventNodeIndex, "out", setNodeIndex, "in"));
}

const CUBE_COLOR: [number, number, number, number] = [0.55, 0.65, 0.95, 1]; // solid pale blue, no textures — matches agent-mock's add-cube template look

function handleGenerateCube(chain: CommandChain, args: Record<string, unknown>, ctx: ToolExecutionContext): void {
  const name = args.name !== undefined ? requireString(args.name, "name") : "Generated cube";
  const halfExtent = args.halfExtent !== undefined ? requireNumber(args.halfExtent, "halfExtent") : 0.5;
  if (halfExtent <= 0) throw new Error(`"halfExtent" must be positive, got ${halfExtent}.`);
  const parentNodeIndex = args.parentNodeIndex !== undefined ? requireNonNegativeInt(args.parentNodeIndex, "parentNodeIndex") : undefined;
  if (parentNodeIndex !== undefined) requireExistingNode(chain.doc, parentNodeIndex);

  const geometry = cubeGeometry(halfExtent);
  const encoded = encodeCubeBuffer(geometry);

  const { command: bufferCmd, index: bufferIndex } = SceneEdit.addBuffer(chain.doc, { byteLength: encoded.byteLength, uri: encoded.uri });
  chain.push(bufferCmd);

  const { command: posViewCmd, index: posViewIndex } = SceneEdit.addBufferView(chain.doc, {
    buffer: bufferIndex,
    byteOffset: encoded.positions.byteOffset,
    byteLength: encoded.positions.byteLength,
    target: 34962 // ARRAY_BUFFER
  });
  chain.push(posViewCmd);
  const { command: normViewCmd, index: normViewIndex } = SceneEdit.addBufferView(chain.doc, {
    buffer: bufferIndex,
    byteOffset: encoded.normals.byteOffset,
    byteLength: encoded.normals.byteLength,
    target: 34962
  });
  chain.push(normViewCmd);
  const { command: idxViewCmd, index: idxViewIndex } = SceneEdit.addBufferView(chain.doc, {
    buffer: bufferIndex,
    byteOffset: encoded.indices.byteOffset,
    byteLength: encoded.indices.byteLength,
    target: 34963 // ELEMENT_ARRAY_BUFFER
  });
  chain.push(idxViewCmd);

  const { command: posAccCmd, index: posAccIndex } = SceneEdit.addAccessor(chain.doc, {
    bufferView: posViewIndex,
    componentType: 5126, // FLOAT
    count: geometry.positions.length / 3,
    type: "VEC3",
    min: geometry.min,
    max: geometry.max
  });
  chain.push(posAccCmd);
  const { command: normAccCmd, index: normAccIndex } = SceneEdit.addAccessor(chain.doc, {
    bufferView: normViewIndex,
    componentType: 5126,
    count: geometry.normals.length / 3,
    type: "VEC3"
  });
  chain.push(normAccCmd);
  const { command: idxAccCmd, index: idxAccIndex } = SceneEdit.addAccessor(chain.doc, {
    bufferView: idxViewIndex,
    componentType: 5123, // UNSIGNED_SHORT
    count: geometry.indices.length,
    type: "SCALAR"
  });
  chain.push(idxAccCmd);

  const { command: materialCmd, index: materialIndex } = SceneEdit.addMaterial(chain.doc, {
    name: `${name} material`,
    pbrMetallicRoughness: { baseColorFactor: CUBE_COLOR }
  });
  chain.push(materialCmd);

  const { command: meshCmd, index: meshIndex } = SceneEdit.addMesh(chain.doc, {
    name,
    primitives: [{ attributes: { POSITION: posAccIndex, NORMAL: normAccIndex }, indices: idxAccIndex, material: materialIndex }]
  });
  chain.push(meshCmd);

  const { command: nodeCmd, index: newNodeIndex } = SceneEdit.addNode(
    chain.doc,
    { name, mesh: meshIndex },
    parentNodeIndex !== undefined ? { parentNodeIndex } : {}
  );
  chain.push(nodeCmd);

  ctx.generatedAssets.push({
    kind: "mesh",
    pointers: [`/meshes/${meshIndex}`, `/materials/${materialIndex}`, `/nodes/${newNodeIndex}`],
    provenance: "Copilot (local model): procedural cube primitive"
  });
}

function handleSetNodeTransform(chain: CommandChain, args: Record<string, unknown>, _ctx: ToolExecutionContext): void {
  const nodeIndex = requireNonNegativeInt(args.nodeIndex, "nodeIndex");
  requireExistingNode(chain.doc, nodeIndex);

  const fields: { translation?: [number, number, number]; rotation?: [number, number, number, number]; scale?: [number, number, number] } = {};
  if (args.translation !== undefined) fields.translation = requireVec(args.translation, 3, "translation") as [number, number, number];
  if (args.rotation !== undefined) fields.rotation = requireVec(args.rotation, 4, "rotation") as [number, number, number, number];
  if (args.scale !== undefined) fields.scale = requireVec(args.scale, 3, "scale") as [number, number, number];
  if (Object.keys(fields).length === 0) {
    throw new Error("set_node_transform requires at least one of translation/rotation/scale.");
  }

  chain.push(SceneEdit.setTransform(chain.doc, nodeIndex, fields));
}

function handleAddPointerInterpolateNode(chain: CommandChain, args: Record<string, unknown>, _ctx: ToolExecutionContext): void {
  const graphIndex = requireNonNegativeInt(args.graphIndex, "graphIndex");
  const pointerPath = requireString(args.pointerPath, "pointerPath");
  if (!pointerPath.startsWith("/")) throw new Error(`"pointerPath" must be a JSON-pointer-shaped path starting with "/", got ${JSON.stringify(pointerPath)}.`);
  const signature = requireString(args.signature, "signature");
  const kind = requireString(args.kind, "kind");
  if (kind !== "get" && kind !== "set" && kind !== "interpolate") {
    throw new Error(`Unknown kind "${kind}" — expected "get", "set", or "interpolate".`);
  }

  chain.push(GraphEdit.addPointerNode(chain.doc, graphIndex, kind, pointerPath, signature));
}

export type ToolHandler = (chain: CommandChain, args: Record<string, unknown>, ctx: ToolExecutionContext) => void;

/** Name -> handler. response-parser.ts looks up each tool_call's `function.name` here; an unrecognized name is AG-020's "unknown tool" drop case. */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  spin_node_on_event: handleSpinNodeOnEvent,
  move_node: handleMoveNode,
  play_sound_on_event: handlePlaySoundOnEvent,
  generate_cube: handleGenerateCube,
  set_node_transform: handleSetNodeTransform,
  add_pointer_interpolate_node: handleAddPointerInterpolateNode
};
