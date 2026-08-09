// Unit tests for the Copilot store slice added in Phase 2 of the agentic-
// authoring UI (specs/ux-copilot.md UX-10xx, specs/agent-service.md AG-###,
// docs/adr/0004-agentic-authoring-as-command-producer.md). Mirrors
// app-store.test.ts's own conventions exactly (a minimal fake
// Container/RenderHost, a mocked `@gltf-studio/play`/`@gltf-studio/storage`)
// rather than a second harness -- the real `MockAgentProvider` (a pure,
// deterministic, offline `AgentService`, per AG-010) is used AS-IS, the same
// way `packages/agent-mock`'s own tests do, since it has no side effects
// worth mocking out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Container } from "@gltfi/gltf";
import { createDocument, HistoryStack } from "@gltf-studio/editor-core";
import type { CameraPose, PatchOutcome, RenderHost } from "@gltf-studio/engine-api";
import { buildBehaviorNeutralProposalForTests, buildDeliberatelyBrokenProposalForTests } from "@gltf-studio/agent-mock";

const controllerMocks = {
  start: vi.fn(async () => {}),
  pause: vi.fn(),
  resume: vi.fn(),
  tickOnce: vi.fn(),
  stop: vi.fn(async () => {}),
  inspect: vi.fn(() => ({ time: 0, variables: {}, sentEvents: [] })),
  onDiagnostic: vi.fn(() => () => {}),
  fireSelect: vi.fn(),
  fireHoverIn: vi.fn(),
  fireHoverOut: vi.fn()
};

vi.mock("@gltf-studio/play", () => ({
  createPlayController: vi.fn(() => controllerMocks)
}));

const autosaveJournal = vi.fn(async () => {});
vi.mock("@gltf-studio/storage", () => ({
  IndexedDBStorage: class {
    capabilities = { fileHandles: false, remote: false };
    autosaveJournal = autosaveJournal;
  }
}));

const { useAppStore } = await import("./app-store.js");

function fakeContainer(json: unknown): Container {
  return {
    kind: "glb",
    chunks: [],
    jsonChunkIndex: 0,
    jsonText: JSON.stringify(json),
    json,
    binaryChunk: undefined
  };
}

function fakeRenderHost(): RenderHost {
  return {
    mount: vi.fn(),
    loadScene: vi.fn(async () => {}),
    dispose: vi.fn(),
    patchScene: vi.fn((): PatchOutcome => "applied"),
    pick: vi.fn(() => null),
    getCameraPose: vi.fn((): CameraPose => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1] })),
    setCameraPose: vi.fn(),
    attachGizmo: vi.fn(),
    detachGizmo: vi.fn(),
    onGizmoChange: vi.fn(() => () => {}),
    applyPointer: vi.fn(),
    setHighlight: vi.fn(),
    snapshot: vi.fn(async () => new Blob())
  };
}

/** A minimal document with one node and an existing KHR_interactivity graph[0] -- enough for both the real MockAgentProvider templates and the neutral-claim/broken TEST-ONLY fixtures (which require a pre-existing graph[0]). */
function fixtureJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Cube" }],
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [{ types: [{ signature: "float" }], declarations: [{ op: "event/onStart" }], variables: [], events: [], nodes: [{ declaration: 0, flows: {} }] }]
      }
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  controllerMocks.start.mockResolvedValue(undefined);
  controllerMocks.stop.mockResolvedValue(undefined);

  const document = createDocument(fakeContainer(fixtureJson()));
  const history = new HistoryStack(document);
  useAppStore.setState({
    projectId: "proj-1",
    document,
    history,
    renderHost: fakeRenderHost(),
    playState: "stopped",
    playEngine: "interpreter",
    selectedNodeIndex: null,
    copilotContextChips: [],
    copilotThread: [],
    copilotPrompt: "",
    tryInPlayController: null,
    tryInPlayEntryId: null,
    toasts: [],
    consoleLines: []
  });
});

