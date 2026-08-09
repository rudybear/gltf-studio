import { describe, expect, it } from "vitest";
import { MissingSelectionError, MockAgentProvider, UnrecognizedPromptError } from "./mock-agent-provider.js";
import { fixtureDocument } from "./test-fixtures.js";

function selection(nodeIndex: number) {
  return [{ kind: "selection" as const, nodeIndices: [nodeIndex] }];
}

describe("MockAgentProvider: unrecognized / missing-selection refusals", () => {
  it("rejects with UnrecognizedPromptError for a prompt no template matches", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    await expect(provider.request("what's the weather today", [])).rejects.toBeInstanceOf(UnrecognizedPromptError);
  });

  it("rejects with MissingSelectionError when 'spin' has no selection in context", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    await expect(provider.request("spin it", [])).rejects.toBeInstanceOf(MissingSelectionError);
  });

  it("rejects with MissingSelectionError when 'move' has no selection in context", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    await expect(provider.request("move it up", [])).rejects.toBeInstanceOf(MissingSelectionError);
  });

  it("never resolves to a fabricated Proposal on refusal (rejection, not a fake empty proposal)", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    await expect(provider.request("does not compute", [])).rejects.toThrow();
  });
});

describe("MockAgentProvider: spin/rotate template", () => {
  it("defaults to an event/onTick trigger", async () => {
    const doc = fixtureDocument();
    const provider = new MockAgentProvider(doc);
    const proposal = await provider.request("rotate the cube", selection(0));
    const graph = (proposal.commands.reduce((json, c) => applyAll(json, c.patches), doc.json) as {
      extensions: { KHR_interactivity: { graphs: Array<{ declarations: Array<{ op: string }>; nodes: Array<{ declaration: number }> }> } };
    }).extensions.KHR_interactivity.graphs[0];
    const eventNode = graph.nodes[0];
    expect(graph.declarations[eventNode.declaration].op).toBe("event/onTick");
  });

  it("uses an event/onSelect trigger when the prompt mentions click/tap/select", async () => {
    const doc = fixtureDocument();
    const provider = new MockAgentProvider(doc);
    const proposal = await provider.request("spin on click", selection(0));
    const graph = (proposal.commands.reduce((json, c) => applyAll(json, c.patches), doc.json) as {
      extensions: { KHR_interactivity: { graphs: Array<{ declarations: Array<{ op: string }>; nodes: Array<{ declaration: number }> }> } };
    }).extensions.KHR_interactivity.graphs[0];
    const eventNode = graph.nodes[0];
    expect(graph.declarations[eventNode.declaration].op).toBe("event/onSelect");
  });

  it("targets the pointer/interpolate node at the selected node's rotation", async () => {
    const doc = fixtureDocument();
    const provider = new MockAgentProvider(doc);
    const proposal = await provider.request("spin the selected node", selection(1));
    const pointerPatch = proposal.commands.flatMap((c) => c.patches).find((p) => JSON.stringify(p.value ?? "").includes("/nodes/1/rotation"));
    expect(pointerPatch).toBeDefined();
  });

  it("validationReport has no error findings for a well-formed spin proposal", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    const proposal = await provider.request("spin it", selection(0));
    expect(proposal.validationReport.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("MockAgentProvider: move template", () => {
  it("moves along +Y for 'move up' by the default distance", async () => {
    const doc = fixtureDocument();
    const provider = new MockAgentProvider(doc);
    const proposal = await provider.request("move up", selection(0));
    const after = applyAll(doc.json, proposal.commands[0].patches) as { nodes: Array<{ translation: number[] }> };
    expect(after.nodes[0].translation).toEqual([0, 1, 0]);
  });

  it("parses an explicit distance", async () => {
    const doc = fixtureDocument();
    const provider = new MockAgentProvider(doc);
    const proposal = await provider.request("move right 3", selection(0));
    const after = applyAll(doc.json, proposal.commands[0].patches) as { nodes: Array<{ translation: number[] }> };
    expect(after.nodes[0].translation).toEqual([3, 0, 0]);
  });

  it("offsets from the node's existing translation rather than overwriting it", async () => {
    const doc = fixtureDocument();
    const provider = new MockAgentProvider(doc);
    const proposal = await provider.request("move forward", selection(1)); // node 1 starts at translation [2,0,0]
    const after = applyAll(doc.json, proposal.commands[0].patches) as { nodes: Array<{ translation: number[] }> };
    expect(after.nodes[1].translation).toEqual([2, 0, -1]);
  });

  it("has no graph-related commands and an empty (vacuous) validation report", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    const proposal = await provider.request("move down", selection(0));
    expect(proposal.validationReport.findings).toEqual([]);
    for (const command of proposal.commands) {
      for (const patch of command.patches) {
        expect(patch.path.startsWith("/extensions/KHR_interactivity")).toBe(false);
      }
    }
  });
});

describe("MockAgentProvider: play-sound-on-click template", () => {
  it("fires for a node with resolvable KHR_audio_emitter audio", async () => {
    const doc = fixtureDocument({ withAudio: true });
    const provider = new MockAgentProvider(doc);
    const proposal = await provider.request("play sound on click", selection(0));
    expect(proposal.commands.length).toBeGreaterThan(0);
    const pointerValuePatch = proposal.commands
      .flatMap((c) => c.patches)
      .find((p) => JSON.stringify(p.value ?? "").includes("/extensions/KHR_audio_emitter/sources/0/playing"));
    expect(pointerValuePatch).toBeDefined();
  });

  it("falls through to the final refusal when the selected node has no audio and no other template matches", async () => {
    const provider = new MockAgentProvider(fixtureDocument({ withAudio: false }));
    await expect(provider.request("play sound on click", selection(0))).rejects.toBeInstanceOf(UnrecognizedPromptError);
  });
});

describe("MockAgentProvider: add-cube template", () => {
  it("defaults to 1 cube when no count is given", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    const proposal = await provider.request("add a cube", []);
    expect(proposal.generatedAssets?.length).toBe(1);
  });

  it("parses an explicit count", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    const proposal = await provider.request("generate 4 cubes", []);
    expect(proposal.generatedAssets?.length).toBe(4);
  });

  it("caps the count at 8 even if a larger number is requested", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    const proposal = await provider.request("create 500 boxes", []);
    expect(proposal.generatedAssets?.length).toBe(8);
  });

  it("works without any selection (spawns at the origin)", async () => {
    const provider = new MockAgentProvider(fixtureDocument());
    await expect(provider.request("add a cube", [])).resolves.toBeDefined();
  });
});

