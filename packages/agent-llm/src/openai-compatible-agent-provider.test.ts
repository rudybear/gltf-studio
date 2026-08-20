/** @spec AG-017 AG-018 AG-019 AG-020 AG-021 */
// All tests here stub globalThis.fetch — no real network call, no real
// model, ever (docs/adr/0005's "CI and local dev are permanently GPU-free"
// consequence). A real model is only ever used by an end user at runtime,
// which is explicitly untestable here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleAgentProvider } from "./openai-compatible-agent-provider.js";
import { NoPlanProducedError, ConnectionRefusedError, CorsBlockedError } from "./errors.js";
import { fixtureDocument } from "./test-fixtures.js";
import type { LlmProviderConfig } from "./types.js";

const CONFIG: LlmProviderConfig = { baseUrl: "http://localhost:11434/v1", model: "test-model" };

function selection(nodeIndex: number) {
  return [{ kind: "selection" as const, nodeIndices: [nodeIndex] }];
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response;
}

/** Ollama-shaped: `arguments` is a JSON-ENCODED STRING (the strict OpenAI wire format). */
function ollamaShapedSpinResponse() {
  return {
    id: "chatcmpl-ollama-1",
    object: "chat.completion",
    created: 1700000000,
    model: "llama3.1",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "spin_node_on_event",
                arguments: JSON.stringify({ nodeIndex: 0, eventOp: "event/onTick", axis: "y", degreesPerSecond: 60 })
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ]
  };
}

/** LM-Studio-shaped: extra `system_fingerprint`/`usage`/`logprobs` fields a strict OpenAI client wouldn't rely on, AND `arguments` handed back as an already-parsed object (not every local server encodes it as a string) — proves the parser tolerates both shapes rather than being coupled to Ollama's exact JSON. */
function lmStudioShapedMoveResponse() {
  return {
    id: "chatcmpl-lmstudio-abc123",
    object: "chat.completion",
    created: 1700000001,
    model: "qwen2.5-7b-instruct",
    system_fingerprint: "lmstudio-community/qwen2.5-7b-instruct",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: { name: "move_node", arguments: { nodeIndex: 1, translation: [0, 1, 0], relative: true } }
            }
          ]
        },
        finish_reason: "tool_calls",
        logprobs: null
      }
    ],
    usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 }
  };
}

function proseOnlyResponse() {
  return {
    id: "chatcmpl-prose-1",
    object: "chat.completion",
    created: 1700000002,
    model: "llama3.1",
    choices: [{ index: 0, message: { role: "assistant", content: "I'm not sure how to do that." }, finish_reason: "stop" }]
  };
}

function toolCallsResponse(calls: Array<{ name: string; args: unknown }>) {
  return {
    id: "chatcmpl-mixed-1",
    object: "chat.completion",
    created: 1700000003,
    model: "llama3.1",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`,
            type: "function",
            function: { name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args) }
          }))
        },
        finish_reason: "tool_calls"
      }
    ]
  };
}

describe("OpenAICompatibleAgentProvider: canned tool-call responses (AG-017)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves an Ollama-shaped spin_node_on_event tool call into a real GraphEdit-built Proposal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ollamaShapedSpinResponse()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const doc = fixtureDocument();
    const provider = new OpenAICompatibleAgentProvider(doc, CONFIG);
    const proposal = await provider.request("spin the selected node", selection(0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(proposal.commands.length).toBeGreaterThan(0);
    const pointerPatch = proposal.commands
      .flatMap((c) => c.patches)
      .find((p) => JSON.stringify(p.value ?? "").includes("/nodes/0/rotation"));
    expect(pointerPatch).toBeDefined();
    const eventDeclPatch = proposal.commands.flatMap((c) => c.patches).find((p) => JSON.stringify(p.value ?? "").includes("event/onTick"));
    expect(eventDeclPatch).toBeDefined();
    expect(Array.isArray(proposal.validationReport.findings)).toBe(true);
    expect(proposal.validationReport.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("resolves an LM-Studio-shaped move_node tool call (extra vendor fields, already-parsed object arguments)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(lmStudioShapedMoveResponse()));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const doc = fixtureDocument();
    const provider = new OpenAICompatibleAgentProvider(doc, CONFIG);
    const proposal = await provider.request("move it up", selection(1));

    expect(proposal.commands.length).toBeGreaterThan(0);
    const after = proposal.commands[0].patches.find((p) => p.path === "/nodes/1/translation");
    expect(after?.value).toEqual([2, 1, 0]); // node 1 starts at [2,0,0] in the fixture; relative +[0,1,0]
    expect(proposal.validationReport.findings).toEqual([]);
  });

  it("rejects with NoPlanProducedError for a prose-only response with no tool_calls (AG-019)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(proseOnlyResponse())) as unknown as typeof fetch;
    const provider = new OpenAICompatibleAgentProvider(fixtureDocument(), CONFIG);
    await expect(provider.request("do something clever", [])).rejects.toBeInstanceOf(NoPlanProducedError);
    await expect(provider.request("do something clever", [])).rejects.toThrow(/couldn't produce a valid plan/i);
  });

  it("drops a tool call with malformed-JSON arguments and rejects when it was the only call (AG-020)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(toolCallsResponse([{ name: "move_node", args: "{not valid json" }]))) as unknown as typeof fetch;
    const provider = new OpenAICompatibleAgentProvider(fixtureDocument(), CONFIG);
    await expect(provider.request("move it up", selection(0))).rejects.toBeInstanceOf(NoPlanProducedError);
  });

  it("drops a tool call naming an unknown tool and rejects when it was the only call (AG-020)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(toolCallsResponse([{ name: "delete_the_universe", args: { nodeIndex: 0 } }]))) as unknown as typeof fetch;
    const provider = new OpenAICompatibleAgentProvider(fixtureDocument(), CONFIG);
    await expect(provider.request("do something", selection(0))).rejects.toBeInstanceOf(NoPlanProducedError);
  });

  it("keeps only the valid operation when one of two tool_calls is malformed and the other is valid (AG-020)", async () => {
    const doc = fixtureDocument();
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        toolCallsResponse([
          { name: "move_node", args: "{not valid json" },
          { name: "move_node", args: { nodeIndex: 0, translation: [1, 0, 0], relative: false } }
        ])
      )
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleAgentProvider(doc, CONFIG);
    const proposal = await provider.request("move it", selection(0));

    expect(proposal.commands.length).toBe(1);
    expect(proposal.commands[0].patches.find((p) => p.path === "/nodes/0/translation")?.value).toEqual([1, 0, 0]);
  });
});

describe("OpenAICompatibleAgentProvider: network-layer failures (AG-021)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects with ConnectionRefusedError when both the primary and the no-cors probe fetch fail", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAICompatibleAgentProvider(fixtureDocument(), CONFIG);
    await expect(provider.request("spin the selected node", selection(0))).rejects.toBeInstanceOf(ConnectionRefusedError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // primary (cors) + no-cors probe
  });

  it("rejects with CorsBlockedError when the primary fetch fails but the no-cors probe resolves", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ type: "opaque" } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAICompatibleAgentProvider(fixtureDocument(), CONFIG);
    let caught: unknown;
    try {
      await provider.request("spin the selected node", selection(0));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CorsBlockedError);
    expect((caught as Error).message).toMatch(/CORS|Origins/);
  });
});