describe("context chips (UX-1001/1002, AG-013)", () => {
  it("addCopilotContextChip appends a chip", () => {
    useAppStore.getState().addCopilotContextChip({ kind: "explicit", label: "Graph 0", pointer: "/extensions/KHR_interactivity/graphs/0" }, "Graph 0");
    expect(useAppStore.getState().copilotContextChips).toHaveLength(1);
    expect(useAppStore.getState().copilotContextChips[0].label).toBe("Graph 0");
  });

  it("de-dupes by the ref's equality key (same pointer), even under a different label", () => {
    const { addCopilotContextChip } = useAppStore.getState();
    addCopilotContextChip({ kind: "explicit", label: "A", pointer: "/materials/0" }, "A");
    addCopilotContextChip({ kind: "explicit", label: "B (same pointer)", pointer: "/materials/0" }, "B (same pointer)");
    expect(useAppStore.getState().copilotContextChips).toHaveLength(1);
    expect(useAppStore.getState().copilotContextChips[0].label).toBe("A");
  });

  it("does not de-dupe distinct selections", () => {
    const { addCopilotContextChip } = useAppStore.getState();
    addCopilotContextChip({ kind: "selection", nodeIndices: [0] }, "Node 0");
    addCopilotContextChip({ kind: "selection", nodeIndices: [1] }, "Node 1");
    expect(useAppStore.getState().copilotContextChips).toHaveLength(2);
  });

  it("removeCopilotContextChip removes exactly the targeted chip", () => {
    const { addCopilotContextChip, removeCopilotContextChip } = useAppStore.getState();
    addCopilotContextChip({ kind: "explicit", label: "A", pointer: "/materials/0" }, "A");
    const id = useAppStore.getState().copilotContextChips[0].id;
    removeCopilotContextChip(id);
    expect(useAppStore.getState().copilotContextChips).toHaveLength(0);
  });
});

describe("sendCopilotPrompt (UX-1011, AG-012)", () => {
  it("appends the user message and clears the composer synchronously, auto-attaches the selection chip, then resolves a proposal card", async () => {
    useAppStore.setState({ selectedNodeIndex: 0, copilotPrompt: "spin the selected node" });
    const promise = useAppStore.getState().sendCopilotPrompt();

    // Ordering (UX-1011): the user message + pending bubble + cleared
    // composer, and the auto-selection chip, are all visible IMMEDIATELY --
    // before the (already-resolved-by-now-if-we-awaited, but we haven't yet)
    // response lands.
    const midState = useAppStore.getState();
    expect(midState.copilotPrompt).toBe("");
    expect(midState.copilotThread.some((e) => e.kind === "user" && e.text === "spin the selected node")).toBe(true);
    expect(midState.copilotContextChips.some((c) => c.ref.kind === "selection" && c.ref.nodeIndices[0] === 0)).toBe(true);

    await promise;

    const proposalEntry = useAppStore.getState().copilotThread.find((e) => e.kind === "proposal");
    expect(proposalEntry).toBeDefined();
    expect(proposalEntry!.kind === "proposal" && proposalEntry!.state).toBe("pending");
  });

  it("an unrecognized prompt resolves to a plain refusal thread entry, not a proposal card", async () => {
    useAppStore.setState({ copilotPrompt: "make it purple and dance" });
    await useAppStore.getState().sendCopilotPrompt();
    const entries = useAppStore.getState().copilotThread;
    expect(entries.some((e) => e.kind === "refusal")).toBe(true);
    expect(entries.some((e) => e.kind === "proposal")).toBe(false);
  });

  it("does nothing on an empty/whitespace-only prompt", async () => {
    useAppStore.setState({ copilotPrompt: "   " });
    await useAppStore.getState().sendCopilotPrompt();
    expect(useAppStore.getState().copilotThread).toHaveLength(0);
  });
});

