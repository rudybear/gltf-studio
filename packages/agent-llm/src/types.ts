// AG-022: the public shape of an OpenAICompatibleAgentProvider's
// configuration. Constructed and persisted by whatever wires this provider
// up (a future settings dialog in packages/app, specs/ux-settings.md) and
// passed in — this package has no opinion on WHERE it's stored (AG-022 says
// "the browser's own local storage", a packages/app concern, not this
// package's).
export interface LlmProviderConfig {
  /** e.g. "http://localhost:11434/v1" (Ollama) or "http://localhost:1234/v1" (LM Studio). Trailing slash tolerated. */
  baseUrl: string;
  /** The model name/tag the endpoint should route the request to. */
  model: string;
  /** Sent as `Authorization: Bearer <apiKey>` only when set — most local endpoints don't require one. */
  apiKey?: string;
}
