# ux-settings

Mockup snapshot: none, following `specs/ux-tour.md`'s own precedent — this surface (a settings
dialog for choosing and configuring the `AgentService` provider) postdates the approved v5/v6
mockups (`docs/ux/README.md`) and was never part of them. The requirements below are
interaction-contract level exactly like every other `ux-*.md` file; there is simply no historical
screenshot backing them.

This is the UX realization of `docs/adr/0005-local-openai-compatible-llm-provider.md` and
`specs/agent-service.md`'s `AG-017`..`AG-022` — every requirement below that reads or writes
provider configuration does so through the exact persistence and provider-selection contract those
requirements already pin down, never a UI-only shortcut around it.

Owns (`specs/ownership.json`): `packages/app/src/settings/**` — a dedicated source directory for
the dialog, its provider-config persistence seam, and connection-test logic, carved out of
`packages/app`'s general `ux-shell.md` catch-all the same way `specs/ux-tour.md` carved out
`packages/app/src/tour/**`. The top-bar entry point itself (`topbar.settings`, one line in
`TopBar.tsx`) remains governed by `specs/ux-shell.md`'s own `UX-129` for the same reason `UX-121`
(tour) does not live here either.

Prefix: `UX`. This file owns the `UX-13xx` block.

## Requirements

### Dialog shape

- [UX-1300] (active) `topbar.settings` (`UX-129`) opens a modal dialog (`settings.dialog`) over the current view; closing it (an explicit close control, `Escape`, or a backdrop click) never discards unsaved provider selection or connection-test state that has already been persisted (`UX-1303`) — only in-progress, not-yet-confirmed field edits can be lost by closing mid-edit, matching ordinary form-dialog expectations elsewhere in the shell.

### Provider selection

- [UX-1301] (active) The dialog's primary control is a provider select (`settings.provider-select`) with exactly two options — "Mock (default)" and "Local model (OpenAI-compatible)" — reflecting `AG-022`'s two-provider v1 scope; selecting "Local model" reveals the fields in `UX-1302`, selecting "Mock" hides them (the Copilot panel then addresses the mock provider regardless of what those fields hold).

### Local-model configuration

- [UX-1302] (active) When "Local model" is selected, the dialog shows: a base URL field (`settings.base-url`, prefilled with the Ollama default `http://localhost:11434/v1` on first use, per `docs/adr/0005`), a model field (`settings.model`), and an optional API key field (`settings.api-key`, masked like a password input). A "Fetch models" action (`settings.fetch-models`) calls the configured base URL's `GET /v1/models` and, on success, replaces the model field with a select populated from the response; on failure (unreachable, CORS-blocked, non-2xx) the model field silently remains free text — fetch failing here is not itself an error state the dialog reports (`UX-1304` covers the dedicated connection-test affordance for that).
- [UX-1303] (active) Provider selection and, when "Local model" is chosen, its base URL/model/API key are persisted to the browser's own local storage (`AG-022`) on change (no separate "Save" action to remember to click) and read back on the next app load — a fresh install or any load with no stored selection defaults to Mock (`AG-022`, `AG-010`), so the public demo's zero-setup path is never disturbed by a setting persisted in a different browser profile or session.

### Connection test

- [UX-1304] (active) A "Test connection" action (`settings.test-connection`), enabled only while "Local model" is selected and a base URL is filled in, sends a lightweight request (`GET /v1/models`, the same endpoint `UX-1302`'s fetch-models uses) to the configured base URL and reports exactly one of four outcomes distinguishably (`settings.test-result`, both an icon/color and a text message, never color alone): success (endpoint reachable and responded); connection-refused (nothing listening at that URL — message suggests checking that Ollama/LM Studio is running and the port matches); CORS-blocked (a request went out but the browser blocked reading the response — message names the fix per `docs/adr/0005`'s Consequences: `OLLAMA_ORIGINS=<this page's origin>` for Ollama, enabling CORS in LM Studio's server settings, with the page's own origin shown inline so the user can copy it exactly); model-not-found (endpoint reachable, but the configured model name does not appear in its model list — only checked when `UX-1302`'s fetch-models succeeded or the user filled the model field manually, not treated as a hard failure since some servers omit unloaded models from `/v1/models`).

### In-app CORS/hosted-demo guidance

- [UX-1305] (active) The dialog carries static help text (not conditional on any test result) explaining that the hosted Pages demo can drive the visitor's own local model once they allow the page's origin via the target server's CORS setting, and that an `https://`-served page fetching `http://localhost:...` is permitted by the browser's "localhost is a secure context" exception — CORS configuration, not mixed-content blocking, is the thing to fix if `UX-1304` reports CORS-blocked. `README.md` carries the same guidance for a reader who has not yet opened the app.

## Open questions

- OPEN(UX-settings-scope-tbd): this dialog's v1 scope is exactly the `AgentService` provider (`AG-022`); if other user-level preferences (e.g. `UX-105`'s theme override) migrate here from their current standalone top-bar controls in a later pass, that consolidation is not designed by this file.
