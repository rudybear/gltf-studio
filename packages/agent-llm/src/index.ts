export { OpenAICompatibleAgentProvider } from "./openai-compatible-agent-provider.js";
export type { LlmProviderConfig } from "./types.js";
export { NoPlanProducedError, AgentNetworkError, ConnectionRefusedError, CorsBlockedError } from "./errors.js";
export { TOOL_SCHEMA } from "./tool-schema.js";
export type { OpenAIToolDefinition } from "./tool-schema.js";

// AG-021/AG-022, specs/ux-settings.md UX-1304: the settings dialog's
// standalone "Test connection" check -- see connection-test.ts's own header.
export { testLocalEndpointConnection } from "./connection-test.js";
export type { ConnectionTestResult } from "./connection-test.js";

// TEST-ONLY — see test-only-proposals.ts's own header. Exported (mirroring
// @gltf-studio/agent-mock's index.ts) so this package's own contract.test.ts
// can wire them into @gltf-studio/contract-tests' AgentServiceHarness.
export { buildDeliberatelyBrokenProposalForTests, buildBehaviorNeutralProposalForTests } from "./test-only-proposals.js";
