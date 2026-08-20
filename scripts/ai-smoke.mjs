#!/usr/bin/env node
// scripts/ai-smoke.mjs — real-model integration harness for
// @gltf-studio/agent-llm's OpenAICompatibleAgentProvider (specs/agent-service.md
// AG-017..AG-022). Runs a fixed PROMPT MATRIX against one or more live
// OpenAI-compatible endpoints (Ollama, LM Studio, ...) and prints, per
// prompt: the raw tool_calls the model returned, the derived operation
// list, the built Commands, the validation result, and the final Proposal
// (or the exact refusal/error). This is NOT part of `pnpm test`/CI (no GPU
// there) — it's a manual, env-gated proof against a REAL model. Run it with:
//
//   GLTFI_LLM_LIVE=1 node scripts/ai-smoke.mjs [model1,model2,...]
//
// Models default to the comma-separated list in DEFAULT_MODELS below.
// GLTFI_LLM_BASE_URL overrides the default http://localhost:11434/v1.
//
// Requires packages/agent-llm and packages/editor-core to be built first
// (`pnpm -w exec tsc -b`) — this script imports their compiled dist/ output
// directly (including a couple of files not part of agent-llm's public
// index.ts, e.g. test-fixtures.js/request-builder.js/response-parser.js —
// acceptable for an in-repo dev harness that needs finer-grained visibility
// than the public `AgentService.request()` contract exposes).
import { createDocument } from "../packages/editor-core/dist/index.js";
import { buildChatCompletionRequest } from "../packages/agent-llm/dist/request-builder.js";
import { postChatCompletion } from "../packages/agent-llm/dist/network.js";
import { resolveProposalFromResponse } from "../packages/agent-llm/dist/response-parser.js";
import { OpenAICompatibleAgentProvider, NoPlanProducedError, AgentNetworkError } from "../packages/agent-llm/dist/index.js";
import { containerFromJson } from "../packages/agent-llm/dist/test-fixtures.js";

if (!process.env.GLTFI_LLM_LIVE) {
  console.error(
    "ai-smoke.mjs is a REAL-network harness against a live OpenAI-compatible endpoint.\n" +
      "Set GLTFI_LLM_LIVE=1 to run it on purpose (it makes real HTTP calls and is not part of CI)."
  );
  process.exit(1);
}

const BASE_URL = process.env.GLTFI_LLM_BASE_URL ?? "http://localhost:11434/v1";
const DEFAULT_MODELS = ["qwen3.5:122b-a10b", "qwen3.6:latest", "gemma4:26b"];
const models = (process.argv[2] ? process.argv[2].split(",") : process.env.GLTFI_LLM_MODELS?.split(",")) ?? DEFAULT_MODELS;

// --- Fixture scene: richer than agent-llm's own test-fixtures.ts default so
// the matrix can exercise "find a node by name that ISN'T the current
// selection" (prompt (e) below) as well as the with/without-emitter split
// prompt (c) asks for.
function fixtureSceneJson() {
  const nodes = [
    { name: "Alpha", translation: [0, 0, 0] },
    { name: "Beta", translation: [2, 0, 0] },
    { name: "Pillar", translation: [0, 0, -3], extensions: { KHR_audio_emitter: { emitter: 0 } } },
    { name: "Ground", translation: [0, -1, 0] }
  ];
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3] }],
    nodes,
    materials: [{ name: "Mat0", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    extensionsUsed: ["KHR_audio_emitter"],
    extensions: {
      KHR_audio_emitter: {
        audio: [{ uri: "data:audio/wav;base64,AAAA" }],
        sources: [{ audio: 0, gain: 1, autoplay: false, loop: false }],
        emitters: [{ type: "positional", gain: 1, sources: [0] }]
      }
    }
  };
}

function freshDocument() {
  return createDocument(containerFromJson(fixtureSceneJson()));
}

// index/name reference for the printed report and for prompts that refer to
// a node by name ("the pillar") without selecting it.
const NODE_NAMES = ["Alpha (0, no emitter)", "Beta (1, no emitter)", "Pillar (2, HAS emitter)", "Ground (3, no emitter)"];

const PROMPTS = [
  { id: "a-spin", text: "spin the selected node when clicked", context: () => [{ kind: "selection", nodeIndices: [0] }] },
  { id: "b-move", text: "move the selected node up by 1", context: () => [{ kind: "selection", nodeIndices: [0] }] },
  {
    id: "c1-play-sound-with-emitter",
    text: "play a sound when this is clicked",
    context: () => [{ kind: "selection", nodeIndices: [2] }] // Pillar: HAS an emitter
  },
  {
    id: "c2-play-sound-without-emitter",
    text: "play a sound when this is clicked",
    context: () => [{ kind: "selection", nodeIndices: [0] }] // Alpha: no emitter -- expect graceful failure, not a crash
  },
  { id: "d-add-cubes", text: "add 3 cubes", context: () => [] },
  {
    id: "e-multistep",
    text: "when the pillar is clicked, move it up and play a chime",
    context: () => [] // deliberately NOT selected -- stresses name->index resolution from the system prompt's node list
  },
  { id: "f-out-of-scope", text: "write me a poem", context: () => [] },
  { id: "g-ambiguous", text: "make it interactive", context: () => [] }
];