describe("acceptCopilotProposal (AG-004..008, UX-1006/1008)", () => {
  it("applies an eligible proposal as one HistoryStack transact, relabels the first command 'Copilot: <summary>', and marks the card accepted", async () => {
    useAppStore.setState({ selectedNodeIndex: 0, copilotPrompt: "spin the selected node" });
    await useAppStore.getState().sendCopilotPrompt();
    const entry = useAppStore.getState().copilotThread.find((e) => e.kind === "proposal")!;
    const summary = entry.kind === "proposal" ? entry.proposal.summary : "";

    const historyBefore = useAppStore.getState().history!;
    const undoCountBefore = historyBefore.entries().length;

    useAppStore.getState().acceptCopilotProposal(entry.id);

    const state = useAppStore.getState();
    const updatedEntry = state.copilotThread.find((e) => e.id === entry.id)!;
    expect(updatedEntry.kind === "proposal" && updatedEntry.state).toBe("accepted");
    expect(state.projectDirty).toBe(true);

    // AG-004: exactly ONE new undo-log entry regardless of how many commands the proposal bundled.
    expect(state.history!.entries().length).toBe(undoCountBefore + 1);
    expect(state.history!.entries().at(-1)!.label).toBe(`Copilot: ${summary}`);

    // AG-005: the same autosave-journal call dispatchCommand makes.
    expect(autosaveJournal).toHaveBeenCalled();
  });

  it("is a no-op (toasts, no history entry) when the proposal has an error-level finding (AG-008)", () => {
    const document = useAppStore.getState().history!.document;
    const proposal = buildDeliberatelyBrokenProposalForTests(document);
    useAppStore.setState({
      copilotThread: [{ kind: "proposal", id: "p1", proposal, state: "pending", expanded: false }]
    });
    const undoCountBefore = useAppStore.getState().history!.entries().length;

    useAppStore.getState().acceptCopilotProposal("p1");

    expect(useAppStore.getState().history!.entries().length).toBe(undoCountBefore);
    const entry = useAppStore.getState().copilotThread[0];
    expect(entry.kind === "proposal" && entry.state).toBe("pending"); // unchanged
    expect(useAppStore.getState().toasts.at(-1)?.text).toMatch(/validation errors/i);
  });

  it("is a no-op when the proposal claims behavior-neutral with no EQUIV result (AG-007)", () => {
    const document = useAppStore.getState().history!.document;
    const base = buildBehaviorNeutralProposalForTests(document);
    // Strip equivChecks to exercise the "claims neutral, no EQUIV" branch specifically.
    const proposal = { ...base, validationReport: { findings: base.validationReport.findings } };
    useAppStore.setState({
      copilotThread: [{ kind: "proposal", id: "p2", proposal, state: "pending", expanded: false }]
    });
    const undoCountBefore = useAppStore.getState().history!.entries().length;

    useAppStore.getState().acceptCopilotProposal("p2");

    expect(useAppStore.getState().history!.entries().length).toBe(undoCountBefore);
    expect(useAppStore.getState().toasts.at(-1)?.text).toMatch(/EQUIV/i);
  });

  it("accepts a behavior-neutral proposal that DOES carry an EQUIV result (AG-007 positive case)", () => {
    const document = useAppStore.getState().history!.document;
    const proposal = buildBehaviorNeutralProposalForTests(document);
    useAppStore.setState({
      copilotThread: [{ kind: "proposal", id: "p3", proposal, state: "pending", expanded: false }]
    });
    const undoCountBefore = useAppStore.getState().history!.entries().length;

    useAppStore.getState().acceptCopilotProposal("p3");

    expect(useAppStore.getState().history!.entries().length).toBe(undoCountBefore + 1);
    const entry = useAppStore.getState().copilotThread[0];
    expect(entry.kind === "proposal" && entry.state).toBe("accepted");
  });

  it("is blocked (same toast as a manual edit) while real play mode is running", () => {
    const document = useAppStore.getState().history!.document;
    const proposal = buildBehaviorNeutralProposalForTests(document);
    useAppStore.setState({
      playState: "playing",
      copilotThread: [{ kind: "proposal", id: "p4", proposal, state: "pending", expanded: false }]
    });
    const undoCountBefore = useAppStore.getState().history!.entries().length;

    useAppStore.getState().acceptCopilotProposal("p4");

    expect(useAppStore.getState().history!.entries().length).toBe(undoCountBefore);
    expect(useAppStore.getState().toasts.at(-1)?.text).toBe("Document locked while playing — Stop to edit.");
  });
});

