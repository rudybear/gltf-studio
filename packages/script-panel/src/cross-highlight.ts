// Best-effort graph-node -> emitted-code-region lookup (specs/ux-script.md
// UX-712): clicking a node on the Behavior graph canvas should scroll/
// highlight "the corresponding bit of code" in the Script tab. Neither
// `@gltfi/ir`'s `IRModule` nor `@gltfi/emit-ts`'s `EmitNames` carry source
// RANGES (character offsets into the emitted text) for any construct — only
// NAMES (`EmitNames.{variables,events,stateSlots,procs}`) plus, on the IR
// module itself, `meta.sourceNodeIds`: a `"<kind>:<index>" -> graph node
// index` map recorded during `importGraph` for exactly four construct kinds
// (`handler`, `proc`, `stateSlot`, `temp`).
//
// This module's honesty budget: it resolves `handler`/`proc`/`stateSlot`
// origins to a text occurrence via a plain string search over the emitted
// source (identifier-level, not source-range-accurate — two structurally
// identical procs would, in principle, be ambiguous, though the emitter's
// own naming pass (emit-ts's header comment) gives every proc/state-slot/
// variable a name unique within its own array, which is enough to make
// `indexOf`/nth-occurrence search unambiguous in practice). `temp:<id>`
// origins are NOT resolved — emit-ts's `EmitNames` carries no per-temp
// identifier text (temps get short, emitter-internal sequential names it
// never returns), so there is no stable string to search for; a node whose
// only `sourceNodeIds` entries are `temp:*` (e.g. one operand deep inside a
// larger expression) silently produces no highlight, per UX-712's own
// "silently no-op" clause, rather than guessing at a wrong location.
import type { IRHandler, IRModule } from "@gltfi/ir";
import type { EmitNames } from "@gltfi/emit-ts";

export type HighlightMatch = { offset: number; length: number; identifier: string };

const HANDLER_CALL_NAME: Record<IRHandler["kind"], string> = {
  onStart: "onStart",
  onTick: "onTick",
  receive: "onReceive",
  onSelect: "onSelect",
  onHoverIn: "onHoverIn",
  onHoverOut: "onHoverOut"
};

function findNthOccurrence(code: string, needle: string, occurrenceIndex: number): number | null {
  let at = -1;
  for (let i = 0; i <= occurrenceIndex; i++) {
    at = code.indexOf(needle, at + 1);
    if (at === -1) return null;
  }
  return at;
}

/**
 * Returns the first resolvable text occurrence in `code` corresponding to
 * `nodeIndex` (a `graph.nodes[]` index), or `null` if none of that node's
 * `sourceNodeIds` entries resolve to a construct this module can locate
 * (UX-712's fidelity gap, documented above).
 */
export function findHighlightForNode(module: IRModule, names: EmitNames, code: string, nodeIndex: number): HighlightMatch | null {
  const originEntries = Object.entries(module.meta.sourceNodeIds).filter(([, graphNodeIndex]) => graphNodeIndex === nodeIndex);

  for (const [key] of originEntries) {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    const index = Number(key.slice(separator + 1));

    if (kind === "proc") {
      const name = names.procs[index];
      if (!name) continue;
      const needle = `function ${name}(`;
      const at = code.indexOf(needle);
      if (at !== -1) return { offset: at + "function ".length, length: name.length, identifier: name };
    } else if (kind === "stateSlot") {
      const name = names.stateSlots[index];
      if (!name) continue;
      const needle = `const ${name} =`;
      const at = code.indexOf(needle);
      if (at !== -1) return { offset: at + "const ".length, length: name.length, identifier: name };
    } else if (kind === "handler") {
      const handler = module.handlers[index];
      if (!handler) continue;
      const callName = HANDLER_CALL_NAME[handler.kind];
      const sameKindBefore = module.handlers.slice(0, index).filter((h) => h.kind === handler.kind).length;
      const needle = `rt.${callName}(`;
      const at = findNthOccurrence(code, needle, sameKindBefore);
      if (at !== null) return { offset: at + "rt.".length, length: callName.length, identifier: `rt.${callName}` };
    }
    // "temp" kind: intentionally unresolved — see module header comment.
  }
  return null;
}

/** Converts a plain character offset into a Monaco-style {lineNumber, column} (both 1-based). */
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
