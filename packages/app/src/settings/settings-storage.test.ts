/** @spec AG-022 UX-1303 */
// Unit tests for settings-storage.ts (specs/agent-service.md AG-022's
// browser-local-storage persistence contract, specs/ux-settings.md UX-1303's
// "persisted on change, read back on next load, defaults to Mock" contract).
//
// The root vitest.config.ts runs this suite with `environment: "node"`
// (see repo root), which does not define a global `localStorage` -- unlike
// `../tour/tour-storage.ts` (which has no test of its own), this file
// defines a tiny in-memory polyfill so `readSettingsStorage`/
// `writeSettingsStorage`'s real read/write paths are exercised, not just
// their `typeof localStorage === "undefined"` fallback branch. Vitest
// isolates each test file's module/global scope by default (`test.isolate`,
// unset here so it keeps its default of `true`), so this polyfill does not
// leak into other test files in the same run.
import { beforeEach, describe, expect, it } from "vitest";

if (typeof localStorage === "undefined") {
  class MemoryStorage {
    #map = new Map<string, string>();
    getItem(key: string): string | null {
      return this.#map.has(key) ? this.#map.get(key)! : null;
    }
    setItem(key: string, value: string): void {
      this.#map.set(key, value);
    }
    removeItem(key: string): void {
      this.#map.delete(key);
    }
    clear(): void {
      this.#map.clear();
    }
  }
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
}

import { readSettingsStorage, writeSettingsStorage, type SettingsStorageRecord } from "./settings-storage.js";

const STORAGE_KEY = "gltf-studio.settings.v1";

describe("settings-storage (AG-022, UX-1303)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the mock provider with the Ollama base URL when nothing is stored (AG-022)", () => {
    const record = readSettingsStorage();
    expect(record).toEqual({ provider: "mock", baseUrl: "http://localhost:11434/v1", model: "", apiKey: "" });
  });

  it("round-trips a written record back out unchanged (UX-1303: persisted on change, read back on next load)", () => {
    const record: SettingsStorageRecord = { provider: "local", baseUrl: "http://localhost:1234/v1", model: "llama3.2", apiKey: "sk-test" };
    writeSettingsStorage(record);
    expect(readSettingsStorage()).toEqual(record);
  });

  it("falls back to the default record on corrupt JSON without throwing (AG-022)", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => readSettingsStorage()).not.toThrow();
    expect(readSettingsStorage()).toEqual({ provider: "mock", baseUrl: "http://localhost:11434/v1", model: "", apiKey: "" });
  });

  it("falls back to the default record when stored fields have the wrong types (AG-022)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: "not-a-real-provider", baseUrl: 42, model: null, apiKey: {} }));
    expect(readSettingsStorage()).toEqual({ provider: "mock", baseUrl: "http://localhost:11434/v1", model: "", apiKey: "" });
  });
});
