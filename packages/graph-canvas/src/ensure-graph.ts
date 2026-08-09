// "Empty-asset" scaffold: creates `extensions.KHR_interactivity` (with one
// empty graph) plus the corresponding `extensionsUsed` entry, the first time
// a node is added to an asset that has no interactivity graph at all yet.
// Built from editor-core's exported primitives only, same rationale as
// graph-edit-ext.ts (this task's file boundary is packages/graph-canvas/**,
// not packages/editor-core/**).
import {
  appendFragment,
  applyPatches,
  combineCommandParts,
  getIn,
  makeCommandId,
  setPathFragment,
  type Command,
  type EditorDocument
} from "@gltf-studio/editor-core";

export type EnsureGraphResult = {
  /** `null` when a graph already existed — nothing to do. */
  command: Command | null;
  graphIndex: number;
  /** `document` with `command`'s patches already applied, ready for a follow-up GraphEdit call in the same gesture. */
  documentAfter: EditorDocument;
};

/** Find-or-create the interactivity extension's first graph. Single-graph MVP: always targets index 0. */
export function ensureGraphScaffold(document: EditorDocument): EnsureGraphResult {
  const graphs = getIn(document.json, ["extensions", "KHR_interactivity", "graphs"]) as unknown[] | undefined;
  if (graphs && graphs.length > 0) {
    return { command: null, graphIndex: 0, documentAfter: document };
  }

  const parts: Array<{ patches: Command["patches"]; inverse: Command["inverse"] }> = [];
  const extFragment = setPathFragment(document.json, ["extensions", "KHR_interactivity"], {
    graphs: [{ types: [], declarations: [], nodes: [] }]
  });
  parts.push(extFragment);
  const jsonAfterExt = applyPatches(document.json, extFragment.patches);

  const usedList = (getIn(jsonAfterExt, ["extensionsUsed"]) as string[] | undefined) ?? [];
  let jsonAfterUsed = jsonAfterExt;
  if (!usedList.includes("KHR_interactivity")) {
    const usedFragment = appendFragment(jsonAfterExt, ["extensionsUsed"], "KHR_interactivity");
    parts.push(usedFragment);
    jsonAfterUsed = applyPatches(jsonAfterExt, usedFragment.patches);
  }

  const combined = combineCommandParts(parts);
  const command: Command = {
    id: makeCommandId("ensure-graph"),
    label: "Add interactivity graph",
    patches: combined.patches,
    inverse: combined.inverse
  };
  return { command, graphIndex: 0, documentAfter: { ...document, json: jsonAfterUsed } };
}
