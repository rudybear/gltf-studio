// Command shape (DOC-007..010). Unifies with `@gltf-studio/engine-api`'s
// `CommandLike` (resolving OPEN(AG-commandlike-unification-tbd),
// specs/agent-service.md) rather than duplicating `id`/`label`/`patches`/
// `inverse`: `Command` is `CommandLike` plus the one field `CommandLike`
// deliberately omitted, `coalesceKey` (DOC-010) — an agent `Proposal`'s
// commands apply inside one `HistoryStack.transact` (AG-004) and have no
// reason to coalesce with anything outside that transaction, so
// `CommandLike` itself needs no change; every `CommandLike` is structurally
// a valid `Command` minus optional coalescing.
import type { CommandLike, JsonPatchOp } from "@gltf-studio/engine-api";

export type { JsonPatchOp };

/**
 * DOC-007: `patches` — forward RFC 6902 ops, precomputed at creation time.
 * DOC-008: `inverse` — precomputed ops that undo `patches`.
 * DOC-009: `label` — human-readable, shown in history UI.
 * DOC-010: `coalesceKey` — optional; see `HistoryStack.push` (history.ts).
 */
export interface Command extends CommandLike {
  coalesceKey?: string;
}

let nextCommandId = 0;

/** Generates a unique `Command.id`. Not itself a requirement — `CommandLike.id` needs some source. */
export function makeCommandId(prefix: string): string {
  nextCommandId += 1;
  return `${prefix}-${nextCommandId}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Concatenates 1+ `{ patches, inverse }` fragments (e.g. a declaration-ensure
 * plus a node-add) into one combined fragment whose `inverse` correctly
 * unwinds the combined `patches` sequentially: forward patches run in the
 * given part order; inverse runs the parts in REVERSE order (each part's own
 * internal inverse order is preserved), matching how a sequential
 * RFC-6902 application must be undone.
 */
export function combineCommandParts(
  parts: ReadonlyArray<{ patches: JsonPatchOp[]; inverse: JsonPatchOp[] }>
): { patches: JsonPatchOp[]; inverse: JsonPatchOp[] } {
  return {
    patches: parts.flatMap((part) => part.patches),
    inverse: parts
      .slice()
      .reverse()
      .flatMap((part) => part.inverse)
  };
}
