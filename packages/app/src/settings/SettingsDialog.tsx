import { useEffect } from "react";
import { useSettingsState } from "./settings-state.js";

const PROVIDER_LABELS: Record<"mock" | "local", string> = {
  mock: "Mock (default)",
  local: "Local model (OpenAI-compatible)"
};

const STATUS_ICON: Record<string, string> = {
  ok: "✓",
  "connection-refused": "✕",
  "cors-blocked": "⚠",
  "model-not-found": "⚠"
};

/**
 * specs/ux-settings.md UX-1300..1305: the settings dialog -- provider
 * selection plus local-endpoint configuration for whichever `AgentService`
 * (specs/agent-service.md AG-017..AG-022) the Copilot panel is currently
 * wired to. Follows `../components/project-manager/ShareDialog.tsx`'s exact
 * modal pattern (`modal-overlay open` wrapper, backdrop-click-to-close,
 * `mf-modal`/`modal-head`/`modal-body`, an Escape-key listener, `role=
 * "dialog" aria-modal="true"`) and reuses its CSS classes rather than
 * inventing a parallel modal system. Mounted once at `App.tsx`'s top level;
 * driven entirely by `useSettingsState` (`./settings-state.ts`).
 */
export function SettingsDialog(): JSX.Element | null {
  const isOpen = useSettingsState((s) => s.isOpen);
  const close = useSettingsState((s) => s.close);
  const provider = useSettingsState((s) => s.provider);
  const setProvider = useSettingsState((s) => s.setProvider);
  const baseUrl = useSettingsState((s) => s.baseUrl);
  const setBaseUrl = useSettingsState((s) => s.setBaseUrl);
  const model = useSettingsState((s) => s.model);
  const setModel = useSettingsState((s) => s.setModel);
  const apiKey = useSettingsState((s) => s.apiKey);
  const setApiKey = useSettingsState((s) => s.setApiKey);
  const models = useSettingsState((s) => s.models);
  const fetchModels = useSettingsState((s) => s.fetchModels);
  const testConnection = useSettingsState((s) => s.testConnection);
  const testing = useSettingsState((s) => s.testing);
  const testResult = useSettingsState((s) => s.testResult);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const canTestConnection = provider === "local" && baseUrl.trim().length > 0;

  return (
    <div
      className="modal-overlay open"
      data-testid="settings.dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="mf-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Settings</h3>
          <button className="close-x" data-testid="settings.close-x" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body mf-body">
          <div className="field-row">
            <label>Copilot provider</label>
            <select
              className="field"
              data-testid="settings.provider-select"
              value={provider}
              onChange={(e) => setProvider(e.target.value as "mock" | "local")}
            >
              <option value="mock">{PROVIDER_LABELS.mock}</option>
              <option value="local">{PROVIDER_LABELS.local}</option>
            </select>
          </div>

          {provider === "local" && (
            <>
              <div className="field-row">
                <label>Base URL</label>
                <input className="field" type="text" data-testid="settings.base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>

              <p className="mf-hint" data-testid="settings.model-recommendation">
                Recommended if you're not sure: <code>gemma4:26b</code> (or a similarly-sized tool-calling model) —
                validated to reliably call the right tool with well-formed arguments while responding in well under a
                second once warm. Any tool-calling-capable OpenAI-compatible model works here; this is a suggestion,
                not a requirement. Reasoning-only models without native tool-calling support (e.g. some DeepSeek-R1
                builds) will be rejected by the endpoint itself.
              </p>

              <div className="field-row">
                <label>Model</label>
                {models !== null ? (
                  <select className="field" data-testid="settings.model" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">(none selected)</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="field" type="text" data-testid="settings.model" value={model} onChange={(e) => setModel(e.target.value)} />
                )}
                <button className="btn small" data-testid="settings.fetch-models" onClick={() => void fetchModels()}>
                  Fetch models
                </button>
              </div>

              <div className="field-row">
                <label>API key (optional)</label>
                <input className="field" type="password" data-testid="settings.api-key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>

              <p>
                <button
                  className="btn"
                  data-testid="settings.test-connection"
                  disabled={!canTestConnection || testing}
                  onClick={() => void testConnection()}
                >
                  {testing ? "Testing…" : "Test connection"}
                </button>
              </p>

              {testResult && (
                <p className={`settings-test-result settings-test-result--${testResult.status}`} data-testid="settings.test-result">
                  {STATUS_ICON[testResult.status] ?? "⚠"} {testResult.message}
                </p>
              )}
            </>
          )}

          <p className="mf-hint" data-testid="settings.cors-help">
            The hosted demo can drive a local model running on your own machine once you allow this page&rsquo;s origin through the
            endpoint&rsquo;s CORS setting — most local servers (Ollama, LM Studio, …) block cross-origin requests by default. A page served
            over https:// fetching http://localhost is allowed by the browser&rsquo;s &ldquo;localhost is a secure context&rdquo; exception,
            so if a connection test above reports CORS-blocked, the fix is a CORS setting on the endpoint, not a mixed-content problem.
            For Ollama, set <code>OLLAMA_ORIGINS</code> to include every origin you&rsquo;ll use before restarting it, e.g.{" "}
            <code>OLLAMA_ORIGINS=&quot;{window.location.origin},https://rudybear.github.io&quot; ollama serve</code>.
            For LM Studio, enable CORS in the server settings (Developer tab → Server Settings → &ldquo;Enable CORS&rdquo;). Some Ollama
            installs already default to a permissive origin policy — Test connection above tells you definitively whether yours does.
          </p>
        </div>
      </div>
    </div>
  );
}
