// EditorDocument shape + applyCommand (DOC-001..006, DOC-023, DOC-031).
import type { Container } from "@gltfi/gltf";
import type { Command } from "./command.js";
import { applyPatches } from "./patch.js";
import { canonicalSpliceRoot } from "./splice-root.js";

/**
 * DOC-001: `container` — the pristine parse of the last successful save;
 *   never mutated by in-memory command application.
 * DOC-002: `json` — the current authored glTF JSON, immutable.
 * DOC-003: `rev` — bumps by exactly one on every operation that changes
 *   `json` (see DOC-035's coalescing clarification).
 * DOC-004: `dirtyRoots` — canonical splice-root JSON pointers (DOC-022,
 *   DOC-038) whose subtree changed since the last successful save.
 *
 * `frozen` (DOC-031, DOC-037): true for the duration of play mode; not
 * itself a numbered requirement's field name, but the mechanism by which
 * DOC-031's freeze is represented on the document value.
 */
export interface EditorDocument {
  readonly container: Container;
  readonly json: unknown;
  readonly rev: number;
  readonly dirtyRoots: ReadonlySet<string>;
  readonly frozen: boolean;
}

/** Creates a fresh `EditorDocument` from a parsed container (rev 0, no dirty roots, not frozen). */
export function createDocument(container: Container): EditorDocument {
  return { container, json: container.json, rev: 0, dirtyRoots: new Set(), frozen: false };
}

/**
 * DOC-031: thrown by `applyCommand`/`HistoryStack` when a command is
 * attempted against a frozen (play-mode) document, resolving the spec's
 * open question in favor of "throw a typed error" over no-op/queue (DOC-037)
 * — UI command dispatch is expected to prevent commands from reaching
 * `applyCommand` while play is running, upstream of this throw.
 */
export class DocumentFrozenError extends Error {
  constructor() {
    super("EditorDocument is frozen for play mode: no Command may be applied while PlayController is running (DOC-031).");
    this.name = "DocumentFrozenError";
  }
}

/** DOC-031: freezes a document for the duration of play mode. Pure — returns a new value. */
export function freezeDocument(document: EditorDocument): EditorDocument {
  return { ...document, frozen: true };
}

/** DOC-031: unfreezes a document once play mode ends. Pure — returns a new value. */
export function unfreezeDocument(document: EditorDocument): EditorDocument {
  return { ...document, frozen: false };
}

/**
 * DOC-005: pure — never mutates `document`/`document.json`; called twice
 * with the same arguments produces equal output.
 * DOC-006: structural sharing — every subtree not addressed by a patch
 * keeps its exact input identity.
 * DOC-023: unions each applied patch's canonical splice root into the
 * result's `dirtyRoots`.
 * DOC-037: throws `DocumentFrozenError` instead of applying anything when
 * `document.frozen`.
 */
export function applyCommand(document: EditorDocument, command: Command): EditorDocument {
  if (document.frozen) {
    throw new DocumentFrozenError();
  }
  const newJson = applyPatches(document.json, command.patches);
  const dirtyRoots = new Set(document.dirtyRoots);
  for (const op of command.patches) {
    dirtyRoots.add(canonicalSpliceRoot(op.path));
  }
  return { ...document, json: newJson, rev: document.rev + 1, dirtyRoots };
}
