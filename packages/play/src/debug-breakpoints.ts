// D2 (specs/ux-debugger.md UX-1505): the breakpoint half of the debug
// compiled-play pipeline. A gutter breakpoint set in this app's own Script
// tab (`@gltf-studio/script-panel`'s Monaco buffer) has no CDP session to
// call `Debugger.setBreakpointByUrl` against — this page cannot debug
// itself (docs/adr/0006's "CDP self-debugging" rejected alternative). The
// only mechanism available from INSIDE the running script is a literal
// `debugger;` statement, which a real, externally-attached DevTools session
// (or this project's own CDP e2e suite) pauses on exactly like any other
// breakpoint.
//
// Honesty note (UX-1505): this function injects VISIBLE `debugger;` lines
// into the text that is actually transformed and run — it does not lie about
// what's executing via a source map trick. DevTools' Sources panel shows
// these injected lines as part of the running (authored) source, one line
// per requested breakpoint, because that IS the source being debugged. The
// alternative (hiding the injected lines from the shown source while still
// executing them) would break specs/ux-debugger.md UX-1503's text-identity
// guarantee for no real benefit.
export function injectBreakpoints(tsText: string, lines: readonly number[]): string {
  const uniqueSortedLines = Array.from(new Set(lines))
    .filter((line) => Number.isInteger(line) && line > 0)
    .sort((a, b) => a - b);
  if (uniqueSortedLines.length === 0) return tsText;

  const sourceLines = tsText.split("\n");
  // Insert from the LAST requested line backward: inserting a line shifts
  // every later line index down by one, so processing in descending order
  // means an already-inserted line never shifts a still-to-process one out
  // from under this loop (each `line - 1` insertion index is computed
  // against the array's CURRENT length, which only earlier — not later —
  // insertions have touched by the time we get to it).
  for (let i = uniqueSortedLines.length - 1; i >= 0; i--) {
    const line = uniqueSortedLines[i]!;
    if (line > sourceLines.length) continue; // Stale breakpoint past EOF (e.g. the graph shrank since it was set) — silently ignored, not thrown; the same "an unmappable/stale reference is just absent" posture UX-712/UX-1108's cross-highlight already documents.
    sourceLines.splice(line - 1, 0, "debugger;");
  }
  return sourceLines.join("\n");
}
