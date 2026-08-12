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
- [UX-1108] (active) "→ Script" switches the bottom dock to the Script tab, switches to the reference's own graph when it differs from the one currently shown, and selects that graph node — the same selection state `specs/ux-script.md`'s `UX-712` cross-highlight reacts to for a `handler`/`proc`/`stateSlot`-kind node. It ALSO issues a durable, queued focus request (`UX-1114`) rather than relying purely on that selection state, because the Script tab is `React.lazy`-mounted on first open with its own inner Monaco dynamic import (`specs/ux-script.md`'s `UX-707`) — a request fired before either exists must still be honored once they are, not silently dropped. For a `kind: "pointer"` reference (`pointer/set`/`pointer/interpolate`, `UX-1100`) the request additionally carries the row's own literal pointer path text as an explicit fallback: `@gltfi/ir`'s `importGraph` gives these ops no `handler`/`proc`/`stateSlot`/`temp` identifier at all (they're inlined directly as an `rt.ptrSet(...)`/`rt.ptrInterp(...)` statement), so `UX-712`'s plain identifier-table lookup can never resolve them on its own — the pointer path is the one thing that DOES survive verbatim into the emitted text (`@gltfi/emit-ts` emits it via `JSON.stringify`), so the Script tab searches for that exact quoted string instead. When the same literal pointer path is set from more than one place in the same graph, the jump prefers the occurrence inside the handler this specific reference's own flow traces back to (a cheap backward flow-predecessor walk, `findEnclosingHandlerRoot`) and otherwise falls back to the first occurrence in the emitted document — a best-effort disambiguation, not a proof of correctness in a genuinely multi-writer graph. Refined per a follow-up bug report: once resolved, the jump lands via `specs/ux-script.md`'s `UX-715` — focusing the editor, placing the caret at the resolved range's start, and painting a PERSISTENT amber decoration independent of the editor's focus state — rather than relying on Monaco's own selection rendering alone, which the report found renders near-invisibly (`inactiveSelectionBackground`) the instant the editor lacks real focus, exactly the state a jump arriving from this Inspector button starts in. `UX-715`, not this requirement, owns the decoration's exact visual/persistence/clear semantics, since the same mechanism also serves `UX-712`'s plain canvas-selection cross-highlight.
- [UX-1109] (active) A selected node with zero usage-index references shows "Not referenced in behavior" plus an "Attach behavior…" control. Choosing it opens a small menu with: "✦ Ask Copilot about this node" (real — switches the right panel to Copilot and attaches an explicit context chip naming the node, the same inline-affordance contract `specs/ux-copilot.md`'s `UX-1008`/`UX-1009` already establish elsewhere), plus Phase-2 entries (e.g. "Add pointer/set to graph") that are present but not yet wired to a real command — choosing one shows a toast explaining it arrives in a later phase, the same honest-stub convention `specs/ux-scene-tree.md`'s `UX-206` add-menu already established (a real, clickable, visually de-emphasized button — never a silently inert control).
- [UX-1114] (active) A `kind: "pointer"` row's "→ Script" button is disabled with an explanatory tooltip, rather than a click that switches tabs and visibly highlights nothing, when its graph node is unreachable from any `event/*` handler (`findEnclosingHandlerRoot` returns none) — such a node is dead in the graph (`@gltfi/ir`'s `importGraph` never visits/emits an unreachable node), so `UX-1108`'s pointer-path fallback is GUARANTEED to find nothing for it, not merely likely to. "→ Graph" on the same row is unaffected (it needs only the node's existence, never an emitted identifier) and stays enabled. `event-handler`/`animation`-kind rows are not covered by this disabled-state check (tracked as a gap below, not silently assumed fine).

### Two-tier highlight vocabulary

