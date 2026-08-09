# ux-copilot

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the right panel's Copilot tab (`.copilot-context-row`, `#copilot-thread`,
`.copilot-composer`) plus every inline `✦` "Ask Copilot" affordance elsewhere in the shell. This is
the UX realization of `docs/adr/0004-agentic-authoring-as-command-producer.md` and
`specs/agent-service.md`'s `AG-###` contract: every requirement below that changes document state
does so through the exact mechanism `AG-###` already pins down, never a UI-only shortcut around it.

Owns: no dedicated `specs/ownership.json` glob yet (see `specs/ux-shell.md`'s "Owns" note) — this
surface is governed indirectly via `packages/app/**`'s catch-all mapping until it earns its own
package.

Prefix: `UX`. This file owns the `UX-10xx` block.

## Requirements

### Panel tabs

- [UX-1000] (active) The right panel has exactly two tabs — Inspector and Copilot — mutually exclusive, one active at a time (`specs/ux-inspector.md` specifies the Inspector tab's own content).

### Context chips

- [UX-1001] (active) The Copilot tab's context row shows one removable chip per item currently attached as context for the next request, plus a "+ Add context" control; the current selection auto-populates a chip on every request per `AG-012`, without the user needing to manually re-attach what is already selected.
- [UX-1002] (active) Removing a context chip removes that item from what will be sent with the next request; per `AG-013`, every element assembled into a request's context is rendered as a chip here before sending — nothing reaches `AgentService.request` that was not shown as a chip first.

### Thread

- [UX-1003] (active) The thread renders alternating user and assistant messages; a pending request shows a transient "thinking…" bubble that is replaced by the resulting proposal card (`UX-1004`) once the response arrives.

### Proposal cards

- [UX-1004] (active) A proposal card shows: an intent summary, an expand/collapse toggle for its command list, a badge row (a validation-passed badge, an EQUIV pass/n/a badge, and a command-count badge — reflecting `AG-006`/`AG-007`/`AG-008`'s `ValidationReport`), an optional row of generated-asset thumbnails (`UX-1009`), and an action row.
- [UX-1005] (active) A pending proposal's action row is exactly Accept, Reject, and "Try in play"; once accepted, the card instead shows a "✓ Applied" tag (plus "Try in play"); once rejected, it shows a "Rejected" tag (plus "Try in play") — a card is never left with no state indicator once it leaves `pending`.
- [UX-1006] (active) Accept applies the proposal's commands as the single undoable transaction `AG-004` defines and immediately marks the card Applied; Reject performs the zero-mutation discard `AG-009` defines and marks the card Rejected. Neither action is itself reversible from the card — undoing an applied proposal happens through the ordinary history/undo affordance (`UX-1008`), not a Copilot-specific "unapply."
- [UX-1007] (active) "Try in play" enters play mode to preview a proposal's effect without applying its `commands` to the document, and is available regardless of the card's `pending`/`accepted`/`rejected` state.

### History integration

- [UX-1008] (active) Accepting a proposal appends one or more `"Copilot: …"`-labeled entries to the history dropdown (`specs/ux-shell.md`'s `UX-108`); undoing them uses the same undo control as any manually-authored history entry — no Copilot-specific undo control exists, consistent with `AG-005`'s "indistinguishable from a manually-authored entry."

### Inline `✦` affordances

- [UX-1009] (active) A `✦` control in the graph-canvas palette header (`specs/ux-graph-canvas.md`'s `UX-511`), the Inspector header (`specs/ux-inspector.md`), and the right-click context menu (`specs/ux-scene-tree.md`'s `UX-207`/`UX-208`) all switch the right panel to the Copilot tab and add exactly one context chip naming their own origin (the current graph, the current selection, or the right-clicked object, respectively) — realizing `AG-015`'s "same request/response contract, differing only in prefilled context" requirement.

### Asset-generation proposals

- [UX-1010] (active) An asset-generation proposal (e.g. procedurally generated props) additionally renders a thumbnail per generated asset, but otherwise follows the identical card anatomy and action contract (`UX-1004`..`UX-1007`) as any other proposal — generated-asset proposals are not a visually or behaviorally distinct card type, consistent with `AG-014` treating generated assets as ordinary document patches.

### Composer

- [UX-1011] (active) The composer is a multi-line prompt field plus a Send action; `Cmd/Ctrl+Enter` also sends; sending immediately appends the user's message to the thread and clears the field before any response arrives.

## Open questions

- OPEN(AG-preview-render-tbd, carried from `specs/agent-service.md`): "Try in play" (`UX-1007`)
  is one concrete realization of `AG`'s deferred "is a pending proposal's diff previewed as a
  scene overlay, or only as a list/text diff" question — this freeze pins down that play-mode
  preview exists as an option, not that it is the only or primary preview surface.
