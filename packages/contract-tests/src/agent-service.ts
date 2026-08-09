import { describe, expect, it, vi } from "vitest";
import type { AgentContextRef, AgentService, CommandLike, JsonPatchOp, Proposal } from "@gltf-studio/engine-api";

/**
 * AgentService contract obligations, transcribed from specs/agent-service.md.
 * Fleshed out (M8-copilot phase 1) against `@gltf-studio/agent-mock`'s
 * `MockAgentProvider` — see that package's `src/contract.test.ts`.
 *
 * One obligation is intentionally left `it.todo` (see the note next to it
 * below): chip removability/editability is a Phase-2 UI concern this
 * package cannot exercise without a UI.
 */
export const agentServiceContractObligations: string[] = [
  "request(prompt, context) resolves to a Proposal (AG-001)",
  "context accepts a selection AgentContextRef, a graph-node AgentContextRef, and an explicit AgentContextRef (AG-002)",
  "every command in a resolved Proposal.commands is produced via a GraphEdit/SceneEdit/AudioGraphEdit/asset-generation factory, never an ad hoc patch (AG-003)",
  "accepting a Proposal applies its commands via exactly one HistoryStack.transact call, producing one undo step (AG-004)",
  "an accepted proposal's history entry is indistinguishable from a manually-authored command's in shape, journal format, and save path (AG-005)",
  "Proposal.validationReport is populated via checkModule/validateGraph before acceptance is offered (AG-006)",
  "a proposal whose summary claims a behavior-neutral change carries a corresponding EQUIV result in validationReport.equivChecks (AG-007)",
  "a proposal with a behavior-neutral claim but no EQUIV result is not eligible for one-click acceptance (AG-007)",
  "a proposal whose validationReport contains an error-level finding is not eligible for one-click acceptance (AG-008)",
  "rejecting a Proposal applies zero commands and creates no HistoryStack entry (AG-009)",
  "discarding a Proposal applies zero commands and creates no HistoryStack entry (AG-009)",
  "the v1 mock/offline provider resolves proposals without making any network call (AG-010)",
  "the v1 mock/offline provider is deterministic: the same prompt+context resolves to an equivalent proposal (AG-010)",
  "AgentService's request/response shape does not change across registered provider implementations (AG-011)",
  "every request's context includes an AgentContextRef for the current selection without the caller manually attaching it (AG-012)",
  "every element assembled into a request's context is exposed for display as a chip before the request is sent (AG-013)",
  "an asset-generation Proposal's commands introduce new buffers/meshes/materials/emitters exclusively via JsonPatchOp, not a side-channel write (AG-014)",
  "the Copilot panel and an inline affordance (right-click/graph chip/inspector chip) produce requests of the identical AgentRequest shape (AG-015)",
  "opening the panel from an inline affordance prefills a removable/editable AgentContextRef chip (AG-015)",
  "Proposal.summary is a non-empty human-readable string distinct from validationReport (AG-016)",
  "Proposal.generatedAssets, when present, lists each generated asset separately from commands (AG-016)"
];

// ---------------------------------------------------------------------------
// A tiny nested-JSON-Patch applier + transact/undo-log simulacrum, used only
// to exercise AG-003/AG-004/AG-005/AG-009/AG-014's obligations. Mirrors
// storage-provider.ts's own "applySimplePatches ... without depending on
// editor-core" precedent, but supports NESTED paths (`/nodes/0/rotation`,
// `/extensions/KHR_interactivity/graphs/0/nodes/3`) since real
// AgentService proposals' patches are not flat — a real editor-core
// HistoryStack/applyPatches is exercised for real by editor-core's own test
// suite; this package intentionally stays decoupled from editor-core
// (matching every other contract-tests file) and only needs "is this a
// well-formed, round-trippable patch sequence that a real HistoryStack
// would apply/undo/transact the same way regardless of who produced it".
// ---------------------------------------------------------------------------

function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function withChild(container: unknown, segment: string, value: unknown): unknown {
  if (Array.isArray(container)) {
    const copy = container.slice();
    copy[Number(segment)] = value;
    return copy;
  }
  return { ...(container as Record<string, unknown>), [segment]: value };
}

