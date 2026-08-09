// Small local helper shared by every template in mock-agent-provider.ts:
// accumulates a sequence of editor-core `Command`s while keeping a running
// `json` snapshot (each command applied on top of the last) so a template
// can, e.g., add a graph node and then immediately learn its index to wire
// a `connectFlow` to it — the exact same "apply locally, read the index
// back" technique `packages/graph-canvas/src/graph-canvas.tsx` and
// `packages/editor-core/src/graph-edit.test.ts` already use at call sites,
// just factored into one reusable accumulator instead of every template
// hand-rolling its own `applyPatches` bookkeeping.
//
// Deliberately NOT `combineCommandParts`-ing everything into one opaque
// `Command`: `Proposal.commands` is a `CommandLike[]` precisely so a
// multi-step proposal (e.g. "add-cube") stays inspectable as a list of
// individually-labeled commands in the UI (per the Part A brief) — they
// still apply together as one `HistoryStack.transact` (AG-004), which is
// what actually makes them one undo step, not how many `Command` objects
// happen to be in the array.
import type { Command } from "@gltf-studio/editor-core";
import { applyPatches } from "@gltf-studio/editor-core";
import type { EditorDocument } from "@gltf-studio/editor-core";

export class CommandChain {
  readonly commands: Command[] = [];
  #json: unknown;
  readonly #document: EditorDocument;

  constructor(document: EditorDocument) {
    this.#document = document;
    this.#json = document.json;
  }

  /** The working `EditorDocument` reflecting every command pushed so far — pass this to the next factory call. */
  get doc(): EditorDocument {
    return { ...this.#document, json: this.#json };
  }

  /** The working `json` reflecting every command pushed so far (e.g. to read back an array's new length). */
  get json(): unknown {
    return this.#json;
  }

  /** Appends `command` and advances the working `json` by applying its forward patches. */
  push(command: Command): Command {
    this.commands.push(command);
    this.#json = applyPatches(this.#json, command.patches);
    return command;
  }
}
