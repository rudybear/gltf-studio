// AG-021: the network layer. Wraps the actual fetch call and disambiguates
// the one failure mode both Node's and the browser's fetch collapse into a
// single indistinguishable `TypeError` — DNS failure, connection refused,
// and a browser blocking the request as cross-origin (CORS) all throw the
// exact same `TypeError: Failed to fetch` (or Node's equivalent), by
// design: browsers deliberately do not expose to page script WHY a fetch
// was blocked, since that would leak information about the network/other
// origins to an attacker page.
import { AgentNetworkError, ConnectionRefusedError, CorsBlockedError } from "./errors.js";
import type { ChatCompletionRequest } from "./request-builder.js";

/**
 * Best-effort disambiguation, not a certainty: retries the SAME url with
 * `mode: "no-cors"`, which does not require the server to send CORS
 * headers to succeed — the browser will happily "resolve" a no-cors
 * request with an opaque, unreadable response as long as *something*
 * accepted the TCP/TLS connection and returned any HTTP response at all.
 * So: if the no-cors attempt ALSO throws, nothing is listening at that
 * host:port at all. If the no-cors attempt resolves (even opaquely), a
 * server IS there but the original (cors-mode) request was blocked from
 * being read. This is a heuristic — a caveat worth repeating in any
 * docs/UI copy that surfaces these errors: there is no first-class browser
 * API that reports the true reason a fetch failed, so this probe is the
 * best available signal, not proof.
 *
 * Shared by `classifyNetworkFailure` below (`postChatCompletion`'s own
 * TypeError handling) and `connection-test.ts`'s `testLocalEndpointConnection`
 * (AG-021/UX-1304's "Test connection" affordance) — both need the exact same
 * probe, so it lives here once rather than being copy-pasted a second time.
 */
export async function probeNoCors(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: "POST", mode: "no-cors" });
    return true;
  } catch {
    return false;
  }
}

async function classifyNetworkFailure(url: string): Promise<AgentNetworkError> {
  const reachable = await probeNoCors(url);
  return reachable ? new CorsBlockedError(url) : new ConnectionRefusedError(url);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** POSTs the assembled chat-completions request and returns the parsed JSON body, or throws a ConnectionRefusedError/CorsBlockedError (AG-021) on a network-layer failure. */
export async function postChatCompletion(request: ChatCompletionRequest): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      mode: "cors",
      headers: request.headers,
      body: JSON.stringify(request.body)
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw await classifyNetworkFailure(request.url);
    }
    throw err;
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new Error(`Request to ${request.url} failed with status ${response.status}${text ? `: ${text}` : ""}`);
  }

  return response.json();
}
