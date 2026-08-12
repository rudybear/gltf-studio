// specs/ux-usage-mapping.md UX-1119: the Script tab's Monaco pointer-path
// links — a plain TEXT scan over the emitted code (no `@gltfi/ir`/module
// knowledge needed), the mirror image of `cross-highlight.ts`'s own
// `pointerPathMatch` fallback: that module finds an OFFSET given a known
// pointer-path STRING; this one finds every quoted pointer-path STRING in
// the code, given nothing but the text itself, so the Monaco link provider
// can turn each into a clickable range with no upfront knowledge of which
// paths exist. `@gltfi/emit-ts`'s `pointerCall` emits a pointer path via
// `JSON.stringify(path)` — a plain double-quoted string literal, e.g.
// `"/nodes/3/translation"` — so a quoted-string regex is exactly the right
// tool, same "search the emitted TEXT" spirit `cross-highlight.ts`'s own
// header comment already establishes for this pointer-op family (which
// carries no `sourceNodeIds` entry to resolve any other way).
//
// Scoped to the pointer FAMILIES `@gltf-studio/usage-index` actually
// resolves (`UX-1100`/`UX-1103`/`UX-1115`) — `/nodes/*`, `/materials/*`,
// `/meshes/*`, `/animations/*`, and the `KHR_audio_emitter` emitter/source
// families — so an unrelated quoted string elsewhere in the buffer (e.g. a
// literal string VALUE, not a pointer path) is never mistaken for a link.

export interface PointerLinkMatch {
  /** The pointer path text itself, WITHOUT surrounding quotes. */
  pointerPath: string;
  /** Character offset of the path text's first character (i.e. just past the opening quote) — the same convention `cross-highlight.ts`'s `HighlightMatch`/`pointerPathMatch` already use. */
  offset: number;
  /** Length of the path text alone (never counting the quotes). */
  length: number;
}

const POINTER_PATH_PATTERN =
  /"(\/(?:nodes|materials|meshes|animations)\/\d+(?:\/[^"\\]*)?|\/extensions\/KHR_audio_emitter\/(?:emitters|sources)\/\d+(?:\/[^"\\]*)?)"/g;

/** Every quoted pointer-path string literal in `code`, in source order. Pure, no Monaco dependency — independently unit-testable. */
export function findPointerPathLinks(code: string): PointerLinkMatch[] {
  const matches: PointerLinkMatch[] = [];
  for (const m of code.matchAll(POINTER_PATH_PATTERN)) {
    const pointerPath = m[1]!;
    matches.push({ pointerPath, offset: m.index! + 1, length: pointerPath.length });
  }
  return matches;
}
