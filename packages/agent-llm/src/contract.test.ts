// Runs the real AgentService contract suite
// (packages/contract-tests/src/agent-service.ts) against
// OpenAICompatibleAgentProvider, mirroring packages/agent-mock/src/contract.test.ts's
// exact pattern for wiring a real implementation into its shared
// contract-tests describe-factory.
//
// AG-017: this provider's whole mechanism IS a network call (stubbed here,
// per this package's GPU-free testing rule — see this file's fetch stub
// below), so `supportsNetworkFreeCheck: false` opts this harness out of
// AG-010's "no network call" obligation, which is definitionally only true
// of the mock/offline provider. Every OTHER obligation still runs and must
// pass — see packages/contract-tests/src/agent-service.ts's
// `AgentServiceHarness.supportsNetworkFreeCheck` doc comment for why this
// flag exists and how the mock's own (unmodified) harness is unaffected.
//
// Since this provider ignores prompt TEXT entirely (its only channel is
// tool_calls, AG-018) — unlike MockAgentProvider's regex templates — the
// stub below acts as a tiny scripted "model": it reads the REQUEST body
// (the system prompt's scene summary and the user prompt) and returns a
// canned tool-call response appropriate to what the contract suite's fixed
// set of prompts ("add N cube(s)", "spin the selected node", "move it up")
// actually asks for. This exercises the real fetch -> parse -> tool-handler
// -> CommandChain -> Proposal pipeline end to end, deterministically, with
// no real network call and no real model — exactly what docs/adr/0005 requires.
import { describe, vi, beforeAll, afterAll } from "vitest";
import { describeAgentServiceContract, type AgentServiceHarness } from "@gltf-studio/contract-tests";
import { OpenAICompatibleAgentProvider } from "./openai-compatible-agent-provider.js";
import { buildBehaviorNeutralProposalForTests, buildDeliberatelyBrokenProposalForTests } from "./test-only-proposals.js";
import { fixtureDocument } from "./test-fixtures.js";
import type { LlmProviderConfig } from "./types.js";

const CONFIG: LlmProviderConfig = { baseUrl: "http://localhost:11434/v1", model: "test-model" };

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function toolCallsBody(calls: Array<{ name: string; args: unknown }>) {
  return {
    id: "chatcmpl-contract-stub",
    object: "chat.completion",
    created: 1700000000,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args) }
          }))
        },
        finish_reason: "tool_calls"
      }
    ]
  };
}

/** Extracts the `nodeIndex=N` the system prompt's scene summary encodes for the current selection (request-builder.ts's `describeSelection`), so the scripted "model" targets the SAME node the contract test's own harness.nodeIndex names — mirroring how a real model would read the scene summary rather than hard-coding an index here. */
function selectedNodeIndexFromSystemPrompt(systemContent: string): number {
  const match = systemContent.match(/selected: nodeIndex=(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** The scripted "model" behind the stubbed fetch: inspects the request body's system + user messages and returns tool_calls matching what the contract suite's fixed prompts ask for. */
function scriptedFetch(_url: string, init: { body?: string }): Response {
  const requestBody = JSON.parse(init.body ?? "{}") as { messages: Array<{ role: string; content: string }> };
  const systemContent = requestBody.messages.find((m) => m.role === "system")?.content ?? "";
  const userPrompt = requestBody.messages.find((m) => m.role === "user")?.content ?? "";
  const nodeIndex = selectedNodeIndexFromSystemPrompt(systemContent);

  const cubeMatch = userPrompt.match(/add (\d+) cubes?/i);
  if (cubeMatch) {
    const count = Number(cubeMatch[1]);
    return jsonResponse(toolCallsBody(Array.from({ length: count }, (_, i) => ({ name: "generate_cube", args: { name: `Contract cube ${i}` } }))));
  }
  if (/spin/i.test(userPrompt)) {
    return jsonResponse(
      toolCallsBody([{ name: "spin_node_on_event", args: { nodeIndex, eventOp: "event/onTick", axis: "y", degreesPerSecond: 60 } }])
    );
  }
  if (/move/i.test(userPrompt)) {
    return jsonResponse(toolCallsBody([{ name: "move_node", args: { nodeIndex, translation: [0, 1, 0], relative: true } }]));
  }
  // The contract suite never sends a prompt outside the set above; a
  // prose-only fallback here would only ever surface as an unexpected
  // NoPlanProducedError making a clearly-wrong obligation failure, rather
  // than silently mis-resolving.
  return jsonResponse({ choices: [{ message: { role: "assistant", content: `(contract stub: no scripted response for "${userPrompt}")` } }] });
}

describe("OpenAICompatibleAgentProvider: AgentService contract (AG-017)", () => {
  let originalFetch: typeof fetch;
  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      scriptedFetch(String(url), { body: typeof init?.body === "string" ? init.body : undefined })
    ) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describeAgentServiceContract((): AgentServiceHarness => {
    // withGraph: true so buildBehaviorNeutralProposalForTests (which
    // requires an existing graph to replace with itself) has one to work
    // with — same reasoning as agent-mock's own harness.
    const document = fixtureDocument({ withGraph: true });
    const service = new OpenAICompatibleAgentProvider(document, CONFIG);
    return {
      service,
      nodeIndex: 1,
      documentJsonSnapshot: document.json,
      buildInvalidProposal: () => buildDeliberatelyBrokenProposalForTests(document),
      buildBehaviorNeutralProposal: () => buildBehaviorNeutralProposalForTests(document),
      // AG-017: this provider's whole mechanism is a (here, stubbed)
      // network call — AG-010's "no network call" obligation is
      // definitionally only true of the mock/offline provider.
      supportsNetworkFreeCheck: false
    };
  });
});
