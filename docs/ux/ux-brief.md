# gltf-studio — UX Brief (U1)

## Target user

**Primary — 3D artist / technical designer.** Comfortable with node graphs (Blueprint/Shader-Graph/Blender-nodes fluency), not necessarily a programmer. Thinks in scenes, objects, and "when X happens, do Y." Wants to see and touch the result immediately.

**Secondary — developer.** Same project, different lens: lives in the Script tab, treats the graph as a compile target, cares about diffs and round-trip fidelity more than node layout.

Both personas share one document and one play-test loop; the tool never forks into "artist mode" vs "code mode" — it's one graph, viewed two ways.

## Golden path

**Import glTF → arrange scene → wire behavior (graph or script) → attach audio → play-test → export portable .glb.**

Every step writes back into the same glTF JSON the user imported. Export must be a real, portable, conformant `.glb` that runs in any engine — the tool never produces a lock-in save format.

## Core loops

1. **Edit → preview loop.** Select in scene tree or viewport → adjust transform/material/audio in Inspector → see it live in the viewport. No modal "apply" step; the viewport is always the truth.
2. **Graph ⇄ script loop.** Edit the behavior graph, flip to Script and see generated code; edit the script, flip back and see the graph update — with an explicit EQUIV / DIVERGED badge so neither party is ever guessing whether the two views agree.
3. **Tune ⇄ audition loop.** Adjust an emitter's gain/distance-model or an audio-graph node's parameters and hit audition (▶) to hear the change in isolation, without entering full play mode.

All three loops close in under a second of latency — that responsiveness is a hard UX requirement, not a nice-to-have.

## v1 non-goals

- **No multi-user / real-time collaboration.** Single editor, single document, local-first.
- **No FBX/USD/other DCC import.** glTF/GLB in, glTF/GLB out — the tool authors the interchange format, it doesn't replace a DCC.
- **No animation timeline / keyframe editing.** Existing animations play and can be triggered by behavior graphs; authoring new clips is out of scope.
- **No material node editor (shader graph).** Materials are edited as PBR parameter fields in the Inspector, not as a node network.
- **No custom/native node authoring.** The node palette is the fixed KHR_interactivity + KHR_audio_graph op set; no user-defined nodes or plugins in v1.
- **No mobile/touch-first layout.** Desktop, mouse + keyboard, 1280px+ viewport.

## What "done" feels like

A technical designer can take a glTF export from their DCC tool, arrange it, click together an interaction and a sound cue without opening a code editor, hit play, and export a file that behaves identically in a third-party viewer — while a developer, working the same project from the Script tab, never has to ask "did the graph actually change?"