- [UX-1110] (active) Selecting a behavior-graph node whose op resolves a scene-node reference (`UX-1100`/`UX-1101`/`UX-1103` — never `UX-1102`'s multi-target animation family, which has no single node to highlight) drives a SECOND, amber "reference" highlight on that scene node, shown in both the scene tree row and the viewport, fully independent of and able to coexist with the (blue) selection highlight — the same node, a different node, or no node may be selected at the same time a reference highlight is showing. Where both highlights land on the same scene-tree row, the row shows the selection (blue) treatment, per the approved mockup's own coexistence rule.
- [UX-1111] (active) Whenever a selected behavior-graph node carries a reference (`UX-1110`), its details card additionally shows a "Reveal in viewport" control that frames the viewport camera on the referenced scene node and confirms via a toast; because the reference highlight itself is already visible for as long as that details card stays open, this control's own job is camera framing, not the highlight.
- [UX-1112] (active) The reference highlight (`UX-1110`) is ephemeral UI state (never written to the document JSON or the project sidecar) that clears whenever the driving graph-node selection is cleared or no longer resolves a reference — deselecting the graph node (clicking empty canvas), selecting a different graph node with no reference, switching to a different behavior graph, or the document changing out from under it all clear it with no separate "close" gesture required; selecting a *different scene node* (tree row or viewport click) does NOT clear it — only the graph-node selection that's driving it does.

### Performance

- [UX-1113] (active) Usage-index derivation is fast enough not to visibly stall the Inspector on a real, non-trivial document (e.g. a several-hundred-node single-graph asset) and is memoized on the document JSON's own identity — the same identity-based memoization convention `@gltf-studio/graph-canvas`'s `mapGraph`/`buildPointerContentTree` already use — so it never recomputes on an unrelated selection change, only on an actual document edit.

### Asset-entity usage index (Phase 2)

- [UX-1115] (active) A `pointer/get|set|interpolate` node whose `configuration.pointer` (by the same literal/template-parameter resolution rule as `UX-1100`) resolves to a path beginning `/materials/{M}` or `/meshes/{M}` is attributed to material/mesh `M` respectively — a SEPARATE index (`buildAssetUsageIndex`, keyed by material/mesh index) from `UX-1100`'s scene-node map, never a new entry in it (materials/meshes are not scene nodes). An `animation/start|stop|stopAt` node whose `animation` value is a literal clip index is ADDITIONALLY attributed directly to that clip index itself in this same asset-entity index — unlike `UX-1102`'s scene-node fan-out (every node the clip's channels target), there is exactly one clip being referenced, so no fan-out is needed here. `event/onSelect|onHoverIn|onHoverOut` (`UX-1101`) never appears in this index (a `nodeIndex` config can only ever address a scene node). Same `UX-1105` "omit an out-of-range/unresolvable reference, never guess" policy, applied against `json.materials`/`json.meshes`'s own bounds.
- [UX-1116] (active) A scene-tree row or asset-browser row (meshes/materials/animations) with 1+ references in the relevant index (`UX-1100..1105`'s scene-node map for a scene-tree row; `UX-1115`'s asset-entity index for an asset-browser row) shows a small "⚡" badge with a tooltip reading "N reference"/"N references". Clicking a scene-tree row's badge selects that scene node and flashes/scrolls the Inspector's "Used in behavior" section (`UX-1106`) into view — the section is already there once the node is selected, so this is a discoverability affordance, not a new view. Clicking an asset-browser row's badge — a material/mesh/animation has no Inspector section of its own (unlike a scene node) — jumps to its FIRST reference in the Behavior graph instead, reusing `UX-1107`'s "→ Graph" jump verbatim (a documented, deliberate simplification for a row with more than one reference, not a promise of "the most relevant one").
- [UX-1117] (active) A single view toggle (mirroring `specs/ux-scene-tree.md`'s existing "show indices" toggle in placement and session-only persistence) shows/hides every `UX-1116` badge across BOTH the scene tree and the asset browser at once — one app-wide setting, not a toggle per panel, the same relationship `showIndices` already has to both panels. Defaults to ON (unlike `showIndices`, which defaults off) — the badge is meant to be discovered, not opted into.

### Live "Attach behavior…" menu (Phase 2)

- [UX-1118] (active) Supersedes `UX-1109`'s Phase-2 stub entries: a zero-reference node's "Attach behavior…" menu's `event/onSelect`-prefixed entries now create real content, each as ONE undoable command wiring a fresh `event/onSelect` node (`configuration.nodeIndex` set to the selected scene node) by a single flow edge into a fresh effect node, landing in and focusing the Behavior graph (reusing `UX-1107`'s own selection/focus mechanism) — never two separate history entries for what the user experiences as one action:
  - "On select → Set property…"/"On select → Interpolate…" add a `pointer/set`/`pointer/interpolate` node defaulting to the selected node's own `/translation` (the same universal per-node default `specs/ux-graph-canvas.md`'s scene-tree-drop menu already uses for a fresh pointer node), then immediately opens the pointer picker (`specs/ux-pointer-picker.md`) preset to that node so the placeholder path can be retargeted right away — the picker can only ever retarget an ALREADY-EXISTING node, which is exactly why the node is created with a placeholder path first rather than the picker creating it directly.
  - "On select → Play sound" is offered only when the selected node's own `extensions.KHR_audio_emitter.emitter` is set (never for a node with no emitter) — it adds a `pointer/set` targeting that emitter's first `sources[]` entry's `/extensions/KHR_audio_emitter/sources/{S}/playing` one-shot trigger pointer (`specs/engine-api.md`'s `AH-pointer-value-tbd` resolution). Its own boolean literal is left unset, same as any other freshly-added pointer node (`UX-1109`'s pre-Phase-2 "Add pointer/set to graph" precedent) — wiring `true` is a graph-canvas edit like any other.
  - "On select → Play animation ▸" expands a submenu (one entry per `json.animations[]`, the same submenu-as-one-menu-entry convention `specs/ux-scene-tree.md`'s "Mesh ▸" add-menu item already established) and, on a choice, adds an `animation/start` node with a `ref`-typed `values.animation` literal naming that clip (the same encoding `UX-1102`/`graph-canvas`'s `handleSetAnimationValue` already use).
  "✦ Ask Copilot about this node" (already real since Phase 1) is unchanged.

### Script-tab pointer-path links (Phase 2)

- [UX-1119] (active) In the Script tab, every quoted pointer-path string literal the emitted code contains for a family this index resolves (`/nodes/*`, `/materials/*`, `/meshes/*`, `/animations/*`, `/extensions/KHR_audio_emitter/{emitters,sources}/*`) is a clickable Monaco link — the reverse direction of `UX-1108`'s Inspector → Script jump, making the two bidirectional inside the Script tab. Clicking one resolves the path back to the ONE `pointer/get|set|interpolate` graph node whose own literal `configuration.pointer` equals it (a plain first-match scan over the current graph — the same kind of best-effort, undisambiguated-beyond-that heuristic `OPEN(UX-usage-script-jump-multi-occurrence)` already accepts for the opposite direction, not a new correctness gap), then:
  - selects that graph node, driving `UX-1110`'s amber reference highlight whenever it resolves a scene-node reference (`UX-1100`/`UX-1103`), and, whenever it does, ALSO selects that scene node outright (the ordinary blue selection + Inspector) — the click reads as "take me there," not merely a highlight;
  - for a `/materials/{M}`/`/meshes/{M}` path (no scene node to select, `UX-1115`), selects the corresponding Asset Browser row instead.
  Never switches the active dock tab — staying inside the Script tab while the tree/viewport/inspector/asset-browser update around it is the whole point (unlike `UX-1107`/`UX-1108`, which are deliberate tab-switching jumps).

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

`packages/app`'s `UsageSection.tsx` (Inspector, `UX-1106..1109`, `UX-1114`, `UX-1118`) and the reference-highlight wiring
(`UX-1110..1112`, `Viewport.tsx`/`SceneTree.tsx`) plus the `UX-1116`/`UX-1117` badges (`SceneTree.tsx`/
`AssetBrowser.tsx`) are documented in `specs/ux-shell.md`'s own
usage-mapping implementation note (that file, not this one, owns `packages/app/**`); the graph-
canvas-side additions (`focusRequest`, `NodeDetails`' "Reveal in viewport") are documented in
`specs/ux-graph-canvas.md`'s own usage-mapping implementation note; the `RenderHost` reference-
highlight tier the viewport wiring calls (`setReferenceHighlight`) is `RH-029`/`RH-030` in
`specs/render-host.md`; `UX-1119`'s Monaco link provider/command registration is documented in
`specs/ux-script.md`'s own usage-mapping implementation note (that file owns `packages/script-panel/**`).

`buildAssetUsageIndex` (`UX-1115`) sits in the same `usage-index.ts` module as `buildUsageIndex`,
sharing every helper (`resolveConcretePointer`, `literalValueNumber`, `usageRefPathText`) rather than
duplicating the pointer-template/literal-vs-value-ref resolution logic a second time — the two
functions differ only in WHICH map a resolved reference lands in (scene-node index vs
material/mesh/animation index), never in how a reference is resolved. `findGraphNodeIndexForPointer`
(`UX-1119`) is the new reverse primitive: given a literal pointer-path string, the first
`pointer/get|set|interpolate` node in a graph whose own `configuration.pointer` equals it exactly, or
`null`. All three are covered by the same racer-scale sanity test `UX-1113`'s pre-existing one lives
next to — `buildAssetUsageIndex` against the real `r4-racer.glb` fixture asserts a nonzero material-
reference count (most of that racer's 40 `pointer/set` nodes target `/materials/*`, previously
entirely outside this package's scope per `UX-1105`), confirming the new asset-entity family is
exercised at real scale, not merely a synthetic unit fixture.

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

`UX-1108`'s refinement (visible, persistent decoration rather than relying on Monaco's own
focus-dependent selection rendering) is entirely `specs/ux-script.md`'s `UX-715` — nothing in
`app-store.ts`'s `jumpUsageRefToScript`/`requestScriptNodeFocus` changed for it, since the fix lives
wholly inside how `script-panel.tsx` APPLIES a `scriptNodeFocusRequest` it already receives, not in
how that request is constructed or dispatched.

## Open questions

- RESOLVED(UX-usage-animation-encoding-tbd) (by Usage Mapping Phase 2, `UX-1115`/`UX-1118`):
  `UX-1102`'s "literal clip index" assumption (`animation/start|stop|stopAt`'s `values.animation`
  literal encodes the target animation as a plain numeric index, the same convention
  `@gltf-studio/graph-canvas`'s `handleSetAnimationValue` already writes) is now exercised against a
  real, complete, engine-loadable glTF asset for the first time: `e2e/usage-mapping-p2-fixture.ts`'s
  "Spin" animation clip (a real 2-keyframe rotation channel with real accessors/bufferViews/buffer
  bytes, not a bare JSON stub) plus a real `animation/start` graph node naming it by plain index —
  both `buildAssetUsageIndex`'s unit coverage and `e2e/usage-mapping-p2.spec.ts`'s end-to-end Animations-
  tab badge/jump test confirm the assumed encoding round-trips correctly through the real app.
  `UX-1118`'s "On select → Play animation…" attach flow ALSO now writes this exact same encoding when
  creating a fresh `animation/start` node, so this convention is exercised from both the read side
  (indexing) and the write side (attach) as of this pass. `r4-racer.glb` (`UX-1113`'s own racer-scale
  fixture) still has no `animation/start` usage of its own — this resolution rests on a hand-authored-
  but-real fixture asset, not a naturally-encountered production one, which is exactly what this open
  question asked for ("a real asset using the op"), not a stronger "found in the wild" claim.
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
  before this pass — still untested and unfixed here, and their button stays unconditionally enabled
  rather than checked. Usage Mapping Phase 2 does now give this repo a real `animation/start`-
  exercising e2e fixture (`RESOLVED(UX-usage-animation-encoding-tbd)` above), so this gap is no
  longer blocked on "no asset to test it against" the way it was — it remains open purely because
  fixing it (extending the pointer-path-style fallback, or the same reachability check, to the
  animation index literal) was judged out of scope for this pass, which deliberately left its own
  new fixture's `animation/start` node unreachable from any handler (see that fixture's own header
  comment) rather than incidentally papering over this exact gap by accident.
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
- OPEN(UX-usage-p2-gaps-tbd): three honest simplifications from this Phase-2 pass, each real but
  narrow enough not to block it:
  - `UX-1118`'s "On select → Play sound" gating (only offered when the node has an emitter) is
    e2e-tested for the POSITIVE case (`e2e/usage-mapping-p2.spec.ts`) but not the negative one (the
    menu item is absent for a node with no emitter) — that fixture's own zero-ref node happens to
    carry an emitter for the positive test's sake, and no second zero-ref-AND-emitterless node was
    added to also cover the negative case.
  - `UX-1119`'s Monaco link click is exercised via `GltfStudioScriptTestHook.clickPointerLink` (a new
    test seam invoking the exact same `onPointerLinkClick` handler the real "command:" URI click
    does) rather than a real pixel/DOM click through Monaco's own link-widget rendering (hover/
    modifier-key gated, thin, and inconsistent enough across platforms that this repo's own
    established precedent — `GltfStudioScriptTestHook.setValue`/`GraphCanvasTestHook.simulateConnect`
    — already avoids exactly this kind of interaction elsewhere). The link's on-screen
    presence/styling itself is unverified by any test.
  - `UX-1116`'s asset-browser badge click ("jumps to its first reference") has no test asserting
    behavior when an asset has 2+ references and a specific (non-first) one would arguably be more
    relevant — only ever exercised here against single-reference rows.
