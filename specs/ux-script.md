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
- [UX-712] (active) Selecting a graph node on the Behavior graph canvas, when the Script tab can determine a corresponding emitted identifier for that node (via `@gltfi/emit-ts`'s returned `names` and the IR module's own source-node bookkeeping), scrolls to and highlights that identifier's text occurrence in the Script tab's buffer. This mapping is identifier-level (a name-based text search), not a source-range-accurate cross-reference — nodes with no determinable corresponding identifier (e.g. fully inlined/constant-folded away, or contributing only to a nested temporary) silently produce no highlight rather than a wrong one.
- [UX-713] (active) Supersedes UX-704: while `DIVERGED`, the badge (UX-703) carries a tooltip summarizing `@gltfi/verify`'s `compareDeclarations` output (the list of structural differences between the document graph and the edited script's exported graph) — this is the tab's honest ceiling for "divergence is never communicated by the badge alone" given the real toolchain reports structural differences, not source-text positions; no per-line marking is implemented (see UX-704's retirement note for why one wouldn't be genuine).

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