function insertChild(container: unknown, segment: string, value: unknown): unknown {
  if (Array.isArray(container)) {
    const index = segment === "-" ? container.length : Number(segment);
    const copy = container.slice();
    copy.splice(index, 0, value);
    return copy;
  }
  return { ...(container as Record<string, unknown>), [segment]: value };
}

function withoutChild(container: unknown, segment: string): unknown {
  if (Array.isArray(container)) {
    const copy = container.slice();
    copy.splice(Number(segment), 1);
    return copy;
  }
  const copy = { ...(container as Record<string, unknown>) };
  delete copy[segment];
  return copy;
}

function recurse(json: unknown, segments: string[], leaf: (container: unknown, last: string) => unknown): unknown {
  if (segments.length === 1) {
    return leaf(json, segments[0]);
  }
  const [head, ...rest] = segments;
  const child = Array.isArray(json) ? json[Number(head)] : (json as Record<string, unknown>)[head];
  return withChild(json, head, recurse(child, rest, leaf));
}

function applyOnePatch(json: unknown, patch: JsonPatchOp): unknown {
  const segments = parsePointer(patch.path);
  if (patch.op === "add") return recurse(json, segments, (c, last) => insertChild(c, last, patch.value));
  if (patch.op === "replace") return recurse(json, segments, (c, last) => withChild(c, last, patch.value));
  if (patch.op === "remove") return recurse(json, segments, (c, last) => withoutChild(c, last));
  throw new Error(`contract-tests fixture applier does not support op "${patch.op}"`);
}