describe("rejectCopilotProposal (AG-009)", () => {
  it("only flips the thread entry's state -- zero history/storage mutation", () => {
    const document = useAppStore.getState().history!.document;
    const proposal = buildBehaviorNeutralProposalForTests(document);
    useAppStore.setState({
      copilotThread: [{ kind: "proposal", id: "p5", proposal, state: "pending", expanded: false }]
    });
    const historyBefore = useAppStore.getState().history!;
    const revBefore = historyBefore.document.rev;
    const undoCountBefore = historyBefore.entries().length;

    useAppStore.getState().rejectCopilotProposal("p5");

    expect(useAppStore.getState().history!.document.rev).toBe(revBefore);
    expect(useAppStore.getState().history!.entries().length).toBe(undoCountBefore);
    expect(autosaveJournal).not.toHaveBeenCalled();
    const entry = useAppStore.getState().copilotThread[0];
    expect(entry.kind === "proposal" && entry.state).toBe("rejected");
  });
});

describe("Try in play (Part B, apply-scratch-play-discard, UX-1007)", () => {
  it("previews without ever touching history.document.rev, and restores the real document on stop", async () => {
    const document = useAppStore.getState().history!.document;
    const proposal = buildBehaviorNeutralProposalForTests(document);
    useAppStore.setState({
      copilotThread: [{ kind: "proposal", id: "p6", proposal, state: "pending", expanded: false }]
    });
    const revBefore = useAppStore.getState().history!.document.rev;

    await useAppStore.getState().startTryInPlay("p6");

    expect(useAppStore.getState().history!.document.rev).toBe(revBefore);
    expect(useAppStore.getState().playState).toBe("stopped"); // NOT real play mode (design note)
    expect(useAppStore.getState().tryInPlayEntryId).toBe("p6");
    expect(controllerMocks.start).toHaveBeenCalledWith({ engine: "interpreter" });

    const renderHost = useAppStore.getState().renderHost!;
    await useAppStore.getState().stopTryInPlay();

    expect(controllerMocks.stop).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tryInPlayController).toBeNull();
    expect(useAppStore.getState().tryInPlayEntryId).toBeNull();
    expect(useAppStore.getState().history!.document.rev).toBe(revBefore);
    // The "discard" half: an explicit final loadScene back to the real committed json (+ binary, see sceneSourceOf).
    expect(renderHost.loadScene).toHaveBeenLastCalledWith({
      json: useAppStore.getState().history!.document.json,
      binary: null
    });
  });

  it("does not block acceptCopilotProposal for a DIFFERENT proposal while previewing one", async () => {
    const document = useAppStore.getState().history!.document;
    const previewed = buildBehaviorNeutralProposalForTests(document);
    const other = buildBehaviorNeutralProposalForTests(document);
    useAppStore.setState({
      copilotThread: [
        { kind: "proposal", id: "preview-me", proposal: previewed, state: "pending", expanded: false },
        { kind: "proposal", id: "accept-me", proposal: other, state: "pending", expanded: false }
      ]
    });

    await useAppStore.getState().startTryInPlay("preview-me");
    expect(useAppStore.getState().playState).toBe("stopped");

    const undoCountBefore = useAppStore.getState().history!.entries().length;
    useAppStore.getState().acceptCopilotProposal("accept-me");

    expect(useAppStore.getState().history!.entries().length).toBe(undoCountBefore + 1);
    const acceptedEntry = useAppStore.getState().copilotThread.find((e) => e.id === "accept-me")!;
    expect(acceptedEntry.kind === "proposal" && acceptedEntry.state).toBe("accepted");
  });
});
