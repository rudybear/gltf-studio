// OpenAICompatibleAgentProvider: the local-model AgentService implementation
// (specs/agent-service.md AG-017..AG-022, docs/adr/0005). Sends the prompt
// and context to a locally-configured OpenAI-compatible /v1/chat/completions
// endpoint and resolves the response's tool_calls — never response text —
// into a Proposal via the shared @gltf-studio/agent-shared pipeline. Makes
// exactly one real network call per request(); every failure mode (no
// tool_calls, unusable tool_calls, connection refused, CORS-blocked)
// degrades to a distinct typed outcome rather than a silent bad edit.
//
// Construction / document threading: identical judgment call to
// packages/agent-mock's MockAgentProvider (see that package's file header
// for the full reasoning) — the document is constructor-injected and
// updated via setDocument(), since AgentContextRef/AgentService.request's
// fixed two-argument signature (AG-001) has no document parameter and
// engine-api cannot depend on editor-core's EditorDocument type.
import type { EditorDocument } from "@gltf-studio/editor-core";
import type { AgentContextRef, AgentService, Proposal } from "@gltf-studio/engine-api";
import { buildChatCompletionRequest } from "./request-builder.js";
import { postChatCompletion } from "./network.js";
import { resolveProposalFromResponse } from "./response-parser.js";
import type { LlmProviderConfig } from "./types.js";

export class OpenAICompatibleAgentProvider implements AgentService {
  #document: EditorDocument;
  #config: LlmProviderConfig;

  constructor(document: EditorDocument, config: LlmProviderConfig) {
    this.#document = document;
    this.#config = config;
  }

  /** Called by whatever wires this provider up whenever the store's current EditorDocument changes (mirrors MockAgentProvider.setDocument). */
  setDocument(document: EditorDocument): void {
    this.#document = document;
  }

  /** Called whenever the user changes provider settings (base URL, model, API key) in the settings dialog (AG-022). */
  setConfig(config: LlmProviderConfig): void {
    this.#config = config;
  }

  /**
   * AG-001/AG-017: resolves to a Proposal, or rejects with
   * `NoPlanProducedError` (AG-019/AG-020, a refusal — the model responded
   * but produced nothing usable) or `ConnectionRefusedError`/
   * `CorsBlockedError` (AG-021, the request never got a response to judge
   * at all).
   */
  async request(prompt: string, context: AgentContextRef[]): Promise<Proposal> {
    const chatRequest = buildChatCompletionRequest(prompt, context, this.#document, this.#config);
    const rawResponse = await postChatCompletion(chatRequest);
    return resolveProposalFromResponse(rawResponse, this.#document);
  }
}
