// Template (d): "add/generate/create N cube(s)/box(es)" — procedural mesh
// generation. This is the template Part A's minimal append-only SceneEdit
// structural factories (addBuffer/addBufferView/addAccessor/addMaterial/
// addMesh/addNode, editor-core/src/scene-edit.ts, DOC-046) exist to unblock
// — see docs/adr/0004's "asset generation pulls scene-structural mutation
// earlier than the M8 plan assumed" consequence.
//
// Count parsing: the first integer in the prompt, default 1, capped at
// MAX_CUBES (8) so a generated proposal stays reviewable in the (Phase 2)
// UI rather than silently producing a huge diff for "add 500 cubes".
//
// Cubes are placed side-by-side along +X (`i * CUBE_SPACING`), offset from
// the selected node's translation if one is selected (world origin
// otherwise) — purely so multiple cubes don't fully overlap; no rotation is
// applied.
import { SceneEdit, cubeGeometry, encodeCubeBuffer, getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { GeneratedAssetRef, Proposal } from "@gltf-studio/engine-api";
import { CommandChain } from "@gltf-studio/agent-shared";

const MAX_CUBES = 8;
const CUBE_SPACING = 1.5;
const CUBE_COLOR: [number, number, number, number] = [0.55, 0.65, 0.95, 1]; // solid pale blue, no textures

const ADD_CUBE_RE = /\b(add|generate|create)\b.*\b(cube|box)/i;

export function matchesAddCubeTemplate(prompt: string): boolean {
  return ADD_CUBE_RE.test(prompt);
}

function parseCount(prompt: string): number {
  const match = prompt.match(/\d+/);
  const requested = match ? Number(match[0]) : 1;
  return Math.min(Math.max(requested, 1), MAX_CUBES);
}

export function buildAddCubeProposal(document: EditorDocument, prompt: string, nodeIndex: number | undefined): Proposal {
  const count = parseCount(prompt);
  const baseTranslation =
    nodeIndex !== undefined ? ((getIn(document.json, ["nodes", nodeIndex, "translation"]) as number[] | undefined) ?? [0, 0, 0]) : [0, 0, 0];

  const chain = new CommandChain(document);
  const generatedAssets: GeneratedAssetRef[] = [];

  for (let i = 0; i < count; i++) {
    const geometry = cubeGeometry();
    const encoded = encodeCubeBuffer(geometry);

    const { command: bufferCmd, index: bufferIndex } = SceneEdit.addBuffer(chain.doc, {
      byteLength: encoded.byteLength,
      uri: encoded.uri
    });
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
      name: `Copilot cube ${i + 1} material`,
      pbrMetallicRoughness: { baseColorFactor: CUBE_COLOR }
    });
    chain.push(materialCmd);

    const { command: meshCmd, index: meshIndex } = SceneEdit.addMesh(chain.doc, {
      name: `Copilot cube ${i + 1}`,
      primitives: [{ attributes: { POSITION: posAccIndex, NORMAL: normAccIndex }, indices: idxAccIndex, material: materialIndex }]
    });
    chain.push(meshCmd);

    const { command: nodeCmd, index: newNodeIndex } = SceneEdit.addNode(chain.doc, {
      name: `Copilot cube ${i + 1}`,
      mesh: meshIndex,
      translation: [baseTranslation[0] + i * CUBE_SPACING, baseTranslation[1], baseTranslation[2]]
    });
    chain.push(nodeCmd);

    generatedAssets.push({
      kind: "mesh",
      pointers: [`/meshes/${meshIndex}`, `/materials/${materialIndex}`, `/nodes/${newNodeIndex}`],
      provenance: "Copilot: procedural cube primitive"
    });
  }

  return {
    summary: `Add ${count} procedurally generated cube${count === 1 ? "" : "s"} to the scene.`,
    commands: chain.commands,
    // This template never touches the interactivity graph.
    validationReport: { findings: [] },
    generatedAssets
  };
}
