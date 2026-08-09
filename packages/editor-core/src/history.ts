// HistoryStack (DOC-011..018, DOC-035, DOC-036). Undo/redo restore prior
// states EXCLUSIVELY by applying inverse/forward JSON-Patch operations
// (DOC-018) — implemented here by feeding a synthetic `Command` back through
// `applyCommand` itself, so undo/redo get purity, dirty-root tracking, and
// the frozen-document check (DOC-031) for free rather than re-implementing
// them.
import { applyCommand, freezeDocument, unfreezeDocument, type EditorDocument } from "./document.js";
import type { Command, JsonPatchOp } from "./command.js";
import { makeCommandId } from "./command.js";

/** One undo/redo-log slot: 1+ commands coalesced/transacted into a single step. */
interface HistoryEntry {
  commands: Command[];
}

/**
 * DOC-036: resolves the "HistoryStack depth" open question — unbounded in
 * v1, no eviction policy. A future milestone may cap `undoLog`'s length;
 * nothing in this implementation assumes it always will be unbounded, but
 * nothing enforces a cap today either.
 */
export class HistoryStack {
  #document: EditorDocument;
  #undoLog: HistoryEntry[] = [];
  #redoLog: HistoryEntry[] = [];
  #transactDepth = 0;
  #transactBuffer: Command[] | null = null;
  #applyHandlers = new Set<(patches: JsonPatchOp[]) => void>();

  constructor(initialDocument: EditorDocument) {
    this.#document = initialDocument;
  }

  get document(): EditorDocument {
    return this.#document;
  }

  /** DOC-045: freezes the currently-held document for play mode (DOC-031). */
  freeze(): void {
    this.#document = freezeDocument(this.#document);
  }

  /** DOC-045: unfreezes the currently-held document after play mode ends. */
  unfreeze(): void {
    this.#document = unfreezeDocument(this.#document);
  }

  canUndo(): boolean {
    return this.#undoLog.length > 0;
  }

  canRedo(): boolean {
    return this.#redoLog.length > 0;
  }

  /**
   * DOC-011: applies `command.patches` and appends to the undo log.
   * DOC-012: clears the redo log.
   * DOC-015: coalesces into the current top-of-history entry when both it
   *   and `command` share the same defined `coalesceKey`.
   * DOC-035: every push (including one later merged by coalescing, or one
   *   issued inside a `transact`) bumps `EditorDocument.rev` by exactly one
   *   via `applyCommand` — coalescing/transacting only ever changes how many
   *   entries `undoLog`/`redoLog` contain, never how many times `rev`
   *   advances.
   */
  push(command: Command): void {
    this.#document = applyCommand(this.#document, command);
    this.#notifyApply(command.patches);

    if (this.#transactDepth > 0) {
      this.#transactBuffer!.push(command);
      return;
    }

    this.#redoLog = [];
    const top = this.#undoLog[this.#undoLog.length - 1];
    const topLastCommand = top?.commands[top.commands.length - 1];
    if (top && command.coalesceKey !== undefined && topLastCommand?.coalesceKey === command.coalesceKey) {
      top.commands.push(command);
    } else {
      this.#undoLog.push({ commands: [command] });
    }
  }

  /**
   * DOC-013: applies the most recently pushed/redone command's inverse and
   * moves it to the redo log. When that entry coalesced multiple commands
   * (DOC-015), all of them undo together as the entry's one step.
   */
  undo(): void {
    if (!this.canUndo()) return;
    const entry = this.#undoLog.pop()!;
    const undoCommand = entryToCommand(entry, "undo");
    this.#document = applyCommand(this.#document, undoCommand);
    this.#notifyApply(undoCommand.patches);
    this.#redoLog.push(entry);
  }

  /** DOC-014: re-applies the most recently undone command's patches and moves it back to the undo log. */
  redo(): void {
    if (!this.canRedo()) return;
    const entry = this.#redoLog.pop()!;
    const redoCommand = entryToCommand(entry, "redo");
    this.#document = applyCommand(this.#document, redoCommand);
    this.#notifyApply(redoCommand.patches);
    this.#undoLog.push(entry);
  }

  /**
   * DOC-039: every undo-log and redo-log entry (one per coalesced/transacted
   * push), in chronological push order — independent of how many of them
   * have since been undone — each exposing a representative `label` (its
   * first command's `Command.label`) and its zero-based `index` in that
   * order.
   */
  entries(): ReadonlyArray<{ label: string; index: number }> {
    const chronological = [...this.#undoLog, ...this.#redoLog.slice().reverse()];
    return chronological.map((entry, index) => ({ label: entry.commands[0].label, index }));
  }

  /** DOC-039: the index (within `entries()`) of the most recently applied entry, or -1 if none has been applied yet. */
  currentIndex(): number {
    return this.#undoLog.length - 1;
  }

  /**
   * DOC-040: registers a callback invoked, after `push`/`undo`/`redo` mutates
   * `document`, with exactly the forward-direction `JsonPatchOp[]` just
   * applied to reach the new `document.json` (the command's `patches` for
   * `push`/`redo`, its `inverse` for `undo`) — e.g. a `RenderHost` sync layer
   * can apply the same delta via `patchScene` without recomputing a diff.
   * Returns an unsubscribe function.
   */
  onApply(handler: (patches: JsonPatchOp[]) => void): () => void {
    this.#applyHandlers.add(handler);
    return () => {
      this.#applyHandlers.delete(handler);
    };
  }

  #notifyApply(patches: JsonPatchOp[]): void {
    for (const handler of this.#applyHandlers) {
      handler(patches);
    }
  }

  /**
   * DOC-016: groups every command pushed during the synchronous execution of
   * `fn` into a single undo/redo step. Reentrant: a `transact` nested inside
   * another `transact` folds into the outer one's single step.
   *
   * DOC-012 (redo-log clearing) applies once, when the (outermost) group is
   * committed — not per underlying push — so a `transact` that pushes zero
   * commands leaves the redo log untouched.
   */
  transact(fn: () => void): void {
    const isOutermost = this.#transactDepth === 0;
    if (isOutermost) this.#transactBuffer = [];
    this.#transactDepth += 1;
    try {
      fn();
    } finally {
      this.#transactDepth -= 1;
    }
    if (isOutermost) {
      const buffered = this.#transactBuffer!;
      this.#transactBuffer = null;
      if (buffered.length > 0) {
        this.#redoLog = [];
        this.#undoLog.push({ commands: buffered });
      }
    }
  }
}

/**
 * DOC-017: the log is linear — `push`/the `transact` commit above always
 * clear `#redoLog` before appending, so once anything has been undone,
 * pushing (or committing a transact) discards the entire existing redo log.
 */
function entryToCommand(entry: HistoryEntry, direction: "undo" | "redo"): Command {
  const ordered = direction === "undo" ? entry.commands.slice().reverse() : entry.commands;
  const patches = ordered.flatMap((command) => (direction === "undo" ? command.inverse : command.patches));
  const inverse = ordered
    .slice()
    .reverse()
    .flatMap((command) => (direction === "undo" ? command.patches : command.inverse));
  return {
    id: makeCommandId(direction),
    label: direction === "undo" ? "Undo" : "Redo",
    patches,
    inverse
  };
}
