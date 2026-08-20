// AG-019/AG-020: refusal — the model didn't produce anything this provider
// can turn into a Proposal. Extends the SHARED AgentRequestRefusedError
// (@gltf-studio/agent-shared) so a caller catching that base class (e.g.
// packages/app's sendCopilotPrompt) treats this the same as agent-mock's
// UnrecognizedPromptError/MissingSelectionError, per docs/adr/0005's
// "matching packages/agent-mock's AgentRequestRefusedError contract" note
// on AG-019.
import { AgentRequestRefusedError } from "@gltf-studio/agent-shared";

export class NoPlanProducedError extends AgentRequestRefusedError {
  constructor(reason: string) {
    super(`OpenAICompatibleAgentProvider couldn't produce a valid plan: ${reason}`);
    this.name = "NoPlanProducedError";
  }
}

/**
 * AG-021: the network-failure category — deliberately NOT a subclass of
 * AgentRequestRefusedError. A refusal (NoPlanProducedError) means "the
 * model responded but gave us nothing usable"; a network error means "we
 * never got a response to judge at all" (or the browser wouldn't let us
 * read one). These are different failure classes a richer UI should
 * eventually be able to render distinctly (docs/adr/0005's "typed
 * network/CORS error" consequence) — today's packages/app catch-all still
 * treats every thrown error the same via `.message`, which is fine; the
 * point of this base class is that the TYPES are distinguishable for
 * whoever wires up that richer handling later, not that this task changes
 * packages/app itself.
 */
export class AgentNetworkError extends Error {}

/**
 * Nothing is listening at the configured baseUrl at all (DNS failure,
 * connection refused, no process bound to that host:port). See
 * request.ts's `probeConnectivity` for the no-cors-probe heuristic this is
 * derived from, and its own doc comment for why this is a best-effort
 * inference, not a certainty.
 */
export class ConnectionRefusedError extends AgentNetworkError {
  constructor(baseUrl: string) {
    super(`Could not reach ${baseUrl} — nothing appears to be listening there. Is the local model server (Ollama, LM Studio, ...) running?`);
    this.name = "ConnectionRefusedError";
  }
}

/**
 * Something IS listening at the configured baseUrl, but the browser
 * blocked the app from reading the response (no CORS headers permitting
 * this page's origin). See request.ts's `probeConnectivity` for the
 * heuristic and its caveat.
 */
export class CorsBlockedError extends AgentNetworkError {
  constructor(baseUrl: string) {
    super(
      `A server is running at ${baseUrl}, but the browser blocked this page from reading its response (CORS). ` +
        `For Ollama, set the OLLAMA_ORIGINS environment variable to include this page's origin and restart Ollama. ` +
        `For LM Studio, enable CORS in the server settings (Developer tab -> Server Settings -> "Enable CORS").`
    );
    this.name = "CorsBlockedError";
  }
}
