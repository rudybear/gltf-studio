// Runs the real AgentService contract suite
// (packages/contract-tests/src/agent-service.ts) against MockAgentProvider,
// mirroring packages/play/src/contract.test.ts's exact pattern for wiring a
// real implementation into its shared contract-tests describe-factory.
import { describeAgentServiceContract, type AgentServiceHarness } from "@gltf-studio/contract-tests";
import { buildBehaviorNeutralProposalForTests, buildDeliberatelyBrokenProposalForTests, MockAgentProvider } from "./mock-agent-provider.js";
import { fixtureDocument } from "./test-fixtures.js";

describeAgentServiceContract((): AgentServiceHarness => {
  // withGraph: true so buildBehaviorNeutralProposalForTests (which requires
  // an existing graph to replace with itself) has one to work with.
  const document = fixtureDocument({ withGraph: true });
  const service = new MockAgentProvider(document);
  return {
    service,
    nodeIndex: 1,
    documentJsonSnapshot: document.json,
    buildInvalidProposal: () => buildDeliberatelyBrokenProposalForTests(document),
    buildBehaviorNeutralProposal: () => buildBehaviorNeutralProposalForTests(document)
  };
});