describe("MockAgentProvider.setDocument", () => {
  it("subsequent requests reflect the newly set document, not the constructor's original one", async () => {
    const original = fixtureDocument();
    const provider = new MockAgentProvider(original);
    const updated = fixtureDocument({ withAudio: true });
    provider.setDocument(updated);
    const proposal = await provider.request("play sound on click", selection(0));
    expect(proposal.commands.length).toBeGreaterThan(0); // only resolves because `updated` (not `original`) has audio
  });
});

function applyAll(json: unknown, patches: Array<{ op: string; path: string; value?: unknown }>): unknown {
  // Minimal local nested-patch applier for these assertion-only helpers —
  // deliberately not re-exporting editor-core's real applyPatches here so
  // this test file's own correctness doesn't depend on the thing it's
  // partly testing; getIn is used elsewhere in this file for read-only
  // lookups where a full apply isn't needed.
  let result = json;
  for (const patch of patches) {
    const segments = patch.path.split("/").filter(Boolean);
    result = setDeep(result, segments, patch.value);
  }
  return result;
}

function setDeep(json: unknown, segments: string[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  if (Array.isArray(json)) {
    const index = head === "-" ? json.length : Number(head);
    const copy = json.slice();
    if (rest.length === 0) {
      if (index === json.length) copy.splice(index, 0, value);
      else copy[index] = value;
    } else {
      copy[index] = setDeep(json[index], rest, value);
    }
    return copy;
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  if (rest.length === 0) return { ...obj, [head]: value };
  return { ...obj, [head]: setDeep(obj[head], rest, value) };
}
