# ux-script

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the bottom dock's Script tab (`.script-toolbar`, `#script-code`). Specifies
the emitted-code view, the Apply → Graph action, and the EQUIV/DIVERGED badge — the visible half of
`docs/ux/ux-brief.md`'s "graph ⇄ script loop".

**Read the "GIscript syntax" open question below before implementing anything from this file** —
the approved mockup's on-screen code is not the real target language.

Owns (`specs/ownership.json`): once scaffolded, `packages/script-panel/**`.

Prefix: `UX`. This file owns the `UX-7xx` block.

## Requirements

### Emit view

- [UX-700] (active) The Script tab renders the current behavior graph's generated code, read-only, with syntax highlighting that visually distinguishes keywords, function calls, string literals, number literals, and comments from each other.
- [UX-701] (retired) Superseded by UX-707 (M5): the freeze-time pin of the Script tab to a permanently read-only rendering, with graph changes made only in the Behavior graph tab, no longer holds — M5 resolves OPEN(UX-script-editable-tbd) in favor of shipping a real editable surface.

### Apply → Graph

- [UX-702] (active) An "Apply → Graph" toolbar action re-derives the behavior graph from the current script content and clears any `DIVERGED` state back to `EQUIV`.

### EQUIV / DIVERGED badge

- [UX-703] (active) The toolbar shows exactly one of two badge states at all times: `EQUIV ✓` (the script and the graph agree) or `DIVERGED ⚠` (the script has been changed independently of the graph and no longer matches it). This badge surfaces the result of `@gltfi`'s equivalence-verification tooling (`EQUIV`, referenced by `AG-007`) — the UI displays that result, it does not reimplement the equivalence check itself.
- [UX-704] (retired) Superseded by UX-713 (M5): per-line divergence marking turns out to have been tied to the approved mockup's own canned demo data (`mockup-v5.html`'s `SCRIPT_LINES` hand-flags exactly one line `diverge: true`) — the real toolchain's divergence signal (`@gltfi/verify`'s `equivalentGraphs`/`compareDeclarations`) reports structural differences, not source-text positions, so there is no real per-line location to mark honestly.

### Provenance and toolbar scope

- [UX-705] (active) The emitted code opens with a leading comment naming which graph it was generated from (e.g. `// Prop_01 behavior — generated from graph "Default"`), so the view is never ambiguous about its source when more than one graph exists.
- [UX-706] (retired) Superseded by UX-708 (M5): the freeze-time toolbar (Apply → Graph + badge only) grows one more control, the Edit/view-mode toggle (UX-707).

### Editable surface (M5)

- [UX-707] (active) Resolves OPEN(UX-script-editable-tbd) in favor of shipping a real editable surface in v1: the Script tab is a Monaco-based code editor (TypeScript language mode, with `@gltfi/parse-ts`'s `RUNTIME_LIB_DTS` ambient module registered so `rt.`/`m.`/`V.`-style completions work) that opens in the read-only Emit view (UX-700) by default and switches to an editable buffer only via an explicit "Edit" toolbar action — supersedes UX-701's permanent-read-only pin.
- [UX-708] (active) Supersedes UX-706: the Script tab's toolbar is limited, in v1, to exactly three controls — the Edit/view-mode toggle (UX-707), the Apply → Graph action (UX-702), and the EQUIV/DIVERGED badge (UX-703) — still no save/export/format-code affordance.
- [UX-709] (active) While the buffer is in edit mode, every content change is parsed off the UI thread (a Worker wrapping `@gltfi/parse-ts`'s `parseModule`), debounced (~300ms of no further keystrokes) and staleness-guarded (a parse started before a newer edit never overwrites that newer edit's result); a failing parse's diagnostics are shown both as gutter/inline markers at their reported location and as lines in the Console tab (reusing the same console surface `specs/ux-shell.md` already gives every other diagnostic source).
- [UX-710] (active) Resolves OPEN(UX-script-diverge-sim-tbd) in favor of real detection, retiring the approved mockup's "Simulate divergence" stand-in control (never adopted as a v1 affordance): on every clean parse, the parsed script is exported back to a graph (`@gltfi/ir`'s `exportGraph`) and compared against the document's current graph via `@gltfi/verify`'s `equivalentGraphs` (UX-703's own citation of `AG-007`) — that comparison, not any manual toggle, is what drives EQUIV/DIVERGED while editing. A currently-failing parse (UX-709) leaves the badge at its last-known state rather than flipping it, since there is no new graph to compare yet.
- [UX-711] (active) The Apply → Graph action (UX-702) is enabled only when the most recent parse is clean (UX-709); activating it replaces the document's graph with the freshly exported one via `editor-core`'s `GraphEdit.replaceGraph` (`DOC-043`) as a single history-stack entry labeled "Apply script", after which the badge re-evaluates to EQUIV and the Emit-view content regenerates from the (now-authoritative) graph.
- [UX-712] (active) Selecting a graph node on the Behavior graph canvas, when the Script tab can determine a corresponding emitted identifier for that node (via `@gltfi/emit-ts`'s returned `names` and the IR module's own source-node bookkeeping), scrolls to and highlights that identifier's text occurrence in the Script tab's buffer per UX-715's exact jump/decoration mechanics. This mapping is identifier-level (a name-based text search), not a source-range-accurate cross-reference — nodes with no determinable corresponding identifier (e.g. fully inlined/constant-folded away, or contributing only to a nested temporary) silently produce no highlight rather than a wrong one.
- [UX-713] (active) Supersedes UX-704: while `DIVERGED`, the badge (UX-703) carries a tooltip summarizing `@gltfi/verify`'s `compareDeclarations` output (the list of structural differences between the document graph and the edited script's exported graph) — this is the tab's honest ceiling for "divergence is never communicated by the badge alone" given the real toolchain reports structural differences, not source-text positions; no per-line marking is implemented (see UX-704's retirement note for why one wouldn't be genuine).

