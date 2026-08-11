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
// never returns), so there is no stable string to search for.
//
// A WIDER gap than `temp`, discovered investigating specs/ux-usage-mapping.md
// UX-1108's → Script jump: `pointer/set` and `pointer/interpolate` graph
// nodes (by far the most common `KHR_interactivity` usage pattern — driving
// a node's transform/material/etc.) get NO `sourceNodeIds` entry AT ALL —
// they're inlined directly as an `rt.ptrSet(...)`/`rt.ptrInterp(...)`
// statement with no handler/proc/stateSlot/temp wrapper to name. The one
// thing that DOES survive verbatim into the emitted text for these is the
// pointer path itself: `@gltfi/emit-ts`'s `pointerCall` emits it via
// `JSON.stringify(path)` (a plain quoted string literal, e.g.
// `"/nodes/3/translation"`). `findHighlightForNode`'s `pointerPath` option
// below searches for that exact quoted string as a fallback once the
// `sourceNodeIds` lookup comes up empty — real, if coarser than an
// identifier match: a pointer path SET FROM MORE THAN ONE PLACE in the same
// graph is genuinely ambiguous by text alone, so callers may pass
// `enclosingHandlerNodeIndex` (see `@gltf-studio/usage-index`'s
// `findEnclosingHandlerRoot`) as a cheap disambiguation hint — preferring
// the occurrence that falls textually within that handler's own emitted
// function body — falling back to the first occurrence, and documenting
// (specs/ux-usage-mapping.md) that a same-path-multiple-writers graph may
// occasionally highlight the wrong one of several equally-valid call sites,
// same "honest, bounded-effort, no hidden guess dressed up as certainty"
// spirit as everything else in this module.
import type { IRHandler, IRModule } from "@gltfi/ir";
import type { EmitNames } from "@gltfi/emit-ts";

export type HighlightMatch = { offset: number; length: number; identifier: string };

export type FindHighlightOptions = {
  /**
   * A `pointer/get|set|interpolate` node's literal pointer path (e.g.
   * `@gltf-studio/usage-index`'s `UsageRef.pathText` for a `kind: "pointer"`
   * row) — tried only once the `sourceNodeIds` lookup above resolves
   * nothing. `null`/`undefined`/empty for a non-pointer node or an
   * unresolvable (templated) pointer — never guessed at.
   */
  pointerPath?: string | null;
  /**
   * The graph-node index of the event/* handler root this reference's own
   * flow traces back to (`@gltf-studio/usage-index`'s
   * `findEnclosingHandlerRoot`), used only to disambiguate multiple
   * `pointerPath` occurrences. `null`/`undefined` when unknown or
   * unresolvable — falls back to the first occurrence.
   */
  enclosingHandlerNodeIndex?: number | null;
};

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

function findAllOccurrences(code: string, needle: string): number[] {
  const result: number[] = [];
  let at = -1;
  for (;;) {
    at = code.indexOf(needle, at + 1);
    if (at === -1) return result;
    result.push(at);
  }
}

/**
 * Scans forward from `openBraceIndex` (which must point at a literal `{`)
 * for the offset one past its matching `}`, tracking string-literal state so
 * a `{`/`}` character appearing INSIDE a quoted string (a real case here: an
 * unresolved `{name}` ref-kind pointer-template placeholder is emitted
 * verbatim inside its `JSON.stringify`-quoted pointer literal) is never
 * mistaken for real brace nesting. Handles `"`/`'`/`` ` `` string bodies and
 * backslash-escapes; does NOT track `${...}` template-literal re-entry into
 * code context (emit-ts never emits an interpolated template literal into
 * GIscript output — every dynamic value is emitted as ordinary call
 * arguments — so this is a documented non-issue for this module's actual
 * input, not a silent gap). Returns `code.length` if the brace never closes
 * (malformed/truncated input — best-effort, not a thrown error).
 */
function findMatchingBraceEnd(code: string, openBraceIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  for (let i = openBraceIndex; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") {
        i += 1; // skip the escaped character entirely, whatever it is
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return code.length;
}

/** Resolves a `handler` `sourceNodeIds` entry to its `rt.<callName>(` text occurrence, or `null`. Shared by the main lookup and by the pointer-path fallback's handler-context narrowing below. */
function findHandlerOccurrence(module: IRModule, code: string, handlerIndex: number): { at: number; callName: string } | null {
  const handler = module.handlers[handlerIndex];
  if (!handler) return null;
  const callName = HANDLER_CALL_NAME[handler.kind];
  const sameKindBefore = module.handlers.slice(0, handlerIndex).filter((h) => h.kind === handler.kind).length;
  const needle = `rt.${callName}(`;
  const at = findNthOccurrence(code, needle, sameKindBefore);
  return at === null ? null : { at, callName };
}

function pointerPathMatch(pointerPath: string, at: number): HighlightMatch {
  const needle = JSON.stringify(pointerPath);
  return { offset: at + 1, length: needle.length - 2, identifier: pointerPath };
}

/**
 * Returns the first resolvable text occurrence in `code` corresponding to
 * `nodeIndex` (a `graph.nodes[]` index), or `null` if none of that node's
 * `sourceNodeIds` entries resolve to a construct this module can locate AND
 * `options.pointerPath`'s fallback search (see module header) also comes up
 * empty (UX-712/UX-1108's fidelity gap, documented above).
 */
export function findHighlightForNode(module: IRModule, names: EmitNames, code: string, nodeIndex: number, options?: FindHighlightOptions): HighlightMatch | null {
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
      const found = findHandlerOccurrence(module, code, index);
      if (found) return { offset: found.at + "rt.".length, length: found.callName.length, identifier: `rt.${found.callName}` };
    }
    // "temp" kind: intentionally unresolved — see module header comment.
  }

  const pointerPath = options?.pointerPath;
  if (pointerPath) {
    const occurrences = findAllOccurrences(code, JSON.stringify(pointerPath));
    if (occurrences.length === 0) return null;
    if (occurrences.length > 1 && options?.enclosingHandlerNodeIndex != null) {
      const handlerEntry = Object.entries(module.meta.sourceNodeIds).find(
        ([key, graphNodeIndex]) => graphNodeIndex === options.enclosingHandlerNodeIndex && key.startsWith("handler:")
      );
      if (handlerEntry) {
        const handlerIndex = Number(handlerEntry[0].slice("handler:".length));
        const found = findHandlerOccurrence(module, code, handlerIndex);
        if (found) {
          const bodyStart = code.indexOf("{", found.at);
          const bodyEnd = bodyStart === -1 ? -1 : findMatchingBraceEnd(code, bodyStart);
          const within = bodyStart !== -1 ? occurrences.find((at) => at >= bodyStart && at < bodyEnd) : undefined;
          if (within !== undefined) return pointerPathMatch(pointerPath, within);
        }
      }
    }
    return pointerPathMatch(pointerPath, occurrences[0]);
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
