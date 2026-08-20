// AG-021/AG-022, specs/ux-settings.md UX-1304: the settings dialog's
// "Test connection" affordance. Deliberately separate from
// openai-compatible-agent-provider.ts's real request path — this hits
// `GET /v1/models` (the same lightweight endpoint UX-1302's "Fetch models"
// uses), never `POST /v1/chat/completions`, so testing a connection never
// costs a real model invocation. Reuses network.ts's `probeNoCors` heuristic
// for the same connection-refused/CORS-blocked disambiguation
// postChatCompletion's own TypeError handling already relies on, rather than
// re-implementing it.
import { probeNoCors } from "./network.js";

export interface ConnectionTestResult {
  status: "ok" | "connection-refused" | "cors-blocked" | "model-not-found";
  message: string;
  models?: string[];
}

interface ModelsListResponseBody {
  data?: Array<{ id?: unknown }>;
}

function parseModelIds(body: unknown): string[] | undefined {
  const data = (body as ModelsListResponseBody | undefined)?.data;
  if (!Array.isArray(data)) return undefined;
  return data.filter((m): m is { id: string } => typeof m?.id === "string").map((m) => m.id);
}

/**
 * GETs `${baseUrl}/models` (cors mode, optional bearer auth) and resolves to
 * exactly one of UX-1304's four outcomes — never throws for a network-layer
 * failure, only for something genuinely unexpected (a non-TypeError thrown
 * by `fetch` itself).
 *
 * `opts.origin` should be the calling page's `window.location.origin`
 * (this package has no guaranteed DOM, so it can't read that itself) — used
 * only to make the `cors-blocked` message's remediation copy concrete
 * (UX-1304: "the page's own origin shown inline so the user can copy it
 * exactly"). Falls back to a generic placeholder when omitted.
 */
export async function testLocalEndpointConnection(
  baseUrl: string,
  opts?: { apiKey?: string; model?: string; origin?: string }
): Promise<ConnectionTestResult> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const origin = opts?.origin ?? "<this page's origin>";
  const headers: Record<string, string> = {};
  if (opts?.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", mode: "cors", headers });
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    const reachable = await probeNoCors(url);
    if (reachable) {
      return {
        status: "cors-blocked",
        message:
          `A server is running at ${baseUrl}, but the browser blocked this page (${origin}) from reading its response (CORS). ` +
          `For Ollama, set OLLAMA_ORIGINS=${origin} and restart Ollama. ` +
          `For LM Studio, enable CORS in the server settings (Developer tab -> Server Settings -> "Enable CORS").`
      };
    }
    return {
      status: "connection-refused",
      message: `Could not reach ${baseUrl} — nothing appears to be listening there. Is the local model server (Ollama, LM Studio, ...) running?`
    };
  }

  if (!response.ok) {
    return {
      status: "connection-refused",
      message: `${baseUrl} responded with HTTP ${response.status} to a request for ${url} — check the base URL and try again.`
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: "connection-refused",
      message: `${baseUrl} responded, but its body couldn't be parsed as JSON — check the base URL points at an OpenAI-compatible endpoint.`
    };
  }

  const models = parseModelIds(body);

  // AG-022/UX-1304: only checked when a model name was actually supplied
  // (fetch-models succeeded or the user typed one manually) -- and even
  // then, not a hard failure, since some servers omit unloaded models from
  // this list.
  if (opts?.model && models && !models.includes(opts.model)) {
    return {
      status: "model-not-found",
      message:
        `Model "${opts.model}" wasn't found in ${baseUrl}'s model list. This isn't necessarily wrong — some servers omit ` +
        `unloaded models from this list — but double-check the model name if requests keep failing.`,
      models
    };
  }

  return { status: "ok", message: `Connected to ${baseUrl}.`, models };
}
