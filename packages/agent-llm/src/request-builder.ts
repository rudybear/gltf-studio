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

function describeSelection(document: EditorDocument, nodeIndex: number): string {
  const node = getIn(document.json, ["nodes", nodeIndex]) as { name?: string; translation?: number[] } | undefined;
  if (!node) return `- selected node index ${nodeIndex} (not found in the current document)`;
  const name = typeof node.name === "string" ? node.name : `node ${nodeIndex}`;
  const translation = node.translation ?? [0, 0, 0];
  return `- selected: nodeIndex=${nodeIndex}, name="${name}", translation=[${translation.join(", ")}]`;
}

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
 * Builds the scene-summary section of the system prompt: the selected
 * node's index/name/transform (AG-002's "selection" context kind), any
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
  return lines.length > 0 ? lines.join("\n") : "(no selection or attached context; no existing graph variables)";
}

export function buildSystemPrompt(document: EditorDocument, context: AgentContextRef[]): string {
  return [
    "You are a glTF scene-editing assistant embedded in a 3D editor.",
    "You MUST respond only by calling one or more of the provided tools — never describe an edit in prose.",
    "A response with no tool call is treated as a refusal to edit anything, so if you cannot express the",
    "requested change with the available tools, explain that briefly in plain text instead of guessing.",
    "",
    "Current scene context:",
    buildSceneSummary(document, context),
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
