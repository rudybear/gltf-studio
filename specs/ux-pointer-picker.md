# ux-pointer-picker

Mockup snapshot: `docs/ux/mockups/mockup-v5.html` (approved at UX freeze U4 — see
`docs/ux/README.md`), the modal pointer-picker dialog (`#pointer-picker-overlay`). Specifies the
dialog every `✎` pointer-config affordance opens (from the Inspector, `specs/ux-inspector.md`'s
`UX-411`, and from graph nodes, `specs/ux-graph-canvas.md`'s `UX-509`) to choose or change a
`KHR_interactivity` pointer target.

Owns: no dedicated `specs/ownership.json` glob yet (see `specs/ux-shell.md`'s "Owns" note) — this
surface is governed indirectly via `packages/app/**`'s catch-all mapping until it earns its own
package.

Prefix: `UX`. This file owns the `UX-9xx` block.

## Requirements

### Dialog anatomy

- [UX-900] (active) The dialog is a modal with a content tree on the left and a properties panel on the right for the tree's current selection; its footer shows the currently-assembled pointer path, a type chip for that path's value type, a Cancel action, and a primary "Use pointer" action.
- [UX-901] (active) The content tree has exactly three sections, in this order: Nodes (the full scene hierarchy, indented, each with its type icon), Materials, Animations (listed by name).

### Search

- [UX-902] (active) A search field filters all three tree sections and the current selection's property list simultaneously, by substring match against name/op-id.

### Property list and component expansion

- [UX-903] (active) Each animatable property row shows its name and a type chip (e.g. `float3`, `bool`, `float`); a property with more than one component (`float2`/`float3`/`float4`/`float[N]`) exposes a twisty that expands per-component rows (`/0`, `/1`, ...), each independently selectable and typed `float`.
- [UX-904] (active) Selecting a property row or one of its expanded component rows live-assembles the full pointer path and its type into the footer (`UX-900`); the "Use pointer" action stays disabled until a concrete path is selected.
- [UX-905] (active) Selecting an entry under Animations shows an explanatory note in place of a property list — animation clips are not themselves pointer targets; they are referenced from `animation/start`/`animation/stop` nodes instead.

### Confirming and preselection

- [UX-906] (active) Confirming "Use pointer" writes the assembled path (and its type) into the calling graph node's `config` and closes the dialog; it never applies any document mutation on its own — the written config only takes effect through whatever command/patch mechanism the surrounding node's own creation or edit already goes through.
- [UX-907] (active) Opening the dialog to retarget an existing pointer-config node preselects that pointer's tree item, property, and (if the current path addresses a specific component) its expanded component — the dialog never opens "blank" for a node that already has a pointer configured.

### Dismissal

- [UX-908] (active) Cancel, the `✕` close control, clicking the modal backdrop, and Escape all close the dialog without writing any config change, equivalently to each other.

## Open questions

_None at freeze time._
