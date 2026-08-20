/**
 * specs/agent-service.md AG-022 / specs/ux-settings.md UX-1303: a single
 * dedicated `localStorage` record for the `AgentService` provider selection
 * and local-endpoint configuration, read/written only through this module —
 * the exact same "one seam, not scattered `localStorage` calls" reasoning
 * as `../tour/tour-storage.ts` (see that file's own header for the fuller
 * argument, which applies unchanged here: this state is inherently
 * app-level, not project-level, and must be readable before any project is
 * even open).
 */

const STORAGE_KEY = "gltf-studio.settings.v1";

export type AgentProviderKind = "mock" | "local";

export interface SettingsStorageRecord {
  provider: AgentProviderKind;
  baseUrl: string;
  model: string;
  /** `""` means "no key", never `undefined` -- keeps JSON round-tripping simple. */
  apiKey: string;
}

/**
 * AG-022/UX-1303: a fresh install / missing / corrupt record reads as this
 * default -- Mock is always the fallback, so the public demo's zero-setup
 * path is never disturbed by a setting persisted in a different browser
 * profile or session. The base URL is the Ollama default (docs/adr/0005).
 */
const DEFAULT_RECORD: SettingsStorageRecord = {
  provider: "mock",
  baseUrl: "http://localhost:11434/v1",
  model: "",
  apiKey: ""
};

function safeParse(raw: string | null): SettingsStorageRecord {
  if (!raw) return { ...DEFAULT_RECORD };
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsStorageRecord>;
    return {
      provider: parsed.provider === "local" ? "local" : "mock",
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : DEFAULT_RECORD.baseUrl,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_RECORD.model,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : DEFAULT_RECORD.apiKey
    };
  } catch {
    return { ...DEFAULT_RECORD };
  }
}

/** Reads the current record; a missing/corrupt record reads as the default (mock provider, AG-022). */
export function readSettingsStorage(): SettingsStorageRecord {
  if (typeof localStorage === "undefined") return { ...DEFAULT_RECORD };
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

/** UX-1303: called on every field change -- there is no separate "Save" action. */
export function writeSettingsStorage(record: SettingsStorageRecord): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}
