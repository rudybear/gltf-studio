# samples/playground.glb

A small, generated (never hand-authored) glTF scene exercising every shipped `gltf-studio`
feature end to end: the viewport, inspector, behavior-graph editor, script tab, both play engines,
audio, and Copilot. It is the source `pnpm sample` (`scripts/make-sample.mjs`) builds and
verifies — that script is the source of truth; this file is a checked-in, deterministic build
artifact of running it.

Open it via the app's empty-project "Load sample scene" button (viewport, before importing
anything else), or drag/pick it through the top bar's **Import** control.

## What's in it

- **Scene**: a Ground plane, three distinct meshes with their own materials (a red
  **SpinningCube**, a green **ButtonSphere**, a blue **TogglePillar**), a point light (**Lamp**),
  and a camera (**Cam**) — all flat children of one **Root** node.
- **Audio**: a **Speaker** node carrying a positional `KHR_audio_emitter` whose one source plays
  an embedded, generated WAV beep, routed through a one-node `KHR_audio_graph` gain chain.
- **Behavior graph** (`KHR_interactivity`): 
  - `event/onStart` sets a `ready` variable.
  - `event/onTick` continuously rotates **SpinningCube** (a running `angle` variable driving
    `math/quatFromAxisAngle` into `pointer/set`).
  - `event/onSelect`, scoped to **ButtonSphere**, flips a `toggled` variable, animates
    **TogglePillar**'s height via `pointer/interpolate`, and re-triggers the beep via the
    audio-emitter "playing" trigger pointer.

## What to try

1. **Viewport + Inspector**: click **ButtonSphere** — the Inspector shows its identity and
   transform. Try the move/rotate/scale gizmo (`W`/`E`/`R`).
2. **Behavior graph** (bottom dock, "Behavior graph" tab): the graph above is all real, editable
   nodes — search the palette, add a node, drag a connection, click a `pointer/set`'s pointer icon
   to retarget it through the pointer picker.
3. **Script tab**: the same graph as real, readable/editable TypeScript-flavored code
   (`rt.onTick(...)`, `rt.onSelect(...)`) — edit it and hit Apply to write the change back to the
   graph, or watch the EQUIV/DIVERGED badge track whether your edit still matches the graph.
4. **Play** (top bar's play controls, either engine): press ▶ — **SpinningCube** keeps rotating
   (watch the `angle` variable in the live overlay), and clicking **ButtonSphere** in the viewport
   toggles **TogglePillar**'s height and re-plays the beep (Audition it once from the Inspector
   first, in the same session, so its `AudioContext` exists).
5. **Audio graph** (bottom dock, "Audio graph" tab): the Speaker's source → gain → emitter chain,
   read-only and lint-checked.
6. **Copilot** (right panel): select a node and try a prompt like "spin when clicked" or "add 2
   cubes" — review the proposed graph/scene changes before accepting.
7. **Export**: `Export .glb` writes the current document back out, byte-preserving wherever it can.

See `e2e/golden-path.spec.ts` for a scripted walk through this exact journey.

# samples/r4-racer.glb

A complete top-down racing game (26 scene nodes, a 366-node `KHR_interactivity` behavior graph,
15 variables) whose entire logic — steering, lap-checkpoint gating with anti-cheat, boost,
off-track slowdown, a 12-step finish celebration, and an AI rival — lives inside this one `.glb`.
Unlike `playground.glb`, this is **not built by this repo**: it's a vendored, unmodified copy of
`dist/r4.glb` from the sibling
[`gltf-interactivity-game`](https://github.com/rudybear/gltf-interactivity-game) repo's own
build pipeline (`pnpm release`, byte-reproducible there from `src/game.template.ts` — see that
repo's README for the full authoring/compile/splice story). Do not hand-edit this file; to pick
up a change, re-run that pipeline and re-copy `dist/r4.glb` here.

Open it via the app's empty-project starter gallery's "R4 Racer" card (`viewport.gallery.card.racer`,
specs/ux-shell.md UX-119), which fetches and imports it exactly like `playground.glb`'s card does.
The game is authored entirely against `onSelect`/`onHoverIn`/`onHoverOut` on three on-screen pads
(no keyboard input) — in the editor, enter play mode and click the steer/boost pads in the
viewport the same way a player would.

See `e2e/racer.spec.ts` for scripted coverage of this asset (gallery card, scene tree, graph
canvas at its real 366-node scale, script-tab decompile, and play-mode pad interaction).
