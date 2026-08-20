# 5. A local OpenAI-compatible endpoint as the first real `AgentService` provider

Status: active

## Context

`docs/adr/0004-agentic-authoring-as-command-producer.md` locked the architecture — `AgentService` is
an interface, `Proposal.commands` are built exclusively via `editor-core`'s command factories, and
v1 shipped only the mock/offline provider (`packages/agent-mock`, `AG-010`) — and deliberately
deferred *which* real provider arrives first (`AG-011`, ADR-0004's "LLM provisioning itself is
explicitly out of scope" note). This decision picks that first real provider.

Two shapes were on the table: a hosted proxy this project operates (an API key and a server this
project pays for and is responsible for securing), or a **local model the end user already runs**
(Ollama, LM Studio, or anything else that speaks the same OpenAI-compatible `/v1/chat/completions`
tool-calling wire format). A local endpoint wins for v1 for reasons specific to this project's
constraints, not as a general verdict against hosted providers:

- **No API key custody.** A hosted proxy means this project holds or proxies a paid API key —
  billing, abuse, and key-rotation exposure that a local-first, static-hosted (`packages/app` builds
  to a Pages-deployable static bundle) editor has no infrastructure to operate safely.
- **No GPU in this project's dev or CI environment.** Every automated check — unit tests, contract
  tests, e2e — must run without a real model present. A local-endpoint provider is the only shape
  where that is true by construction: the provider is *a client of an HTTP contract*, and that
  contract is fully testable against a stub server that speaks the same wire shape a real Ollama/LM
  Studio instance does, without ever needing a model loaded anywhere in CI.
- **Privacy resolves itself.** `AG-privacy-tbd` (open in `specs/agent-service.md`) noted that
  privacy posture is a property of whichever concrete provider ships. A local endpoint's prompt and
  context never leave the user's machine — there is no third party to disclose a retention policy
  for. This does not resolve `AG-privacy-tbd` for a *future* hosted provider, but it means v1's real
  provider ships with the strongest privacy posture available, for free.

The OpenAI-compatible tool-calling wire format (`tools: [...]` in the request, `tool_calls` in the
response `message`) is what makes this tractable at all: Ollama and LM Studio both implement it
(with small differences — see Consequences), and it is expressive enough to carry a real
function/operation schema, not just free text the app would have to parse.

## Decision

**A new `packages/agent-llm` implements `AgentService` against a local OpenAI-compatible
`/v1/chat/completions` endpoint, using tool-calls as the plan-source mechanism, with the mock
provider (`packages/agent-mock`) remaining the default for every fresh install and the public demo.**

- **The LLM is a plan source, not a writer — enforced by construction, not by convention.** The
  request sent to the endpoint includes a `tools` array of JSON-Schema function definitions, one per
  editor operation the app is willing to build a `Command` for (a curated subset of `GraphEdit.*`,
  `SceneEdit.*`, `AudioGraphEdit.*` — see `specs/agent-service.md` `AG-019` for the schema
  contract). The model's *only* channel back to the app is `tool_calls` — structured
  `{name, arguments}` pairs. There is no code path anywhere in `agent-llm` that takes response
  *text* (prose, a diff, a patch, anything free-form) and turns it into a document mutation. A
  response with no `tool_calls` is not a degraded proposal; it is a refusal (`AG-020`).
- **The proposal pipeline is shared, not duplicated.** The "resolve each tool-call's arguments into
  a factory call, accumulate `Command`s against a running scratch document, validate the result on
  that scratch document, produce a `Proposal`" pipeline `packages/agent-mock` already built
  (`CommandChain`, `validateProposalGraph`) is extracted into a shared module both providers depend
  on (implementation: `packages/agent-shared`, see the refactor accompanying this ADR). `agent-mock`
  supplies its 4 templates as the plan source into that pipeline; `agent-llm` supplies the model's
  resolved tool-calls into the *same* pipeline. Neither provider re-implements or forks validation.
  This is `AG-003`/`AG-006` applied one level down: not just "same command factories," but "same
  code path from operation list to validated `Proposal`," so there is exactly one place a bug in
  that path could hide, not two.
- **Every model failure mode degrades to an honest, typed outcome — never a silent bad edit.** Four
  cases, each with a distinct outcome the UI can render distinctly:
  1. The model returns prose instead of tool-calls → refusal, "couldn't produce a valid plan."
  2. The model calls a tool with arguments the corresponding factory rejects (wrong types, an
     out-of-range node index, an unknown pointer path) → that operation is dropped and noted; if
     *no* operation in the batch resolved, the whole request is a refusal, not an empty proposal.
  3. A resolved batch fails validation (`checkModule`/`validateGraph` on the scratch document, same
     as the mock) → an ordinary invalid `Proposal` (`AG-008`'s existing rule: error-level findings
     block one-click acceptance) — no different from a mock proposal that fails validation.
  4. The endpoint is unreachable, refuses the connection, or the browser blocks the request as
     cross-origin → a typed network/CORS error surfaced with actionable guidance (which of these it
     is matters: "connection refused" and "CORS-blocked" have different fixes — see Consequences).
- **Configuration is local-only and provider selection persists.** Base URL, model name, and an
  optional API key (LM Studio/Ollama don't require one; some local-endpoint-compatible setups do)
  are entered in a new settings dialog (`specs/ux-settings.md`) and persisted in the browser's own
  storage — never transmitted anywhere except the configured endpoint itself. Provider choice (Mock
  vs. Local model) persists the same way. A fresh install or the public Pages demo defaults to Mock,
  so the zero-setup path (`AG-010`) is never disturbed by this decision.
- **Non-streaming for v1.** The request is a single non-streaming
  `POST /v1/chat/completions`; the panel's existing "thinking…" pending state (`UX-1003`) already
  covers the wait with no protocol changes needed. Streaming (incremental tool-call assembly) is
  explicitly deferred — see Consequences.

See `specs/agent-service.md`'s `AG-017`..`AG-022` for the requirement set this decision is checked
against, and `specs/ux-settings.md` for the settings-dialog UX contract.

## Consequences

- **CI and local dev are permanently GPU-free.** `agent-llm`'s test suite (unit + contract tests)
  runs entirely against a stub HTTP layer returning canned OpenAI-shaped tool-call JSON — no model,
  no GPU, no real Ollama/LM Studio process, anywhere in CI. This is a hard requirement, not a
  convenience: it means `agent-llm`'s correctness is proven at the *wire-contract* level (does it
  build the right request, does it parse a given response shape correctly, does it fail the right
  way on a given malformed/prose/error response) and never at the "does this particular model
  produce good plans" level, which is unautomatable here and is explicitly the end user's own
  responsibility once they point the editor at their own model.
- **Ollama and LM Studio don't speak identically OpenAI-shaped tool-calls, so `agent-llm`'s response
  parser must tolerate the union, not just one vendor's shape.** Concretely: both put `tool_calls`
  on `choices[0].message`, but stub tests are written against fixtures shaped like *both* (see
  `packages/agent-llm/src/*.test.ts`), and the parser does not assume, e.g., that `arguments` is
  always a JSON string vs. already-parsed object, or that only one tool call ever comes back per
  turn. A future third local-endpoint implementation that drifts further from either shape is a real
  risk this ADR accepts rather than solves — the parser is defensive, not exhaustively compatible
  with every possible server.
- **The hosted Pages demo can drive a visitor's own local model, but only if they configure CORS.**
  A page served from `https://<pages-domain>` fetching `http://localhost:11434/v1/...` is not a
  mixed-content violation (the "localhost is a secure context" exception covers this), but it *is* a
  cross-origin request, and Ollama/LM Studio's default CORS posture rejects browser-origin requests
  they don't recognize. The settings dialog's "Test connection" action distinguishes
  connection-refused (nothing listening) from a CORS rejection (something is listening but the
  browser blocked reading the response) and prints the fix for each (`OLLAMA_ORIGINS=<origin>` env
  var for Ollama; the CORS toggle in LM Studio's server settings) rather than a generic "request
  failed." This is real, user-facing setup friction this decision accepts as the cost of "no backend
  this project operates."
- **The curated tool schema is a maintenance surface that must track `editor-core`'s factories.**
  Every factory the schema exposes is one more JSON-Schema function definition `agent-llm` must keep
  in sync with the factory's actual signature, and a factory the schema does *not* expose is simply
  unreachable by the LLM provider (not a gap in `AG-003`'s "same factories" guarantee — the mock
  provider is equally free to use any factory its templates need; the LLM provider's schema is a
  *subset* the model can currently address, sized to what a tool-calling model can reliably use, not
  a ceiling on what the architecture allows).
- **Streaming, multi-turn tool-call refinement, and determinism are still deferred.** Non-streaming
  v1 means a slow local model blocks the "thinking…" bubble for its full generation time with no
  incremental feedback — acceptable for v1, worth revisiting once the panel needs it.
  `AG-multiturn-tbd` (already open) is unresolved by this decision: a follow-up prompt on a pending
  proposal is still unspecified. `AG-determinism-tbd` (already open) is unresolved too — identical
  prompt+context against a real local model is not guaranteed to reproduce identical proposals, and
  this ADR does not attempt to pin that down (unlike the mock, which is deterministic by
  construction).