// Ollama-specific: explicitly unload the PREVIOUS model before loading the
// next one. Observed live: back-to-back requests for two different large
// models can otherwise fail with a real 500 ("model failed to load, this
// may be due to resource limitations") when the previous model hasn't
// fully freed VRAM yet -- e.g. qwen3.5:122b-a10b (~96GB resident) followed
// immediately by qwen3.6:latest. `keep_alive: 0` on Ollama's native
// /api/generate tells it to unload right away. Best-effort: swallowed on
// any non-Ollama endpoint (LM Studio has no such route) or transient error.
async function unloadOllamaModel(model) {
  const nativeUrl = BASE_URL.replace(/\/v1\/?$/, "") + "/api/generate";
  try {
    await fetch(nativeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 })
    });
  } catch {
    // not an Ollama endpoint, or it's already gone -- fine either way.
  }
}

function short(value, max = 500) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function runOne(model, promptSpec) {
  const document = freshDocument();
  const context = promptSpec.context(document);
  const config = { baseUrl: BASE_URL, model };

  const chatRequest = buildChatCompletionRequest(promptSpec.text, context, document, config);
  console.log(`\n  --- ${promptSpec.id} :: "${promptSpec.text}" (context: ${JSON.stringify(context)}) ---`);

  let rawResponse;
  try {
    rawResponse = await postChatCompletion(chatRequest);
  } catch (err) {
    console.log(`  NETWORK ERROR: ${err instanceof Error ? err.constructor.name + ": " + err.message : String(err)}`);
    return { id: promptSpec.id, outcome: "network-error", detail: String(err) };
  }

  const message = rawResponse?.choices?.[0]?.message;
  const rawToolCalls = message?.tool_calls ?? [];
  const contentPreview = typeof message?.content === "string" && message.content.trim().length > 0 ? short(message.content, 300) : null;
  console.log(`  raw tool_calls (${rawToolCalls.length}): ${short(rawToolCalls)}`);
  if (contentPreview) console.log(`  raw content alongside tool_calls: ${contentPreview}`);

  let outcome;
  try {
    const proposal = resolveProposalFromResponse(rawResponse, document);
    console.log(`  PROPOSAL: ${proposal.summary}`);
    console.log(`  commands (${proposal.commands.length}): ${proposal.commands.map((c) => c.label).join(", ")}`);
    console.log(`  validation findings: ${JSON.stringify(proposal.validationReport.findings)}`);
    outcome = { id: promptSpec.id, outcome: "proposal", commandCount: proposal.commands.length, summary: proposal.summary };
  } catch (err) {
    if (err instanceof NoPlanProducedError) {
      console.log(`  REFUSAL (NoPlanProducedError): ${err.message}`);
      outcome = { id: promptSpec.id, outcome: "refusal", detail: err.message };
    } else {
      console.log(`  UNEXPECTED ERROR resolving proposal: ${err instanceof Error ? err.stack : String(err)}`);
      outcome = { id: promptSpec.id, outcome: "unexpected-error", detail: String(err) };
    }
  }

  // Parity check: the public AgentService.request() path (a fresh document +
  // provider instance, since request() re-derives everything from scratch)
  // should reach the same outcome class as the manual build/post/resolve
  // pipeline above -- confirms the harness reflects what the real app calls.
  // Costs a second real inference call per prompt, so it's skippable when
  // iterating quickly across many models.
  if (!process.env.GLTFI_LLM_SKIP_PARITY) {
    const provider = new OpenAICompatibleAgentProvider(freshDocument(), config);
    try {
      await provider.request(promptSpec.text, context);
      if (outcome.outcome !== "proposal") console.log(`  PARITY MISMATCH: provider.request() resolved but manual pipeline reported "${outcome.outcome}".`);
    } catch (err) {
      const isRefusal = err instanceof NoPlanProducedError;
      const isNetwork = err instanceof AgentNetworkError;
      const expectedFailure = outcome.outcome === "refusal" || outcome.outcome === "network-error" || outcome.outcome === "unexpected-error";
      if (!expectedFailure) console.log(`  PARITY MISMATCH: provider.request() threw (${err.constructor.name}) but manual pipeline reported "${outcome.outcome}".`);
      else if (!isRefusal && !isNetwork) console.log(`  provider.request() threw an unexpected error type: ${err.constructor.name}: ${err.message}`);
    }
  }

  return outcome;
}

async function main() {
  console.log(`ai-smoke: base URL = ${BASE_URL}`);
  console.log(`ai-smoke: models = ${models.join(", ")}`);
  console.log(`ai-smoke: fixture nodes = ${NODE_NAMES.join("; ")}`);

  const matrixResults = {};
  for (const [modelIndex, model] of models.entries()) {
    if (modelIndex > 0) await unloadOllamaModel(models[modelIndex - 1]);
    console.log(`\n=== MODEL: ${model} ===`);
    matrixResults[model] = [];
    for (const promptSpec of PROMPTS) {
      const result = await runOne(model, promptSpec);
      matrixResults[model].push(result);
    }
  }

  console.log("\n\n=== SUMMARY (model x prompt -> outcome) ===");
  const header = ["prompt", ...models].join(" | ");
  console.log(header);
  for (const promptSpec of PROMPTS) {
    const row = [promptSpec.id];
    for (const model of models) {
      const r = matrixResults[model].find((x) => x.id === promptSpec.id);
      row.push(r ? r.outcome : "?");
    }
    console.log(row.join(" | "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
