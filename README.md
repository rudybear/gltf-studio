# gltf-studio

`gltf-studio` is a hosted web editor for glTF experiences: import a glTF/GLB asset, arrange its
scene tree, wire up **KHR_interactivity** behavior graphs (visually and as scripts, bidirectionally),
author **KHR_audio_emitter/_environment** and a **KHR_audio_graph** patcher, play-test in place, and
export a portable `.glb` that runs in any conformant engine. The editor is local-first and
backend-ready: projects live in browser storage or the local filesystem today, with every
persistence and rendering concern routed through interfaces (`StorageProvider`, `RenderHost`,
`PlayController`, `AudioHost`/`AudioGraphHost`) so a hosted backend and additional engines can arrive
later without reworking the editor itself.

The repo follows a spec-gated, "living project state" development model: requirements
(`/specs/*.md`), UX (`/docs/ux/`), and architecture decisions (`/docs/adr/`) are ordinary repo
artifacts that change in the same PR as the code they govern, `/STATUS.md` is generated (never
hand-edited) traceability from requirement to citing test, and CI-enforced drift checks
(`scripts/check-drift.mjs`) fail the build if a test cites a retired or unknown requirement, a spec
requirement line is malformed, or (in PR context) code under a spec's ownership changes without an
accompanying spec diff. Agents implement cited requirements failing-test-first; nothing merges
without its gate passing.

**Status: pre-UX-freeze scaffold.** This is the M0 milestone — workspace skeleton, the
types-only `engine-api` interface package, contract-test skeletons (todo inventory, not yet
implemented against anything), the spec/drift/status tooling, and a vendored snapshot of the
`@gltfi/*` transpiler packages and the three.js render-host adapter. No editor UI exists yet; UX
mockups are being iterated separately and will freeze into `/docs/ux/` before implementation
begins in earnest.
