/** @spec AG-006 */
import { describe, expect, it } from "vitest";
import { GraphEdit, applyPatches } from "@gltf-studio/editor-core";
import { validateProposalGraph } from "./validate.js";
import { fixtureDocument } from "./test-fixtures.js";

describe("validateProposalGraph (AG-006)", () => {
  it("returns { findings: [] } when there is no graph at the given index", () => {
    const doc = fixtureDocument(); // no KHR_interactivity extension at all
    const report = validateProposalGraph(doc.json, 0);
    expect(report).toEqual({ findings: [] });
  });

  it("returns error findings for a graph with a dangling flow reference", () => {
    const doc = fixtureDocument();
    let json = doc.json;
    const ensureCmd = GraphEdit.ensureGraph({ ...doc, json }, 0);
    json = applyPatches(json, ensureCmd.patches);
    const addCmd = GraphEdit.addNode({ ...doc, json }, 0, "event/onTick", {});
    json = applyPatches(json, addCmd.patches);
    // Wire the event node's "out" flow to a node index that does not exist.
    const connectCmd = GraphEdit.connectFlow({ ...doc, json }, 0, 0, "out", 1000, "in");
    json = applyPatches(json, connectCmd.patches);

    const report = validateProposalGraph(json, 0);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.severity === "error")).toBe(true);
  });
});
