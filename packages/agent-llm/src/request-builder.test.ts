// AG-023: the system prompt must always list EVERY node (index, name, audio-
// emitter flag) and the known trigger-event declarations, regardless of
// selection/explicit context -- found live against real models (see
// specs/agent-service.md AG-023's "real-model validation" implementation
// note): without this, a prompt naming an unselected node ("the pillar")
// got an honest but avoidable clarification refusal from every
// tool-calling-capable model tested.
import { describe, it, expect } from "vitest";
import { createDocument } from "@gltf-studio/editor-core";
import { buildSceneSummary, buildSystemPrompt } from "./request-builder.js";
import { containerFromJson, fixtureDocument } from "./test-fixtures.js";

function documentWithPillar() {
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    nodes: [
      { name: "Alpha", translation: [0, 0, 0] },
      { name: "Beta", translation: [2, 0, 0] },
      { name: "Pillar", translation: [0, 0, -3], extensions: { KHR_audio_emitter: { emitter: 0 } } }
    ],
    extensionsUsed: ["KHR_audio_emitter"],
    extensions: {
      KHR_audio_emitter: {
        audio: [{ uri: "data:audio/wav;base64,AAAA" }],
        sources: [{ audio: 0, gain: 1, autoplay: false, loop: false }],
        emitters: [{ type: "positional", gain: 1, sources: [0] }]
      }
    }
  };
  return createDocument(containerFromJson(json));
}

describe("buildSceneSummary / buildSystemPrompt (AG-023)", () => {
  it("lists every node by index and name even with no selection or context (AG-023)", () => {
    const document = documentWithPillar();
    const summary = buildSceneSummary(document, []);
    expect(summary).toContain('[0] "Alpha"');
    expect(summary).toContain('[1] "Beta"');
    expect(summary).toContain('[2] "Pillar"');
  });

  it("flags which node has a KHR_audio_emitter, and which don't (AG-023)", () => {
    const document = documentWithPillar();
    const summary = buildSceneSummary(document, []);
    expect(summary).toMatch(/\[2] "Pillar" \(has audio emitter\)/);
    expect(summary).not.toMatch(/\[0] "Alpha".*\(has audio emitter\)/);
    expect(summary).not.toMatch(/\[1] "Beta".*\(has audio emitter\)/);
  });

  it("still describes the selected node's transform/audio flag specifically, in addition to the full list (AG-023)", () => {
    const document = documentWithPillar();
    const summary = buildSceneSummary(document, [{ kind: "selection", nodeIndices: [2] }]);
    expect(summary).toMatch(/selected: nodeIndex=2, name="Pillar", translation=\[0, 0, -3], hasAudioEmitter=true/);
  });

  it("the full node list survives even when the selected/context node is a DIFFERENT one (AG-023's core fix)", () => {
    // The exact shape of the divergence found live: the user has node 0
    // selected, but the prompt names "the pillar" (node 2) -- the model
    // needs node 2 in the summary to resolve that reference at all.
    const document = documentWithPillar();
    const summary = buildSceneSummary(document, [{ kind: "selection", nodeIndices: [0] }]);
    expect(summary).toContain('[2] "Pillar" (has audio emitter)');
  });

  it("lists the known KHR_interactivity trigger events in the system prompt (AG-023)", () => {
    const document = fixtureDocument();
    const prompt = buildSystemPrompt(document, []);
    expect(prompt).toContain("event/onSelect");
    expect(prompt).toContain("event/onTick");
    expect(prompt).toContain("event/onHoverIn");
    expect(prompt).toContain("event/onHoverOut");
    expect(prompt).toContain("event/onStart");
  });

  it("falls back to an explicit empty-document message when there are no nodes, no context, and no graph variables", () => {
    const document = createDocument(
      containerFromJson({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }], nodes: [] })
    );
    const summary = buildSceneSummary(document, []);
    expect(summary).toMatch(/empty document/i);
  });
});