### No-graph empty state

- [UX-714] (active) Found and fixed alongside a follow-up bug report (`specs/ux-shell.md`'s M5
  implementation note documents the sibling Monaco-sizing bug this was found auditing for): when the
  current document has no `KHR_interactivity` graph at `graphIndex` at all (never-added, or a
  document with zero graphs), the Script tab shows a plain, honest empty-state message ("No behavior
  graph in this asset — add nodes from the graph palette or ask Copilot") in place of the toolbar and
  editor, rather than a live (if mostly blank) Monaco buffer holding only a placeholder comment —
  the previous behavior was, in effect, a real read-only code editor whose one line of "content" was
  itself just a stand-in message, which is the same category of dishonesty a genuinely-collapsed
  (0-height) editor is. This is UX-700/UX-707's necessary precondition, not a new mode: every other
  UX-7xx requirement in this file continues to assume a graph is present.

### Persistent, focus-independent jump highlighting

- [UX-715] (active) Found and fixed alongside a follow-up bug report on `specs/ux-usage-mapping.md`'s
  `UX-1108` (the Inspector's "→ Script" jump): a jump landing per UX-712/UX-1108 is, in addition to
  scrolling/highlighting, REQUIRED to be something a user can actually SEE regardless of where
  keyboard focus already was — the original implementation only ever set Monaco's own native
  selection, which renders via the editor's much fainter `inactiveSelectionBackground` the instant
  the editor lacks real DOM focus (exactly the state a jump ARRIVING from a button outside the
  editor, e.g. the Inspector's "→ Script", starts in), so the fix that shipped it passed its own
  e2e coverage (an API-level `getSelectedText()` read) while a real user saw nothing change on
  screen. A landed jump now does all of the following as one unit:
  1. `revealRangeInCenter`s the matched range and calls `editor.focus()` — the editor actually
     receives real keyboard focus, not just a selection object nobody is looking at.
  2. Sets Monaco's native selection to the full matched range, with the caret ("position") at the
     range's START rather than Monaco's own default (the range's end) — an explicit, deliberate
     choice (not left to whichever end `setSelection` happens to default to) — while still selecting
     the whole range, so `getSelectedText()`-style API assertions keep seeing the full matched text.
  3. Paints a PERSISTENT decoration distinct from that native selection: an exact-range inline
     treatment plus a whole-line background tint and a gutter-bar marker, all in the same amber
     `--warn`/`--ref-soft` reference-color pair `specs/ux-usage-mapping.md`'s `UX-1110` scene-
     tree/viewport reference highlight already uses (one consistent "this is what behavior
     referenced" visual language app-wide) — styled independently of Monaco's own theme/focus state,
     so it looks the same whether or not the editor currently has focus, which is the actual fix for
     this bug report's root cause.
  The decoration (and the selection alongside it) persist across the Script tab's own debounced
  emit-view regeneration (UX-700's "regenerated whenever the document's graph changes"): on every
  regeneration, the SAME jump target is RE-RESOLVED against the freshly emitted text and the
  decoration/selection move to wherever it now resolves — without re-revealing the viewport or
  re-focusing the editor a second time (a regen is not a new jump; only steps 1-3 above, triggered by
  an actual new selection/request, ever steal focus or scroll) — or clear outright if the target no
  longer resolves at all (e.g. its graph node was deleted), since a decoration pointing at
  unrelated/wrong text would be worse than none. The highlight clears entirely (decoration removed,
  selection collapsed to a plain caret) on any of: a NEW jump superseding it; a genuine edit to the
  buffer's content (not this component's own programmatic regeneration); a click or keyboard-driven
  cursor move elsewhere in the buffer; or, with no further interaction at all, exactly 5 seconds after
  it last landed — an INSTANTANEOUS clear at that mark, not an animated fade (a deliberate
  simplification; see the open question below).

## Implementation notes

- Usage mapping (`specs/ux-usage-mapping.md` `UX-1108`/`UX-1114`): the Inspector's "Used in
  behavior" → Script row action originally reused `UX-712`'s existing `selectedGraphNodeIndex`-
  driven cross-highlight as-is with no change to this package's own logic — that held for
  `handler`/`proc`/`stateSlot`-kind nodes, but a bug report found it silently produced no highlight
  at all for a `pointer/set`/`pointer/interpolate` row (`UX-1100`'s most common usage-index family),
  since those ops get no `sourceNodeIds` identifier from `@gltfi/ir` in the first place. Two real
  changes to this package followed:
  - `cross-highlight.ts`'s `findHighlightForNode` gained an options bag (`pointerPath`,
    `enclosingHandlerNodeIndex`): once its ordinary `sourceNodeIds` lookup resolves nothing, it
    falls back to searching the emitted code for the literal pointer path text as a plain quoted
    string (`@gltfi/emit-ts` emits it via `JSON.stringify`, verbatim) — disambiguating multiple
    identical-path occurrences via the hinted handler's own textual function-body range (a
    brace-matching scan that is string-literal-aware, since an unresolved `{name}` ref-kind
    pointer-template placeholder can itself embed brace characters inside its own quoted text) when
    given, else the first occurrence. `UX-712`'s OWN requirement text/behavior (a plain canvas-click
    selection, no pointer-path text available to fall back to) is unchanged by this.
  - `script-panel.tsx` gained a `focusRequest` prop (`app-store.ts`'s `scriptNodeFocusRequest`, see
    `specs/ux-shell.md`'s M9 note) and a dedicated effect applying it once THIS component is
    actually ready (Monaco mounted, emit view current for the request's own graph) — the Script tab
    is `React.lazy`-mounted on the dock's first open (`UX-707`) with its own further inner Monaco
    dynamic import, so a request fired before either exists needs to survive until they do, rather
    than trusting effect-ordering timing alone to make selection-effect closures see fresh state.
  `window.__gltfStudioScriptTest` (`GltfStudioScriptTestHook`) gains `getSelectedText()`, reading
  the Monaco editor's current selection back out, so an e2e test can assert a cross-highlight
  (either `UX-712`'s or `UX-1108`'s fallback) actually selected the expected text rather than merely
  that some selection changed.

- UX-715 (the persistent, focus-independent jump decoration): `script-panel.tsx`'s `applyJumpHighlight`
  is the ONE place a jump actually lands — both the plain `UX-712` canvas-selection effect and the
  `UX-1108` `focusRequest` effect call it (rather than each hand-rolling their own
  reveal/select/decorate), so the two flows can never drift into different visual behavior. It calls
  `setJumpSelection` (reveal + native selection with the caret-at-start `Selection` construction
  UX-715 describes), `editor.focus()`, then replaces the decoration collection
  (`editor.createDecorationsCollection`, `buildJumpDecorations` — the exact-range + whole-line +
  gutter-bar triple, styled via `script-panel.css`'s `.gi-jump-highlight-range` /
  `-line` / `-gutter` classes) and (re)arms a plain `setTimeout(JUMP_HIGHLIGHT_FADE_MS)` that calls
  the shared `clearJumpHighlight` teardown.
  - Surviving a regen: a separate effect (deps `[code, currentModule, names]`, distinct from the
    jump-triggering effects above so an UNRELATED regen never re-reveals/re-focuses) re-runs
    `findHighlightForNode` against the freshly emitted `code` for whatever `lastHighlightTargetRef`
    currently holds, and either repaints the decoration + calls `setJumpSelection` again (selection
    only — no `revealRangeInCenter`/`focus()` on this path) at the newly-resolved location, or calls
    `clearJumpHighlight` if the target no longer resolves at all.
  - Clear triggers: the shared `contentSub`/`cursorSub` listeners (Monaco-mount effect) implement
    "clears on user edit"/"clears on click-elsewhere" respectively — both need to tell a GENUINE
    user-driven event apart from an event this component's OWN code just caused as a side effect of
    the regen path above (a full `editor.setValue()` triggers both a content-changed AND an
    incidental cursor-reset-to-1,1 notification as side effects, and `setJumpSelection`'s own
    deliberate reselection right after that triggers a further cursor event). Two single-purpose
    refs cover this, not one shared flag doing double duty (a real bug found and fixed during this
    same pass, see below): `isProgrammaticContentSetRef` — armed before `editor.setValue(code)`,
    reset via a DEFERRED `queueMicrotask` rather than synchronously right after that call (Monaco's
    relative firing order between its content-changed and cursor-changed notifications for one
    `setValue`, and whether either is even synchronous within that call's own stack frame, are not
    documented guarantees this code can rely on — an earlier synchronous-reset attempt raced one or
    the other listener and lost often enough to silently wipe a just-regenerated highlight); and
    `expectedSelectionRef` — a genuinely one-shot "the IMMEDIATELY NEXT cursor event is this
    component's own echo of a `setJumpSelection` call, not a click" arm, consumed (nulled)
    unconditionally on the very next `onDidChangeCursorSelection` regardless of whether it actually
    matched (an earlier version left it un-consumed on a non-match, which — combined with checking it
    for "is a highlight even active" instead of `lastHighlightTargetRef` — silently disabled
    click-elsewhere detection entirely after the first jump).
  - `GltfStudioScriptTestHook` gains `getJumpHighlightLineNumber()` (the active decoration's own
    tracked range, read back via `IEditorDecorationsCollection.getRanges()`, or `null` when none is
    active) and `getLineScreenRect(lineNumber)` (that line's current on-screen CSS-pixel rectangle,
    via `editor.getScrolledVisiblePosition` + the editor DOM node's own `getBoundingClientRect`) —
    together these let an e2e test turn "a decoration is active on line N" into the same kind of real
    composited-pixel screenshot assertion `e2e/visual-assert.ts` already established elsewhere,
    rather than only ever re-checking `getSelectedText()` (an API-level read that, per this bug
    report's own root cause, can pass while a real screen shows nothing different at all).

## Open questions

- OPEN(UX-script-sugar-tbd): **the approved mockup renders script lines using an aspirational
  `N.<name>.<prop>` property-access sugar** (e.g. `N.Prop_01.translation = add(N.Prop_01.translation,
  [0, 0.25, 0])`) purely for on-screen readability. **The real GIscript language (see `@gltfi`)
  uses `rt.ptrSet(...)`/`V.*`-style runtime-call syntax, not this sugar.** v1 ships **real GIscript
  syntax** in this tab; the sugar is, at most, a candidate for a later readability pass — it is
  explicitly **not** an adopted decision. This is called out here in full so nobody implements the
  sugar from the mockup screenshot alone.

Both other open questions this file originally carried — whether a future round makes this tab a
real editable surface, and whether the mockup's "Simulate divergence" stand-in ever becomes a real
affordance — are resolved as of M5: see UX-707 and UX-710 respectively.

- OPEN(UX-script-jump-fade-tbd): `UX-715`'s ~5s auto-clear removes the jump decoration
  instantaneously at that mark rather than animating an actual fade-out — the same pragmatic call
  `specs/ux-usage-mapping.md`'s own `OPEN(UX-usage-reveal-flash-tbd)` made for a different highlight
  (ship the real, honest behavior now; a genuine CSS opacity transition is a candidate polish pass,
  not a claimed feature). Whether a future pass wants a real fade (and whether that's worth Monaco
  decoration re-application mid-transition, since decorations are plain DOM elements a CSS
  transition COULD target) is left open.