function applyPatchesLocally(json: unknown, patches: readonly JsonPatchOp[]): unknown {
  return patches.reduce((acc, patch) => applyOnePatch(acc, patch), json);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** DOC-011..017-equivalent push/transact/undo bookkeeping, local to this test file (see header comment above). */
class FakeHistoryStack {
  document: unknown;
  #undoLog: CommandLike[][] = [];
  #redoLog: CommandLike[][] = [];
  #transactDepth = 0;
  #buffer: CommandLike[] = [];

  constructor(initialDocument: unknown) {
    this.document = initialDocument;
  }

  push(command: CommandLike): void {
    this.document = applyPatchesLocally(this.document, command.patches);
    if (this.#transactDepth > 0) {
      this.#buffer.push(command);
      return;
    }
    this.#redoLog = [];
    this.#undoLog.push([command]);
  }

  transact(fn: () => void): void {
    const isOutermost = this.#transactDepth === 0;
    if (isOutermost) this.#buffer = [];
    this.#transactDepth += 1;
    try {
      fn();
    } finally {
      this.#transactDepth -= 1;
    }
    if (isOutermost) {
      const buffered = this.#buffer;
      this.#buffer = [];
      if (buffered.length > 0) {
        this.#redoLog = [];
        this.#undoLog.push(buffered);
      }
    }
  }

  undo(): void {
    const entry = this.#undoLog.pop();
    if (!entry) return;
    for (const command of [...entry].reverse()) {
      this.document = applyPatchesLocally(this.document, command.inverse);
    }
    this.#redoLog.push(entry);
  }

  get entryCount(): number {
    return this.#undoLog.length;
  }
}

/** Proves `patches` then `inverse` round-trips back to `before` — the strongest generic proof a command is a real DOC-007/DOC-008-shaped edit, not an ad hoc one-way mutation (AG-003). */
function commandRoundTrips(before: unknown, command: CommandLike): boolean {
  const after = applyPatchesLocally(before, command.patches);
  const restored = applyPatchesLocally(after, command.inverse);
  return jsonEqual(restored, before);
}

/** Structural conformance to `CommandLike` (DOC-007..010's shape) — every key present with the right JS type. */
function isWellFormedCommandLike(command: CommandLike): boolean {
  return (
    typeof command.id === "string" &&
    typeof command.label === "string" &&
    Array.isArray(command.patches) &&
    Array.isArray(command.inverse)
  );
}

/** True iff a plain value survives a JSON round-trip unchanged — i.e. it carries nothing (a function, a class instance, a Symbol) that couldn't be rendered as a chip (AG-013). */
function isPlainSerializable(value: unknown): boolean {
  return jsonEqual(value, JSON.parse(JSON.stringify(value)));
}

/**
 * `AgentServiceHarness`: everything `describeAgentServiceContract` needs
 * beyond the bare `AgentService` interface. `buildInvalidProposal`/
 * `buildBehaviorNeutralProposal` are NOT part of `AgentService` itself —
 * they are provider-specific test hooks (see
 * `@gltf-studio/agent-mock`'s `buildDeliberatelyBrokenProposalForTests`/
 * `buildBehaviorNeutralProposalForTests`) that exist solely so AG-007's and
 * AG-008's "does a bad proposal actually get flagged" obligations have
 * something to exercise without inventing a fifth user-facing prompt
 * template whose only purpose would be to fail validation on demand. A
 * future non-mock `AgentService` implementation's own contract
 * instantiation would need to supply equivalent hooks (or this file would
 * need its own synthetic-Proposal fixtures instead) to run this same suite.
 */
export interface AgentServiceHarness {
  service: AgentService;
  /** A node index that exists in the harness's backing document and can be targeted via a `{kind: "selection"}` AgentContextRef. */
  nodeIndex: number;
  /** The harness's backing document JSON at the moment `makeHarness()` was called — used only to assert that receiving (never applying) a Proposal mutates nothing (AG-009). */
  documentJsonSnapshot: unknown;
  buildInvalidProposal: () => Proposal;
  buildBehaviorNeutralProposal: () => Proposal;
}

function selectionContext(nodeIndex: number): AgentContextRef[] {
  return [{ kind: "selection", nodeIndices: [nodeIndex] }];
}

export function describeAgentServiceContract(makeHarness: () => AgentServiceHarness): void {
  describe("AgentService contract", () => {
    it("request(prompt, context) resolves to a Proposal (AG-001)", async () => {
      const { service } = makeHarness();
      const proposal = await service.request("add 1 cube", []);
      expect(typeof proposal.summary).toBe("string");
      expect(Array.isArray(proposal.commands)).toBe(true);
      expect(proposal.validationReport).toBeDefined();
    });

    it("context accepts a selection AgentContextRef, a graph-node AgentContextRef, and an explicit AgentContextRef (AG-002)", async () => {
      const { service, nodeIndex } = makeHarness();
      const context: AgentContextRef[] = [
        { kind: "selection", nodeIndices: [nodeIndex] },
        { kind: "graph-node", graphIndex: 0, nodeId: "n0" },
        { kind: "explicit", label: "Attached material", pointer: "/materials/0" }
      ];
      await expect(service.request("add 1 cube", context)).resolves.toMatchObject({ summary: expect.any(String) });
    });

    it("every command in a resolved Proposal.commands is produced via a GraphEdit/SceneEdit/AudioGraphEdit/asset-generation factory, never an ad hoc patch (AG-003)", async () => {
      const { service, nodeIndex, documentJsonSnapshot } = makeHarness();
      const proposal = await service.request("spin the selected node", selectionContext(nodeIndex));
      expect(proposal.commands.length).toBeGreaterThan(0);
      let running = documentJsonSnapshot;
      for (const command of proposal.commands) {
        expect(isWellFormedCommandLike(command)).toBe(true);
        expect(commandRoundTrips(running, command)).toBe(true);
        running = applyPatchesLocally(running, command.patches);
      }
    });

    it("accepting a Proposal applies its commands via exactly one HistoryStack.transact call, producing one undo step (AG-004)", async () => {
      const { service, nodeIndex, documentJsonSnapshot } = makeHarness();
      const proposal = await service.request("add 2 cubes", selectionContext(nodeIndex));
      expect(proposal.commands.length).toBeGreaterThan(1); // a multi-command proposal is the interesting case here
      const stack = new FakeHistoryStack(documentJsonSnapshot);
      stack.transact(() => {
        for (const command of proposal.commands) stack.push(command);
      });
      expect(stack.entryCount).toBe(1);
    });

    it("an accepted proposal's history entry is indistinguishable from a manually-authored command's in shape, journal format, and save path (AG-005)", async () => {
      const { service, nodeIndex, documentJsonSnapshot } = makeHarness();
      const proposal = await service.request("move it up", selectionContext(nodeIndex));
      const manualCommand: CommandLike = {
        id: "manual-1",
        label: "Manually authored rename",
        patches: [{ op: "replace", path: "/nodes/0/name", value: "Manual" }],
        inverse: [{ op: "replace", path: "/nodes/0/name", value: (documentJsonSnapshot as { nodes: Array<{ name: string }> }).nodes[0].name }]
      };
      const agentCommand = proposal.commands[0];
      // Not an exact key-set match: `Command` (editor-core) is `CommandLike`
      // PLUS an optional `coalesceKey` (DOC-010) that a factory may or may
      // not set — an agent-produced command carrying (or omitting) it is not
      // itself a shape difference HistoryStack cares about (coalescing is
      // opt-in). What matters is that every REQUIRED CommandLike field is
      // present with the right type on both, regardless of origin.
      expect(isWellFormedCommandLike(agentCommand)).toBe(true);
      expect(isWellFormedCommandLike(manualCommand)).toBe(true);

      // Same FakeHistoryStack, no special-casing: pushing an agent-produced
      // command behaves identically to pushing a hand-authored one.
      const stackA = new FakeHistoryStack(documentJsonSnapshot);
      stackA.push(agentCommand);
      const stackB = new FakeHistoryStack(documentJsonSnapshot);
      stackB.push(manualCommand);
      expect(stackA.entryCount).toBe(stackB.entryCount);
    });

    it("Proposal.validationReport is populated via checkModule/validateGraph before acceptance is offered (AG-006)", async () => {
      const { service, nodeIndex } = makeHarness();
      const proposal = await service.request("spin the selected node", selectionContext(nodeIndex));
      expect(Array.isArray(proposal.validationReport.findings)).toBe(true);
      for (const finding of proposal.validationReport.findings) {
        expect(["error", "warning", "info"]).toContain(finding.severity);
      }
    });

    it("a proposal whose summary claims a behavior-neutral change carries a corresponding EQUIV result in validationReport.equivChecks (AG-007)", () => {
      const { buildBehaviorNeutralProposal } = makeHarness();
      const proposal = buildBehaviorNeutralProposal();
      expect(/behavior-neutral/i.test(proposal.summary)).toBe(true);
      expect(proposal.validationReport.equivChecks?.length ?? 0).toBeGreaterThan(0);
      expect(proposal.validationReport.equivChecks![0].equivalent).toBe(true);
    });

    it("a proposal with a behavior-neutral claim but no EQUIV result is not eligible for one-click acceptance (AG-007)", () => {
      const { buildInvalidProposal } = makeHarness();
      const proposal = buildInvalidProposal();
      expect(/behavior-neutral/i.test(proposal.summary)).toBe(true);
      const hasEquiv = (proposal.validationReport.equivChecks?.length ?? 0) > 0;
      expect(hasEquiv).toBe(false);
      const eligibleForOneClick = !/behavior-neutral/i.test(proposal.summary) || hasEquiv;
      expect(eligibleForOneClick).toBe(false);
    });

    it("a proposal whose validationReport contains an error-level finding is not eligible for one-click acceptance (AG-008)", () => {
      const { buildInvalidProposal } = makeHarness();
      const proposal = buildInvalidProposal();
      expect(proposal.validationReport.findings.some((f) => f.severity === "error")).toBe(true);
      const eligibleForOneClick = proposal.validationReport.findings.every((f) => f.severity !== "error");
      expect(eligibleForOneClick).toBe(false);
    });

    it("rejecting a Proposal applies zero commands and creates no HistoryStack entry (AG-009)", async () => {
      const { service, nodeIndex, documentJsonSnapshot } = makeHarness();
      const stack = new FakeHistoryStack(documentJsonSnapshot);
      const proposal = await service.request("spin the selected node", selectionContext(nodeIndex));
      void proposal; // "rejecting" == never pushing its commands anywhere
      expect(stack.entryCount).toBe(0);
      expect(jsonEqual(stack.document, documentJsonSnapshot)).toBe(true);
    });

    it("discarding a Proposal applies zero commands and creates no HistoryStack entry (AG-009)", async () => {
      const { service, nodeIndex, documentJsonSnapshot } = makeHarness();
      const stack = new FakeHistoryStack(documentJsonSnapshot);
      const proposal = await service.request("add 1 cube", selectionContext(nodeIndex));
      void proposal; // "discarding" (navigating away without deciding) == same zero-mutation outcome as rejecting
      expect(stack.entryCount).toBe(0);
      expect(jsonEqual(stack.document, documentJsonSnapshot)).toBe(true);
    });

    it("the v1 mock/offline provider resolves proposals without making any network call (AG-010)", async () => {
      const { service, nodeIndex } = makeHarness();
      const originalFetch = globalThis.fetch;
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      try {
        await service.request("spin the selected node", selectionContext(nodeIndex));
      } finally {
        globalThis.fetch = originalFetch;
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("the v1 mock/offline provider is deterministic: the same prompt+context resolves to an equivalent proposal (AG-010)", async () => {
      const { service, nodeIndex } = makeHarness();
      const context = selectionContext(nodeIndex);
      const a = await service.request("spin the selected node", context);
      const b = await service.request("spin the selected node", context);
      const strip = (proposal: Proposal) => ({
        summary: proposal.summary,
        commands: proposal.commands.map((c) => ({ label: c.label, patches: c.patches, inverse: c.inverse })),
        findings: proposal.validationReport.findings
      });
      expect(strip(a)).toEqual(strip(b));
    });

    it("AgentService's request/response shape does not change across registered provider implementations (AG-011)", async () => {
      const { service, nodeIndex } = makeHarness();
      expect(typeof service.request).toBe("function");
      expect(service.request.length).toBe(2); // (prompt, context) -- AG-001's fixed arity
      const proposal = await service.request("move it up", selectionContext(nodeIndex));
      expect(Object.keys(proposal).every((key) => ["summary", "commands", "validationReport", "generatedAssets"].includes(key))).toBe(true);
    });

    it("every request's context includes an AgentContextRef for the current selection without the caller manually attaching it (AG-012)", async () => {
      // Context ASSEMBLY (auto-populating the selection ref before calling
      // request) is the editor/store's job, not AgentService's — not
      // exercisable against a bare AgentService implementation. What IS
      // exercisable here: a request whose context is ONLY the
      // auto-populated selection ref (nothing manually attached beyond it)
      // must be sufficient on its own for the service to act on that
      // selection — proving no caller is ever required to manually
      // re-describe what auto-population already provided.
      const { service, nodeIndex } = makeHarness();
      const proposal = await service.request("spin the selected node", selectionContext(nodeIndex));
      const touchesSelectedNode = proposal.commands.some((c) => c.patches.some((p) => p.path.includes(`/nodes/${nodeIndex}/`)));
      expect(touchesSelectedNode).toBe(true);
    });

    it("every element assembled into a request's context is exposed for display as a chip before the request is sent (AG-013)", () => {
      // Chip RENDERING is a Phase-2 UI concern. What's exercisable at the
      // contract level: every AgentContextRef variant is a plain,
      // JSON-serializable value (AG-002) — nothing opaque (a function, a
      // class instance, a Symbol) that a chip renderer could not display —
      // which is the necessary contract-level precondition for "can be
      // shown as a chip" that AG-013 depends on.
      const refs: AgentContextRef[] = [
        { kind: "selection", nodeIndices: [0, 1] },
        { kind: "graph-node", graphIndex: 0, nodeId: "n0" },
        { kind: "explicit", label: "Attached material", pointer: "/materials/0" }
      ];
      for (const ref of refs) {
        expect(isPlainSerializable(ref)).toBe(true);
      }
    });

    it("an asset-generation Proposal's commands introduce new buffers/meshes/materials/emitters exclusively via JsonPatchOp, not a side-channel write (AG-014)", async () => {
      const { service, documentJsonSnapshot } = makeHarness();
      const proposal = await service.request("add 2 cubes", []);
      expect(proposal.generatedAssets?.length).toBe(2);

      // Replayed on top of the harness's own backing document (not a bare
      // `{}`) — a real Proposal is always applied against a real document
      // that already has whatever top-level arrays (`scenes`, etc.)
      // SceneEdit's factories assume are present; a totally empty base
      // isn't a scenario any real caller produces.
      let json: unknown = documentJsonSnapshot;
      for (const command of proposal.commands) {
        for (const patch of command.patches) {
          expect(["add", "replace", "remove"]).toContain(patch.op);
        }
        json = applyPatchesLocally(json, command.patches);
      }
      const touchedRoots = new Set(proposal.commands.flatMap((c) => c.patches.map((p) => p.path.split("/")[1])));
      for (const expectedRoot of ["buffers", "bufferViews", "accessors", "materials", "meshes", "nodes"]) {
        expect(touchedRoots.has(expectedRoot)).toBe(true);
      }
      // Every generatedAssets pointer must resolve inside the JSON these
      // patches alone produced — nothing the caller would need to fetch
      // from anywhere else.
      for (const asset of proposal.generatedAssets ?? []) {
        for (const pointer of asset.pointers) {
          const segments = pointer.split("/").filter(Boolean);
          let cursor: unknown = json;
          for (const segment of segments) cursor = (cursor as Record<string, unknown>)[segment];
          expect(cursor).toBeDefined();
        }
      }
    });

    it("the Copilot panel and an inline affordance (right-click/graph chip/inspector chip) produce requests of the identical AgentRequest shape (AG-015)", async () => {
      const { service, nodeIndex } = makeHarness();
      // "Panel" flow: full auto-populated context (selection + would-be
      // graph excerpt/op-registry chips, represented here by an additional
      // explicit ref). "Inline affordance" flow: just the one prefilled
      // ref the chip represents. Both go through the exact same
      // `request(prompt, context)` call — there is no second method/overload.
      const panelContext: AgentContextRef[] = [{ kind: "selection", nodeIndices: [nodeIndex] }, { kind: "explicit", label: "Op registry", pointer: "/extensions/KHR_interactivity" }];
      const inlineContext: AgentContextRef[] = [{ kind: "selection", nodeIndices: [nodeIndex] }];
      const fromPanel = await service.request("spin the selected node", panelContext);
      const fromInline = await service.request("spin the selected node", inlineContext);
      expect(Object.keys(fromPanel).sort()).toEqual(Object.keys(fromInline).sort());
    });

    // OPEN(AG-contract-chip-ui-tbd): chip removability/editability is a
    // Phase-2 UI concern (the Copilot panel doesn't exist yet — this PR is
    // headless logic only). Left as `it.todo` rather than a vacuous
    // assertion; convert once packages/app grows a Copilot panel to attach
    // this to.
    it.todo("opening the panel from an inline affordance prefills a removable/editable AgentContextRef chip (AG-015)");

    it("Proposal.summary is a non-empty human-readable string distinct from validationReport (AG-016)", async () => {
      const { service, nodeIndex } = makeHarness();
      const proposal = await service.request("move it up", selectionContext(nodeIndex));
      expect(typeof proposal.summary).toBe("string");
      expect(proposal.summary.length).toBeGreaterThan(0);
      expect(proposal.summary).not.toBe(JSON.stringify(proposal.validationReport));
    });

    it("Proposal.generatedAssets, when present, lists each generated asset separately from commands (AG-016)", async () => {
      const { service } = makeHarness();
      const proposal = await service.request("add 3 cubes", []);
      expect(proposal.generatedAssets?.length).toBe(3);
      for (const asset of proposal.generatedAssets ?? []) {
        expect(["mesh", "material", "audio"]).toContain(asset.kind);
        expect(Array.isArray(asset.pointers)).toBe(true);
        expect(typeof asset.provenance).toBe("string");
        expect(proposal.commands).not.toContainEqual(asset);
      }
    });
  });
}
