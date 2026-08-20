// Builds the POST /chat/completions request: assembles a compact,
// human-readable scene summary from the document + context (never the raw
// document JSON — keeps the request small and avoids leaking unrelated
// scene data into the prompt), plus the AG-018 tool schema, and turns it
// into a fetch-ready {url, headers, body}.
import { getIn, type EditorDocument } from "@gltf-studio/editor-core";
import type { AgentContextRef } from "@gltf-studio/engine-api";
import { TOOL_SCHEMA, TOOL_SUMMARY_FOR_SYSTEM_PROMPT } from "./tool-schema.js";
import type { LlmProviderConfig } from "./types.js";

/** Strips a trailing slash so `${baseUrl}/chat/completions` never ends up with a doubled "//". */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export function chatCompletionsUrl(config: LlmProviderConfig): string {
  return `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;
}

interface DocumentNode {
  name?: string;
  translation?: number[];
  extensions?: { KHR_audio_emitter?: { emitter?: number; emitters?: number[] } };
}

/** True when a node has a resolvable KHR_audio_emitter reference — mirrors tool-handlers.ts's `resolveSourceIndex` closely enough for a one-line prompt hint (a real divergence found live: gemma4:26b refused `play_sound_on_event` outright on a node that DID have an emitter, reasoning "I cannot check the extensions of the selected node" — the prompt gave it no way to know). */
function hasAudioEmitter(node: DocumentNode | undefined): boolean {
  const ref = node?.extensions?.KHR_audio_emitter;
  return typeof ref?.emitter === "number" || (Array.isArray(ref?.emitters) && ref.emitters.length > 0);
}

function describeSelection(document: EditorDocument, nodeIndex: number): string {
  const node = getIn(document.json, ["nodes", nodeIndex]) as DocumentNode | undefined;
  if (!node) return `- selected node index ${nodeIndex} (not found in the current document)`;
  const name = typeof node.name === "string" ? node.name : `node ${nodeIndex}`;
  const translation = node.translation ?? [0, 0, 0];
  return `- selected: nodeIndex=${nodeIndex}, name="${name}", translation=[${translation.join(", ")}], hasAudioEmitter=${hasAudioEmitter(node)}`;
}

/**
 * ALWAYS lists every node's index/name/audio-emitter flag, regardless of
 * selection or explicit context — a real divergence found live: prompts
 * that name a node the user hasn't selected ("when the pillar is clicked...")
 * got an honest clarification request from every tool-calling-capable model
 * tested (qwen3.5:122b-a10b, qwen3.6:latest) because the prompt gave them no
 * index to resolve "the pillar" to. A live model correctly refuses rather
 * than guessing, so the fix is giving it what it needs, not the parser.
 * Kept separate from `buildSceneSummary`'s per-context-ref lines (which
 * still call out the SELECTED node specifically, translation included) so a
 * capable model has both: "here is everything in the scene" and "here is
 * specifically what the user has selected right now".
 */
function describeAllNodes(document: EditorDocument): string[] {
  const nodes = (getIn(document.json, ["nodes"]) as DocumentNode[] | undefined) ?? [];
  return nodes.map((node, index) => {
    const name = typeof node.name === "string" ? node.name : `node ${index}`;
    return `  [${index}] "${name}"${hasAudioEmitter(node) ? " (has audio emitter)" : ""}`;
  });
}

/** Well-known KHR_interactivity trigger-event declarations a tool's `eventOp` argument can name — listed explicitly so a model doesn't have to guess a plausible-looking string (e.g. inventing "event/onClick" instead of the real "event/onSelect"). */
const KNOWN_TRIGGER_EVENTS = ["event/onStart", "event/onTick", "event/onSelect", "event/onHoverIn", "event/onHoverOut"];

function describeExplicitRef(document: EditorDocument, pointer: string, label: string): string {
  const segments = pointer.split("/").filter(Boolean);
  const value = getIn(document.json, segments);
  const rendered = value === undefined ? "(unresolved)" : JSON.stringify(value).slice(0, 200);
  return `- attached "${label}" (${pointer}): ${rendered}`;
}

function describeGraphVariables(document: EditorDocument): string[] {
  const graphs = getIn(document.json, ["extensions", "KHR_interactivity", "graphs"]) as
    | Array<{ variables?: Array<{ id?: string }> }>
    | undefined;
  if (!graphs) return [];
  const names: string[] = [];
  graphs.forEach((graph, graphIndex) => {
    for (const variable of graph.variables ?? []) {
      if (variable.id) names.push(`${variable.id} (graph ${graphIndex})`);
    }
  });
  return names;
}

/**
 * Builds the scene-summary section of the system prompt: EVERY node's
 * index/name/audio-emitter flag (so a prompt naming a node the user hasn't
 * selected, e.g. "when the pillar is clicked...", can still be resolved to
 * a real index instead of drawing a clarification request — a real
 * divergence found live: qwen3.5:122b-a10b/qwen3.6:latest both correctly
 * refused that exact prompt when only the selection was described, because
 * nothing in the prompt let them resolve "the pillar" to an index), the
 * selected node's index/name/transform/audio-emitter flag (AG-002's
 * "selection" context kind — kept in ADDITION to the full list since it
 * calls out what's actually selected right now, translation included), any
 * explicitly-attached context's resolved value ("explicit" kind, resolved
 * via editor-core's getIn — unresolvable pointers are noted, not silently
 * dropped), and any existing interactivity-graph variable names, so the
 * model can reference real document state instead of guessing indices.
 * "graph-node" context refs are named but not expanded (there is no single
 * generic "describe an arbitrary graph node" rendering worth the prompt
 * budget here — the model can address it directly via nodeId's index if it
 * is later added).
 */
export function buildSceneSummary(document: EditorDocument, context: AgentContextRef[]): string {
  const lines: string[] = [];
  const allNodes = describeAllNodes(document);
  if (allNodes.length > 0) {
    lines.push(`- all scene nodes (index, name, audio):\n${allNodes.join("\n")}`);
  }
  for (const ref of context) {
    if (ref.kind === "selection") {
      for (const nodeIndex of ref.nodeIndices) lines.push(describeSelection(document, nodeIndex));
    } else if (ref.kind === "explicit") {
      lines.push(describeExplicitRef(document, ref.pointer, ref.label));
    } else if (ref.kind === "graph-node") {
      lines.push(`- attached graph node "${ref.nodeId}" in graph ${ref.graphIndex}`);
    }
  }
  const variables = describeGraphVariables(document);
  if (variables.length > 0) {
    lines.push(`- existing interactivity-graph variables: ${variables.join(", ")}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(empty document: no nodes, no selection or attached context, no existing graph variables)";
}

