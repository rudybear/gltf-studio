// Graph-node -> emitted-code-region lookup (specs/ux-audio-script.md
// UX-1400): the audio sibling of @gltf-studio/script-panel's
// cross-highlight.ts, MUCH simpler than that module because
// `@gltf-audiograph/emit-ts`'s `emitAudioModule` returns `names`/
// `sourceNames` keyed DIRECTLY by graph-local node/source index — no
// `sourceNodeIds` kind-prefixed indirection to resolve first, and every
// node/source gets exactly one `const <name> = a.<kind>(...);` declaration
// (see emit.ts's header for the exact emitted shape), so a plain
// `indexOf` search for that one generated line is always unambiguous
// (identifiers are unique within one generated module by construction).
//
// Honesty budget: a node/source with NO declaration line (impossible per
// the emitted-shape contract above — every node/source always gets exactly
// one `const` line) has nothing to search for; this module returns `null`
// rather than guessing. There is no `pointerPath`-style fallback need here
// (audio-script identifiers never inline like `pointer/set` GIscript calls
// do) — a materially SMALLER fidelity gap than the interactivity side's.
export type AudioHighlightMatch = { offset: number; length: number; identifier: string };

/** Resolves a `graph.nodes[]` index to its `const <name> = a.<kind>(...)` declaration's identifier range, or `null` if `names` has no entry for it (e.g. stale index after a graph edit). */
export function findHighlightForAudioNode(names: Record<number, string>, code: string, nodeIndex: number): AudioHighlightMatch | null {
  const name = names[nodeIndex];
  if (!name) return null;
  const needle = `const ${name} =`;
  const at = code.indexOf(needle);
  if (at === -1) return null;
  return { offset: at + "const ".length, length: name.length, identifier: name };
}

/** Same lookup for a `KHR_audio_emitter` source index (`sourceNames`, e.g. an `a.oscillator(...)`/`a.source(...)` declaration) — the synthetic source/emitter terminal nodes `@gltf-studio/audio-canvas` projects onto the canvas (map-audio-graph.ts) resolve here, not through `findHighlightForAudioNode`. */
export function findHighlightForAudioSource(sourceNames: Record<number, string>, code: string, sourceIndex: number): AudioHighlightMatch | null {
  const name = sourceNames[sourceIndex];
  if (!name) return null;
  const needle = `const ${name} =`;
  const at = code.indexOf(needle);
  if (at === -1) return null;
  return { offset: at + "const ".length, length: name.length, identifier: name };
}

/** Converts a plain character offset into a Monaco-style {lineNumber, column} (both 1-based) — copied verbatim from script-panel's cross-highlight.ts (small, zero-dep, not worth a shared package for one function — see this package's own "shared vs copied" note in specs/ux-audio-script.md). */
export function offsetToLineColumn(code: string, offset: number): { lineNumber: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === "\n") {
      line += 1;
      lastNewline = i;
    }
  }
  return { lineNumber: line, column: offset - lastNewline };
}
