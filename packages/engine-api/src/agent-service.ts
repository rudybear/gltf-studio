import type { JsonPatchOp } from "./json-patch.js";

/**
 * AgentService: the editor's agentic-authoring boundary (see
 * docs/adr/0004-agentic-authoring-as-command-producer.md and
 * specs/agent-service.md). The agent is a command producer, never a
 * privileged writer — every Proposal's commands are built via the same
 * command factories (GraphEdit.*, SceneEdit.*, AudioGraphEdit.*, and
 * asset-generation factories) the direct-manipulation UI uses, applied as
 * one HistoryStack transaction, and validated before acceptance is offered.
 *
 * AG-001: request(prompt, context) -> Promise<Proposal>.
 */
export interface AgentService {
  request(prompt: string, context: AgentContextRef[]): Promise<Proposal>;
}

/**
 * AG-002: the three kinds of context an editor can attach to a request.
 * "selection" and "graph-node" point at existing document state by
 * reference (not by value) so the request payload stays small and the
 * editor decides how much of the referenced state to expand into the
 * user-visible chip (AG-013); "explicit" covers anything the user manually
 * attaches beyond the auto-populated selection (AG-012).
 */
export type AgentContextRef =
  | { kind: "selection"; nodeIndices: number[] }
  | { kind: "graph-node"; graphIndex: number; nodeId: string }
  | { kind: "explicit"; label: string; pointer: string };

/**
 * Minimal structural stand-in for editor-core's Command (DOC-007..010,
 * specs/document-model.md). Deliberately NOT the full Command type — this
 * package is types-only and stays dependency-free, so it cannot import
 * editor-core's real `Command` type. `patches`/`inverse` mirror
 * DOC-007/DOC-008 (precomputed forward + inverse JsonPatchOp batches) and
 * `label` mirrors DOC-009; the optional `coalesceKey` (DOC-010) is
 * intentionally omitted since a proposal's commands apply inside a single
 * HistoryStack.transact (AG-004) and have no reason to coalesce with
 * anything outside that transaction.
 *
 * RESOLVED (M1, OPEN(AG-commandlike-unification-tbd)): editor-core's real
 * `Command` (packages/editor-core/src/command.ts) is defined as
 * `CommandLike & { coalesceKey?: string }` — i.e. this interface stays
 * exactly as-is (not renamed to an alias); editor-core's `Command` is a
 * strict structural supertype of it, so every `CommandLike` a Proposal
 * builds is already a valid `Command` minus optional coalescing.
 */
export interface CommandLike {
  id: string;
  label: string;
  patches: JsonPatchOp[];
  inverse: JsonPatchOp[];
}

/**
 * AG-006/AG-007/AG-008: attached to every Proposal before acceptance is
 * offered. `findings` covers checkModule/validateGraph-style results;
 * `equivChecks` covers EQUIV results for any behavior-neutral claim the
 * proposal's summary makes (AG-007) — present only when such a claim
 * exists, not on every proposal.
 */
export interface ValidationReport {
  findings: ValidationFinding[];
  equivChecks?: EquivCheckResult[];
}

/**
 * OPEN(AG-validationfinding-shape-tbd): the plan/spec require severity
 * levels sufficient to distinguish "blocks one-click acceptance" (AG-008,
 * any error-level finding) from advisory findings, but do not enumerate
 * checkModule/validateGraph's full finding vocabulary beyond that.
 */
export interface ValidationFinding {
  severity: "error" | "warning" | "info";
  message: string;
  /** Optional JSON pointer into the document the finding is about. */
  pointer?: string;
}

/** AG-007: one EQUIV result for one behavior-neutral claim in a proposal's summary. */
export interface EquivCheckResult {
  claim: string;
  equivalent: boolean;
  detail?: string;
}

/**
 * AG-016: lists a generated asset separately from the commands that
 * introduce it, so the UI can render asset-specific preview (e.g. a mesh
 * thumbnail) without re-deriving that information from raw patches.
 *
 * OPEN(AG-genprovider-tbd): the provider(s) that actually synthesize
 * geometry/materials/audio behind this ref are net-new scope, not designed
 * here (see docs/adr/0004's consequences).
 */
export interface GeneratedAssetRef {
  kind: "mesh" | "material" | "audio";
  /** JSON pointer(s) into the document this asset introduces or touches. */
  pointers: string[];
  provenance: string;
}

/**
 * AG-003/AG-004/AG-016: the unit AgentService.request resolves to.
 * `commands` apply as one HistoryStack.transact call (AG-004) once
 * accepted; `validationReport` must be attached (AG-006) before acceptance
 * is offered; rejecting/discarding a Proposal is required to mutate nothing
 * (AG-009) — there is no method on this interface for "undo a rejection"
 * because rejection never wrote anything.
 */
export interface Proposal {
  /** AG-016: human-readable, never a substitute for validationReport. */
  summary: string;
  commands: CommandLike[];
  validationReport: ValidationReport;
  /** AG-016: present only for proposals that generate new assets. */
  generatedAssets?: GeneratedAssetRef[];
}
