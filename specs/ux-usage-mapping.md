# ux-usage-mapping

Mockup snapshot: `docs/ux/mockups/mockup-v6.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), v6's usage-mapping additions: the Inspector's "Used in behavior" section
(`usageSectionHtml`/`usageRowsForSceneNode`), the forward/reverse reference resolution rule
(`graphNodeSceneRefIndex`), and the two-tier (blue selection / amber reference) highlight
vocabulary (the `ref-highlight`-prefixed CSS rules and `setGraphRefHighlight`/
`revealRefInViewport` flow). This is Phase 1 of usage mapping — read `docs/ux/README.md`'s freeze
notes for what v6 changed relative to v5.

Owns (`specs/ownership.json`): `packages/usage-index/**` — the pure derived-index module both the
Inspector section (`packages/app`) and the graph canvas's "Reveal in viewport" (`packages/graph-
canvas`) build on. Those two consuming packages remain governed by their own existing spec files
(`specs/ux-shell.md`'s `packages/app/**` catch-all; `specs/ux-graph-canvas.md`'s
`packages/graph-canvas/**`) — this file does not claim either.

Prefix: `UX`. This file owns the `UX-11xx` block.

## Requirements

### Usage-index derivation rules

- [UX-1100] (active) A `pointer/get`, `pointer/set`, or `pointer/interpolate` behavior-graph node whose `configuration.pointer` (a JSON Pointer Template) resolves to a path beginning `/nodes/{N}` is attributed to scene node `N` — trailing segments after `{N}` (a property name, and/or a component-index suffix such as `/translation/1`) never change which node the reference is attributed to. An int-kind template parameter (e.g. `/nodes/[nodeIndex]/scale`) is substituted with a concrete index only when the graph node's own `values` entry of the same name is a LITERAL; a parameter fed by a value-ref edge (computed at runtime from another node's output) makes the whole pointer unresolvable for this index (`UX-1105`), never guessed at.
- [UX-1101] (active) An `event/onSelect`, `event/onHoverIn`, or `event/onHoverOut` node's `configuration.nodeIndex` (a literal int) is attributed to that scene node; the `-1` "any node" default is never attributed to anything.
- [UX-1102] (active) An `animation/start`, `animation/stop`, or `animation/stopAt` node whose `animation` value is a literal clip index is attributed to every scene node targeted by that clip's own `channels[].target.node`, deduplicated — there is no single "the" scene node for this op family (unlike `UX-1100`/`UX-1101`), so it may produce zero, one, or several attributions from one graph node.
- [UX-1103] (active) A pointer resolving to `/extensions/KHR_audio/emitters/{E}/...` (by the same literal/template-parameter rule as `UX-1100`) is attributed to whichever scene node's own `extensions.KHR_audio_emitter.emitter` equals `E` — the reverse of the node → emitter forward reference `specs/ux-inspector.md`'s Audio Emitter section already reads.
- [UX-1104] (active) The index covers every graph in `extensions.KHR_interactivity.graphs[]` (never assuming a single graph 0); each reference records which graph it came from.
- [UX-1105] (active) A reference this index cannot resolve with certainty — an unrecognized pointer family (e.g. addressing `/materials/*`, out of this index's scope), an out-of-range animation/emitter index, or an unresolvable template parameter (`UX-1100`) — is omitted from the index rather than guessed at.

### Inspector "Used in behavior" section

- [UX-1106] (active) The Inspector shows a "Used in behavior" section for every selected scene node (not gated on node type or on having a mesh/material/audio section), headed "Used in behavior" with no count when empty, "Used in behavior (N)" otherwise; it shows exactly one row per usage-index (`UX-1100..1105`) reference to the selected node.
- [UX-1107] (active) Each row shows: the referencing op id, the row's path/config text (the pointer path, `nodeIndex: N`, or `animation: N (name)`, matching whichever family produced it), which graph it belongs to ("Graph {graphIndex}"), and two actions — "→ Graph" and "→ Script". "→ Graph" switches the bottom dock to the Behavior graph tab, switches the graph selector to the reference's own graph when it differs from the one currently shown, selects that graph node (opening its details card per `specs/ux-graph-canvas.md`'s `UX-507`), and pans/zooms the canvas to it (a programmatic focus request, since the target node may not already be on-screen — distinct from selection itself).
- [UX-1108] (active) "→ Script" switches the bottom dock to the Script tab, switches to the reference's own graph when it differs from the one currently shown, and selects that graph node — the same selection state `specs/ux-script.md`'s `UX-712` cross-highlight reacts to for a `handler`/`proc`/`stateSlot`-kind node. It ALSO issues a durable, queued focus request (`UX-1114`) rather than relying purely on that selection state, because the Script tab is `React.lazy`-mounted on first open with its own inner Monaco dynamic import (`specs/ux-script.md`'s `UX-707`) — a request fired before either exists must still be honored once they are, not silently dropped. For a `kind: "pointer"` reference (`pointer/set`/`pointer/interpolate`, `UX-1100`) the request additionally carries the row's own literal pointer path text as an explicit fallback: `@gltfi/ir`'s `importGraph` gives these ops no `handler`/`proc`/`stateSlot`/`temp` identifier at all (they're inlined directly as an `rt.ptrSet(...)`/`rt.ptrInterp(...)` statement), so `UX-712`'s plain identifier-table lookup can never resolve them on its own — the pointer path is the one thing that DOES survive verbatim into the emitted text (`@gltfi/emit-ts` emits it via `JSON.stringify`), so the Script tab searches for that exact quoted string instead. When the same literal pointer path is set from more than one place in the same graph, the jump prefers the occurrence inside the handler this specific reference's own flow traces back to (a cheap backward flow-predecessor walk, `findEnclosingHandlerRoot`) and otherwise falls back to the first occurrence in the emitted document — a best-effort disambiguation, not a proof of correctness in a genuinely multi-writer graph.
- [UX-1109] (active) A selected node with zero usage-index references shows "Not referenced in behavior" plus an "Attach behavior…" control. Choosing it opens a small menu with: "✦ Ask Copilot about this node" (real — switches the right panel to Copilot and attaches an explicit context chip naming the node, the same inline-affordance contract `specs/ux-copilot.md`'s `UX-1008`/`UX-1009` already establish elsewhere), plus Phase-2 entries (e.g. "Add pointer/set to graph") that are present but not yet wired to a real command — choosing one shows a toast explaining it arrives in a later phase, the same honest-stub convention `specs/ux-scene-tree.md`'s `UX-206` add-menu already established (a real, clickable, visually de-emphasized button — never a silently inert control).
- [UX-1114] (active) A `kind: "pointer"` row's "→ Script" button is disabled with an explanatory tooltip, rather than a click that switches tabs and visibly highlights nothing, when its graph node is unreachable from any `event/*` handler (`findEnclosingHandlerRoot` returns none) — such a node is dead in the graph (`@gltfi/ir`'s `importGraph` never visits/emits an unreachable node), so `UX-1108`'s pointer-path fallback is GUARANTEED to find nothing for it, not merely likely to. "→ Graph" on the same row is unaffected (it needs only the node's existence, never an emitted identifier) and stays enabled. `event-handler`/`animation`-kind rows are not covered by this disabled-state check (tracked as a gap below, not silently assumed fine).

### Two-tier highlight vocabulary

- [UX-1110] (active) Selecting a behavior-graph node whose op resolves a scene-node reference (`UX-1100`/`UX-1101`/`UX-1103` — never `UX-1102`'s multi-target animation family, which has no single node to highlight) drives a SECOND, amber "reference" highlight on that scene node, shown in both the scene tree row and the viewport, fully independent of and able to coexist with the (blue) selection highlight — the same node, a different node, or no node may be selected at the same time a reference highlight is showing. Where both highlights land on the same scene-tree row, the row shows the selection (blue) treatment, per the approved mockup's own coexistence rule.
- [UX-1111] (active) Whenever a selected behavior-graph node carries a reference (`UX-1110`), its details card additionally shows a "Reveal in viewport" control that frames the viewport camera on the referenced scene node and confirms via a toast; because the reference highlight itself is already visible for as long as that details card stays open, this control's own job is camera framing, not the highlight.
- [UX-1112] (active) The reference highlight (`UX-1110`) is ephemeral UI state (never written to the document JSON or the project sidecar) that clears whenever the driving graph-node selection is cleared or no longer resolves a reference — deselecting the graph node (clicking empty canvas), selecting a different graph node with no reference, switching to a different behavior graph, or the document changing out from under it all clear it with no separate "close" gesture required; selecting a *different scene node* (tree row or viewport click) does NOT clear it — only the graph-node selection that's driving it does.

### Performance

- [UX-1113] (active) Usage-index derivation is fast enough not to visibly stall the Inspector on a real, non-trivial document (e.g. a several-hundred-node single-graph asset) and is memoized on the document JSON's own identity — the same identity-based memoization convention `@gltf-studio/graph-canvas`'s `mapGraph`/`buildPointerContentTree` already use — so it never recomputes on an unrelated selection change, only on an actual document edit.

## Implementation notes

`packages/usage-index` (M9): a small, dependency-light package (`@gltfi/kernel`'s
`parsePointerTemplate` is its only runtime dependency) exporting `buildUsageIndex` (the full
document → `Map<sceneNodeIndex, UsageRef[]>`, `UX-1100..1105`) and `graphNodeSceneRef` (the single-
node forward resolution rule `buildUsageIndex` is built from, reused as-is by `graph-canvas`'s
"Reveal in viewport"/reference-highlight forward lookup rather than re-derived — see
`specs/ux-graph-canvas.md`'s own implementation note). Both are plain functions over structural
JSON shapes (no dependency on `packages/app`'s richer `GltfJsonShape` — this package sits BELOW
both `packages/app` and `packages/graph-canvas` in the dependency graph). Unit-tested per
`UX-1100..1105` individually, plus a racer-scale sanity check against the real
`samples/r4-racer.glb` fixture (366 real `KHR_interactivity` graph nodes, one graph) asserting both
a correct reference count and a generous time budget (`UX-1113`) — measured well under a
millisecond on a dev machine; see the PR description for the exact figure.

`packages/app`'s `UsageSection.tsx` (Inspector, `UX-1106..1109`, `UX-1114`) and the reference-highlight wiring
(`UX-1110..1112`, `Viewport.tsx`/`SceneTree.tsx`) are documented in `specs/ux-shell.md`'s own
usage-mapping implementation note (that file, not this one, owns `packages/app/**`); the graph-
canvas-side additions (`focusRequest`, `NodeDetails`' "Reveal in viewport") are documented in
`specs/ux-graph-canvas.md`'s own usage-mapping implementation note; the `RenderHost` reference-
highlight tier the viewport wiring calls (`setReferenceHighlight`) is `RH-029`/`RH-030` in
`specs/render-host.md`.

`UX-1108`/`UX-1114`'s pointer-path fallback and disabled-state check share one primitive,
`findEnclosingHandlerRoot` (exported from `packages/usage-index`, not the Inspector or the Script
tab): a bounded backward walk over a graph node's own `flows` predecessors up to the nearest
`event/*` handler root, or `null` if none is reachable. `app-store.ts`'s `jumpUsageRefToScript` uses
it (via `history.document.json`, no `@gltfi/emit-ts` invocation needed) to attach an
`enclosingHandlerNodeIndex` hint to the durable `scriptNodeFocusRequest`; `UsageSection.tsx` uses
the exact same function directly against the row's own graph to decide `UX-1114`'s enabled/disabled
state — one derivation, not two independently-maintained copies of "is this node reachable," the
same convention `usage-index`'s own header comment already establishes for `graphNodeSceneRef`.
`packages/script-panel`'s `cross-highlight.ts` (`specs/ux-script.md`'s `UX-712` owns that package)
does the actual text search: `findHighlightForNode`'s `pointerPath`/`enclosingHandlerNodeIndex`
options, tried only once its ordinary `sourceNodeIds` lookup comes up empty.

## Open questions

- OPEN(UX-usage-animation-encoding-tbd): `UX-1102`'s "literal clip index" assumes
  `animation/start|stop|stopAt`'s `values.animation` literal encodes the target animation as a
  plain numeric index (the same convention `@gltf-studio/graph-canvas`'s `handleSetAnimationValue`
  already writes, and the same shape `variable/get`'s `configuration.variable`/`event/send`'s
  `configuration.event` use for their own referenced-collection indices) — this repo has no real
  asset exercising `animation/start` yet to confirm against (the `r4-racer.glb` racer-scale fixture
  `UX-1113` cites has none), so this is a documented assumption, not a verified fact, until a real
  asset using the op turns up.
- OPEN(UX-usage-reveal-flash-tbd): the approved mockup's "Reveal in viewport" additionally pulses a
  transient highlight flash (`flash-highlight-ref`) on top of framing the camera, since its mock
  renderer has no real camera to move. The real `RenderHost` DOES have one (`frameNode`,
  `specs/render-host.md`), so `UX-1111` uses that as the "reveal" instead of also adding a second,
  separate transient-pulse animation on top of the already-persistent reference outline (`UX-1110`)
  — a deliberate adaptation to a real capability the mockup didn't have, not an overlooked mockup
  detail. Whether a future pass still wants a brief pulse IN ADDITION to the camera move (e.g. for
  the case where the referenced node is already fully on-screen and framing alone is not obviously
  noticeable) is left open.
- OPEN(UX-usage-script-jump-animation-gap): `UX-1114`'s disabled-state check only covers
  `kind: "pointer"` rows. `animation/start|stop|stopAt` nodes (`UX-1102`) get no `sourceNodeIds`
  entry either (same `@gltfi/ir` "inlined statement, no identifier" shape as `pointer/set`), so
  their own "→ Script" jump is very likely just as unresolvable today as `pointer/*` rows were
  before this pass — but it's untested and unfixed here (no real asset in this repo's e2e fixtures
  currently exercises `animation/start`, per the open question above), and their button stays
  unconditionally enabled rather than checked. A future pass should either extend the pointer-path-
  style fallback to the animation index literal or add the same reachability check to `UX-1114`.
- OPEN(UX-usage-script-jump-multi-occurrence): `UX-1108`'s handler-context disambiguation
  (`findEnclosingHandlerRoot` + a textual brace-matching scan of the handler's own emitted function
  body, `cross-highlight.ts`) is a heuristic, not a proof: a pointer path set from two different
  places INSIDE the same handler (not just two different handlers) is still ambiguous by text alone
  and resolves to whichever occurrence the scan finds first inside that handler's body. Considered
  and rejected as out of scope for this pass: teaching `@gltfi/ir`'s `importGraph` to stamp a
  `sourceNodeIds`-style origin onto every statement (not just the four kinds it tracks today) would
  remove the need for text search entirely, but touches a vendored package this repo does not
  maintain (`vendor/gltfi-ir-*.tgz`, `scripts/refresh-vendor.mjs`) and was judged not worth
  requesting for a same-tier disambiguation nicety.
