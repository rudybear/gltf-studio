# gltf-studio

**Live:** https://rudybear.github.io/gltf-studio/ (GitHub Pages, redeployed from `main` after CI
passes — see `.github/workflows/deploy.yml`). No install needed: open it and click **Load sample
scene** on the empty-project screen.

## Quickstart

- **Try it now**: open https://rudybear.github.io/gltf-studio/ and click **Load sample scene** —
  see `samples/README.md` for a guided walkthrough of what to try (viewport, graph, script, play,
  audio, Copilot, export).
- **Local dev**:
  ```sh
  pnpm install
  pnpm dev            # http://localhost:5173, hot-reloading
  ```
  or build + preview the production bundle the same way CI/Pages does:
  ```sh
  pnpm build && pnpm --filter @gltf-studio/app run preview
  ```
- **Regenerate the sample asset** (after changing `scripts/make-sample.mjs`): `pnpm sample` —
  writes and verifies `samples/playground.glb` (structural + headless-interpreter checks; fails
  loudly rather than writing a broken asset).
- **Project status**: `/STATUS.md` is the generated (never hand-edited) requirement → citing-test
  traceability matrix — regenerate it with `pnpm status` after touching a `specs/*.md` file.
- **Architecture, one paragraph**: a Vite + React + zustand app shell (`packages/app`) sits on top
  of an immutable, patch-based document core (`packages/editor-core`) that every editing surface —
  the viewport (`packages/engine-three`), the behavior-graph and audio-graph canvases
  (`packages/graph-canvas`/`audio-canvas`/`audio-graph`), the script tab (`packages/script-panel`),
  play mode (`packages/play`), and Copilot (`packages/agent-mock`) — reads from and writes back to
  through the same `Command`/`HistoryStack` mechanism; the vendored `@gltfi/*` packages (see
  `docs/adr/0003-vendored-gltfi-tarballs.md`) provide the real `KHR_interactivity`
  parse/verify/interpret/compile/emit pipeline underneath all of it.

## About

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

**Status: checkpoint — every planned editor surface is live and e2e-covered.** M0 shipped the
workspace skeleton, `engine-api`, and the vendored `@gltfi/*`/three.js foundations; M1 added the
document core (`EditorDocument`, `HistoryStack`, `GraphEdit`/`SceneEdit`); M2–M8 landed the app
shell, viewport, inspector, behavior-graph and audio-graph canvases, the script tab, play mode
(interpreter + compiled), real audio, and Copilot, each behind its own `specs/*.md` UX-###
citations and Playwright coverage (see `/STATUS.md`). This checkpoint adds a generated sample asset
(`samples/`), a Pages deploy, and `e2e/golden-path.spec.ts` — one scripted pass through every
surface above against a single built app instance.
