import { create } from "zustand";
import { testLocalEndpointConnection } from "@gltf-studio/agent-llm";
import { readSettingsStorage, writeSettingsStorage, type AgentProviderKind } from "./settings-storage.js";

/**
 * A small, dedicated store for the settings dialog's own open/field state —
 * deliberately separate from the main `useAppStore` (`../store/app-store.ts`):
 * this is a UI/config-only concern (which `AgentService` provider the
 * Copilot panel talks to, and that provider's own configuration), not
 * document/history state, and keeping it under `packages/app/src/settings/**`
 * is what lets that directory's `specs/ownership.json` glob cleanly own
 * every file this feature touches (`specs/ux-settings.md`'s "Owns" note) —
 * the exact same reasoning `../tour/tour-state.ts` documents for itself.
 */

export type SettingsTestStatus = "ok" | "connection-refused" | "cors-blocked" | "model-not-found";

export interface SettingsTestResult {
  status: SettingsTestStatus;
  message: string;
}

interface SettingsState {
  isOpen: boolean;
  provider: AgentProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  models: string[] | null;
  testResult: SettingsTestResult | null;
  testing: boolean;

  open(): void;
  /** UX-1300: closing never discards already-persisted state -- every setter below persists on change, so there is nothing to roll back here. */
  close(): void;
  setProvider(provider: AgentProviderKind): void;
  setBaseUrl(baseUrl: string): void;
  setModel(model: string): void;
  setApiKey(apiKey: string): void;
  /** UX-1302: "Fetch models" -- failure here is not itself an error state (see method body). */
  fetchModels(): Promise<void>;
  /** UX-1304: "Test connection" -- reports exactly one of four outcomes. */
  testConnection(): Promise<void>;
}

export const useSettingsState = create<SettingsState>((set, get) => {
  const initial = readSettingsStorage();

  return {
    isOpen: false,
    provider: initial.provider,
    baseUrl: initial.baseUrl,
    model: initial.model,
    apiKey: initial.apiKey,
    models: null,
    testResult: null,
    testing: false,

    open() {
      set({ isOpen: true });
    },

    close() {
      set({ isOpen: false });
    },

    setProvider(provider) {
      set({ provider });
      const s = get();
      writeSettingsStorage({ provider, baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey });
    },

    setBaseUrl(baseUrl) {
      set({ baseUrl });
      const s = get();
      writeSettingsStorage({ provider: s.provider, baseUrl, model: s.model, apiKey: s.apiKey });
    },

    setModel(model) {
      set({ model });
      const s = get();
      writeSettingsStorage({ provider: s.provider, baseUrl: s.baseUrl, model, apiKey: s.apiKey });
    },

    setApiKey(apiKey) {
      set({ apiKey });
      const s = get();
      writeSettingsStorage({ provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey });
    },

    async fetchModels() {
      const { baseUrl, apiKey } = get();
      try {
        const url = `${baseUrl.replace(/\/$/, "")}/models`;
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const response = await fetch(url, { headers });
        if (!response.ok) return;
        const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
        if (!Array.isArray(body?.data)) return;
        const models = body.data.filter((m): m is { id: string } => typeof m?.id === "string").map((m) => m.id);
        set({ models });
      } catch {
        // UX-1302: fetch failing here is not itself an error state -- leave `models` as whatever it already was.
      }
    },

    async testConnection() {
      set({ testing: true });
      const { baseUrl, apiKey, model } = get();
      const origin = typeof window !== "undefined" ? window.location.origin : undefined;
      const result = await testLocalEndpointConnection(baseUrl, {
        apiKey: apiKey || undefined,
        model: model || undefined,
        origin
      });
      set((s) => ({
        testing: false,
        testResult: { status: result.status, message: result.message },
        // UX-1302/UX-1304 overlap: a successful test also populates the model list, same as "Fetch models" would.
        models: result.models ?? s.models
      }));
    }
  };
});