export function buildSystemPrompt(document: EditorDocument, context: AgentContextRef[]): string {
  return [
    "You are a glTF scene-editing assistant embedded in a 3D editor.",
    "You MUST respond only by calling one or more of the provided tools — never describe an edit in prose.",
    "A response with no tool call is treated as a refusal to edit anything, so if you cannot express the",
    "requested change with the available tools, explain that briefly in plain text instead of guessing.",
    "When the user names an object that isn't the current selection (e.g. \"the pillar\"), look it up by name",
    "in the node list below rather than asking which index it is, unless the name is ambiguous or absent.",
    "",
    "Current scene context:",
    buildSceneSummary(document, context),
    "",
    `Known KHR_interactivity trigger events for the "eventOp" argument: ${KNOWN_TRIGGER_EVENTS.join(", ")}.`,
    "",
    "Available tools:",
    TOOL_SUMMARY_FOR_SYSTEM_PROMPT
  ].join("\n");
}

export interface ChatCompletionRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    tools: typeof TOOL_SCHEMA;
    tool_choice: "auto";
  };
}

export function buildChatCompletionRequest(
  prompt: string,
  context: AgentContextRef[],
  document: EditorDocument,
  config: LlmProviderConfig
): ChatCompletionRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  return {
    url: chatCompletionsUrl(config),
    headers,
    body: {
      model: config.model,
      messages: [
        { role: "system", content: buildSystemPrompt(document, context) },
        { role: "user", content: prompt }
      ],
      tools: TOOL_SCHEMA,
      tool_choice: "auto"
    }
  };
}
