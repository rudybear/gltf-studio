/** @spec AG-021 AG-022 UX-1304 */
// Unit tests for testLocalEndpointConnection (specs/ux-settings.md UX-1304's
// "Test connection" affordance) -- stubs globalThis.fetch, same style as
// openai-compatible-agent-provider.test.ts. No real network call, no real
// model, ever.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testLocalEndpointConnection } from "./connection-test.js";

const BASE_URL = "http://localhost:11434/v1";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response;
}

describe("testLocalEndpointConnection (AG-021/AG-022, UX-1304)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports status ok and the parsed model list when the endpoint responds successfully (UX-1304 outcome 1/4)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "llama3.2" }, { id: "qwen2.5" }] })) as unknown as typeof fetch;

    const result = await testLocalEndpointConnection(BASE_URL);

    expect(result.status).toBe("ok");
    expect(result.models).toEqual(["llama3.2", "qwen2.5"]);
  });

  it("reports connection-refused when both the primary and the no-cors probe fetch fail (UX-1304 outcome 2/4)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testLocalEndpointConnection(BASE_URL);

    expect(result.status).toBe("connection-refused");
    expect(result.message).toMatch(/nothing appears to be listening/i);
    expect(fetchMock).toHaveBeenCalledTimes(2); // primary (cors) + no-cors probe
  });

  it("reports cors-blocked, naming the given origin, when the primary fetch fails but the no-cors probe resolves (UX-1304 outcome 3/4, AG-021)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ type: "opaque" } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await testLocalEndpointConnection(BASE_URL, { origin: "https://example.com" });

    expect(result.status).toBe("cors-blocked");
    expect(result.message).toContain("https://example.com");
    expect(result.message).toMatch(/OLLAMA_ORIGINS=https:\/\/example\.com/);
  });

  it("reports model-not-found (not a hard failure in wording) when the configured model is absent from the model list (UX-1304 outcome 4/4)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "llama3.2" }] })) as unknown as typeof fetch;

    const result = await testLocalEndpointConnection(BASE_URL, { model: "mistral-nemo" });

    expect(result.status).toBe("model-not-found");
    expect(result.message).toContain("mistral-nemo");
    expect(result.message).toMatch(/some servers omit/i);
    expect(result.models).toEqual(["llama3.2"]);
  });

  it("reports ok, not model-not-found, when the configured model IS present in the list (AG-022)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "llama3.2" }] })) as unknown as typeof fetch;

    const result = await testLocalEndpointConnection(BASE_URL, { model: "llama3.2" });

    expect(result.status).toBe("ok");
  });

  it("sends the optional API key as a Bearer header (AG-022)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await testLocalEndpointConnection(BASE_URL, { apiKey: "secret-key" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
  });
});
