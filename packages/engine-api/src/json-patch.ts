/**
 * RFC 6902 JSON Patch operation. Shared by RenderHost.patchScene, the
 * StorageProvider autosave journal, and (per Phase A of the program plan,
 * in the not-yet-scaffolded editor-core package) command-factory inverse
 * patches — this is the one cross-package patch representation, and per
 * Phase A doubles as the future backend sync wire format.
 */
export interface JsonPatchOp {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  // OPEN(EA-jsonpatch-value-tbd): plan does not specify whether `value`/`from`
  // are typed beyond RFC 6902's own shape; kept as `unknown` here rather than
  // guessing a narrower editor-specific type.
  value?: unknown;
  from?: string;
}
