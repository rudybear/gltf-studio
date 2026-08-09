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
- [UX-701] (active) In this freeze's scope, the Script tab is a read-only rendering of the graph's emitted code, not an editable text-buffer surface; graph changes are made in the Behavior graph tab. (See the open question below on whether/when a real editable script surface arrives.)

### Apply → Graph

- [UX-702] (active) An "Apply → Graph" toolbar action re-derives the behavior graph from the current script content and clears any `DIVERGED` state back to `EQUIV`.

### EQUIV / DIVERGED badge

- [UX-703] (active) The toolbar shows exactly one of two badge states at all times: `EQUIV ✓` (the script and the graph agree) or `DIVERGED ⚠` (the script has been changed independently of the graph and no longer matches it). This badge surfaces the result of `@gltfi`'s equivalence-verification tooling (`EQUIV`, referenced by `AG-007`) — the UI displays that result, it does not reimplement the equivalence check itself.
- [UX-704] (active) While `DIVERGED`, the specific script line(s) whose logic no longer matches the graph are visually marked distinctly from the rest of the code — divergence is never communicated by the badge alone.

### Provenance and toolbar scope

- [UX-705] (active) The emitted code opens with a leading comment naming which graph it was generated from (e.g. `// Prop_01 behavior — generated from graph "Default"`), so the view is never ambiguous about its source when more than one graph exists.
- [UX-706] (active) The Script tab's toolbar is limited, in v1, to the Apply → Graph action (`UX-702`) and the EQUIV/DIVERGED badge (`UX-703`) — no save/export/format-code affordance is part of this tab's scope this freeze.

## Open questions

- OPEN(UX-script-sugar-tbd): **the approved mockup renders script lines using an aspirational
  `N.<name>.<prop>` property-access sugar** (e.g. `N.Prop_01.translation = add(N.Prop_01.translation,
  [0, 0.25, 0])`) purely for on-screen readability. **The real GIscript language (see `@gltfi`)
  uses `rt.ptrSet(...)`/`V.*`-style runtime-call syntax, not this sugar.** v1 ships **real GIscript
  syntax** in this tab; the sugar is, at most, a candidate for a later readability pass — it is
  explicitly **not** an adopted decision. This is called out here in full so nobody implements the
  sugar from the mockup screenshot alone.
- OPEN(UX-script-editable-tbd): whether a future round makes this tab a real editable script
  surface (with the graph regenerated from source edits, the reverse of `UX-702`) is out of this
  freeze's scope; `UX-701` pins down only what v1 ships.
- OPEN(UX-script-diverge-sim-tbd): the approved mockup's "Simulate divergence" toolbar control is
  a demo/test hook standing in for "the script was edited independently" (there being no real
  editable surface yet, `UX-701`) — it is not itself a v1 user-facing affordance, and this freeze
  does not specify one.
