/** @spec AG-003 */
import { describe, expect, it } from "vitest";
import { SceneEdit, GraphEdit } from "@gltf-studio/editor-core";
import { CommandChain } from "./command-chain.js";
import { fixtureDocument } from "./test-fixtures.js";

describe("CommandChain (AG-003)", () => {
  it("push() appends to .commands and advances .json/.doc by the command's forward patches", () => {
    const doc = fixtureDocument();
    const chain = new CommandChain(doc);
    expect(chain.commands).toEqual([]);
    expect(chain.json).toEqual(doc.json);

    const command = SceneEdit.setTransform(chain.doc, 0, { translation: [5, 0, 0] });
    const pushed = chain.push(command);

    expect(pushed).toBe(command);
    expect(chain.commands).toEqual([command]);
    const updated = chain.json as { nodes: Array<{ translation: number[] }> };
    expect(updated.nodes[0].translation).toEqual([5, 0, 0]);
    // .doc reflects the same working json, wrapped as an EditorDocument.
    expect((chain.doc.json as typeof updated).nodes[0].translation).toEqual([5, 0, 0]);
  });

  it("a second push() sees the first push()'s effect via chain.doc (index/read-back pattern)", () => {
    const doc = fixtureDocument();
    const chain = new CommandChain(doc);

    chain.push(GraphEdit.ensureGraph(chain.doc, 0));
    chain.push(GraphEdit.addNode(chain.doc, 0, "event/onTick", {}));

    const graph = (chain.json as { extensions: { KHR_interactivity: { graphs: Array<{ nodes: unknown[] }> } } }).extensions.KHR_interactivity
      .graphs[0];
    expect(graph.nodes.length).toBe(1);
    expect(chain.commands.length).toBe(2);
  });
});
