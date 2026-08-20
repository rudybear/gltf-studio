// Template (c): "play <clip>" / "play sound" / "sound on click" — trigger
// the selected node's audio when it's clicked.
//
// Preconditions (both must hold, checked by `resolveAudioSource` below):
//   - the prompt matches /play|sound/i, AND
//   - the selected node actually has audio: `node.extensions.KHR_audio_emitter`
//     names an emitter (legacy singular `.emitter: number` or the array
//     form `.emitters: number[]`, first entry) that resolves into
//     `extensions.KHR_audio_emitter.emitters[]`, and that emitter's
//     `.sources` (a `number[]` indexing into
//     `extensions.KHR_audio_emitter.sources[]`) is non-empty.
// If either fails, this template does not fire (returns `undefined`) and
// the caller (mock-agent-provider.ts) falls through to the next template or
// the final refusal — it does NOT throw here, since "prompt matched but
// this node has no audio" is exactly the "falls through" case the task
// brief describes, not a hard error.
import { GraphEdit, getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { Proposal } from "@gltf-studio/engine-api";
import { CommandChain, validateProposalGraph } from "@gltf-studio/agent-shared";
import { GRAPH_INDEX, graphNodeCount } from "./shared.js";

export function matchesPlaySoundTemplate(prompt: string): boolean {
  return /play|sound/i.test(prompt);
}

function resolveSourceIndex(document: EditorDocument, nodeIndex: number): number | undefined {
  const emitterRef = getIn(document.json, ["nodes", nodeIndex, "extensions", "KHR_audio_emitter"]) as
    | { emitter?: number; emitters?: number[] }
    | undefined;
  const emitterIndex = typeof emitterRef?.emitter === "number" ? emitterRef.emitter : emitterRef?.emitters?.[0];
  if (emitterIndex === undefined) return undefined;

  const emitter = getIn(document.json, ["extensions", "KHR_audio_emitter", "emitters", emitterIndex]) as
    | { sources?: number[] }
    | undefined;
  return emitter?.sources?.[0];
}

/** Returns `undefined` (rather than throwing) when the selected node has no resolvable audio — see file header. */
export function buildPlaySoundProposal(document: EditorDocument, nodeIndex: number): Proposal | undefined {
  const sourceIndex = resolveSourceIndex(document, nodeIndex);
  if (sourceIndex === undefined) {
    return undefined;
  }

  const chain = new CommandChain(document);
  chain.push(GraphEdit.ensureGraph(chain.doc, GRAPH_INDEX));

  chain.push(
    GraphEdit.addNode(chain.doc, GRAPH_INDEX, "event/onSelect", {
      extension: "KHR_node_selectability",
      configuration: { nodeIndex: { value: [nodeIndex] } }
    })
  );
  const eventNodeIndex = graphNodeCount(chain.json, GRAPH_INDEX) - 1;

  const { command: boolTypeCmd, index: boolTypeIndex } = GraphEdit.ensureType(chain.doc, GRAPH_INDEX, "bool");
  chain.push(boolTypeCmd);

  // NONSTANDARD pointer: `/extensions/KHR_audio_emitter/sources/{i}/playing`
  // is not part of the base KHR_audio_emitter spec's Object Model — it is
  // this project's own prototype extension for one-shot playback
  // triggering from KHR_interactivity (see
  // packages/audio-webaudio/src/web-audio-host.ts's "NONSTANDARD" comment,
  // ~line 465, for the full rationale). Writing a truthy value (re)fires
  // every emitter instance referencing this source.
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

  const nodeName = getIn(document.json, ["nodes", nodeIndex, "name"]);
  const target = typeof nodeName === "string" ? `"${nodeName}"` : `node ${nodeIndex}`;

  return {
    summary: `When ${target} is clicked, play its sound.`,
    commands: chain.commands,
    validationReport: validateProposalGraph(chain.json, GRAPH_INDEX)
  };
}
