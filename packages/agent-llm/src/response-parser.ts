// AG-019/AG-020: turns a raw OpenAI-compatible chat-completions JSON
// response into a Proposal — the ONLY place in this package that reads
// `tool_calls` and resolves them into Commands. Response TEXT
// (`message.content`) is read only for an error message's excerpt, never
// interpreted as an edit.
import type { EditorDocument } from "@gltf-studio/editor-core";
import type { GeneratedAssetRef, Proposal } from "@gltf-studio/engine-api";
import { CommandChain, validateProposalGraph } from "@gltf-studio/agent-shared";
import { NoPlanProducedError } from "./errors.js";
import { GRAPH_INDEX, TOOL_HANDLERS, type ToolExecutionContext } from "./tool-handlers.js";

/** Wire shape both Ollama and LM Studio agree on for a single tool call (docs/adr/0005's "both put tool_calls on choices[0].message" note). `arguments` is typically a JSON-encoded string per the OpenAI wire format, but some local servers hand back an already-parsed object — handled defensively below. */
interface RawToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

interface RawMessage {
  content?: string | null;
  tool_calls?: RawToolCall[];
}

function extractMessage(rawResponse: unknown): RawMessage | undefined {
  if (typeof rawResponse !== "object" || rawResponse === null) return undefined;
  const choices = (rawResponse as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const message = (choices[0] as { message?: unknown })?.message;
  if (typeof message !== "object" || message === null) return undefined;
  return message as RawMessage;
}

function parseArguments(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (raw === undefined) {
    throw new Error("tool call has no arguments");
  }
  if (typeof raw === "object") {
    return raw; // some local servers hand back an already-parsed object rather than a JSON string.
  }
  const parsed: unknown = JSON.parse(raw); // throws SyntaxError on malformed JSON -> caught by the per-call try/catch below.
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`tool call arguments parsed to a non-object value: ${JSON.stringify(parsed)}`);
  }
  return parsed as Record<string, unknown>;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * AG-019/AG-020: resolves `rawResponse` (already-parsed JSON body) into a
 * `Proposal` built against `document`, or throws `NoPlanProducedError`.
 *
 * - No tool_calls at all (prose-only, empty choice, malformed response
 *   shape) -> refusal, quoting a truncated excerpt of any text content so
 *   the refusal message is informative, not just "no plan" (AG-019).
 * - Every tool_calls entry fails to resolve (malformed arguments JSON, an
 *   unrecognized tool name, or the handler's own argument/factory
 *   validation) -> refusal, distinct wording from the no-tool-calls case
 *   (AG-020).
 * - At least one operation resolves -> a Proposal built from ONLY the
 *   operations that did, via the same shared CommandChain/
 *   validateProposalGraph pipeline agent-mock's templates use (AG-006).
 */
export function resolveProposalFromResponse(rawResponse: unknown, document: EditorDocument): Proposal {
  const message = extractMessage(rawResponse);
  const toolCalls = message?.tool_calls ?? [];

  if (toolCalls.length === 0) {
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const reason = content.length > 0 ? `the model didn't call any tools (it responded: "${truncate(content, 200)}")` : "the model didn't call any tools";
    throw new NoPlanProducedError(reason);
  }

  const chain = new CommandChain(document);
  const ctx: ToolExecutionContext = { generatedAssets: [] };
  const failureNotes: string[] = [];
  let resolvedCount = 0;

  for (const call of toolCalls) {
    const name = call.function?.name;
    try {
      if (!name) throw new Error("tool call is missing a function name");
      const handler = TOOL_HANDLERS[name];
      if (!handler) throw new Error(`unknown tool "${name}"`);
      const args = parseArguments(call.function?.arguments);
      handler(chain, args, ctx);
      resolvedCount += 1;
    } catch (err) {
      failureNotes.push(`${name ?? "(unnamed)"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (resolvedCount === 0) {
    throw new NoPlanProducedError(`every tool call it made was invalid (${failureNotes.join("; ")})`);
  }

  const droppedNote = failureNotes.length > 0 ? ` (${failureNotes.length} tool call${failureNotes.length === 1 ? "" : "s"} dropped: ${failureNotes.join("; ")})` : "";
  const generatedAssets: GeneratedAssetRef[] | undefined = ctx.generatedAssets.length > 0 ? ctx.generatedAssets : undefined;

  return {
    summary: `Copilot (local model): applied ${resolvedCount} operation${resolvedCount === 1 ? "" : "s"} from the model's tool calls.${droppedNote}`,
    commands: chain.commands,
    validationReport: validateProposalGraph(chain.json, GRAPH_INDEX),
    ...(generatedAssets ? { generatedAssets } : {})
  };
}
