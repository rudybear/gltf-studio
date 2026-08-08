# docs/ux

Populated at UX freeze **U4** (see the program plan's Phase U). Until then, UX is iterated as
private clickable HTML mockup artifacts outside this repo; nothing here is authoritative yet.

Once frozen, this directory holds one spec per surface, each with numbered `UX-###` requirements
(layout, interactions, keyboard map, empty/error states) and the approved mockup snapshot checked
in beside it. Every Playwright e2e test cites the `UX-###` IDs it exercises, and every panel's
`data-testid`s derive from them — the same citation discipline `specs/README.md` describes for
`/specs/*.md`, applied to UX.
