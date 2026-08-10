import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseContainer } from "@gltfi/gltf";
import { buildUsageIndex, graphNodeSceneRef, usageRefPathText, type UsageDocJson, type UsageGraphNode } from "./usage-index.js";

const RACER_GLB_PATH = fileURLToPath(new URL("../../../samples/r4-racer.glb", import.meta.url));

function node(overrides: Partial<UsageGraphNode> & { declaration: number }): UsageGraphNode {
  return overrides;
}

function docWithGraph(nodes: UsageGraphNode[], declarations: Array<{ op: string }>, extra: Partial<UsageDocJson> = {}): UsageDocJson {
  return {
    ...extra,
    extensions: {
      KHR_interactivity: { graphs: [{ declarations, nodes }] }
    }
  };
}

describe("buildUsageIndex (UX-1100..1105)", () => {
  it("attributes a pointer/set node's /nodes/{N} pointer to scene node N, ignoring the component suffix (UX-1100)", () => {
    const json = docWithGraph(
      [node({ declaration: 0, configuration: { pointer: { value: ["/nodes/3/translation/1"] } } })],
      [{ op: "pointer/set" }]
    );
    const index = buildUsageIndex(json);
    expect(index.get(3)).toEqual([{ graphIndex: 0, graphNodeIndex: 0, op: "pointer/set", category: "pointer", kind: "pointer", pathText: "/nodes/3/translation/1" }]);
    expect(index.get(0)).toBeUndefined();
  });

  it("resolves an int-kind pointer TEMPLATE parameter fed by a literal value, but not one fed by a computed value-ref (UX-1100, UX-1105)", () => {
    const literalFed = docWithGraph(
      [node({ declaration: 0, configuration: { pointer: { value: ["/nodes/[nodeIndex]/scale"] } }, values: { nodeIndex: { value: [7] } } })],
      [{ op: "pointer/set" }]
    );
    expect(graphNodeSceneRef("pointer/set", literalFed.extensions!.KHR_interactivity!.graphs![0]!.nodes![0]!, literalFed)).toBe(7);

    const computedFed = docWithGraph(
      [node({ declaration: 0, configuration: { pointer: { value: ["/nodes/[nodeIndex]/scale"] } }, values: { nodeIndex: { node: 2, socket: "value" } } })],
      [{ op: "pointer/set" }]
    );
    expect(buildUsageIndex(computedFed).size).toBe(0);
  });

  it("attributes event/onSelect|onHoverIn|onHoverOut's nodeIndex config, and never the -1 sentinel (UX-1101)", () => {
    const json = docWithGraph(
      [
        node({ declaration: 0, configuration: { nodeIndex: { value: [5] } } }),
        node({ declaration: 1, configuration: { nodeIndex: { value: [-1] } } })
      ],
      [{ op: "event/onSelect" }, { op: "event/onHoverIn" }]
    );
    const index = buildUsageIndex(json);
    expect(index.get(5)?.[0]?.kind).toBe("event-handler");
    expect(index.get(5)?.[0]?.pathText).toBe("nodeIndex: 5");
    expect(index.size).toBe(1); // the -1-configured onHoverIn node is never attributed
  });

  it("reverse-resolves a KHR_audio emitter pointer to the scene node that owns that emitter (UX-1103)", () => {
    const json = docWithGraph(
      [node({ declaration: 0, configuration: { pointer: { value: ["/extensions/KHR_audio/emitters/2/gain"] } } })],
      [{ op: "pointer/set" }],
      { nodes: [{}, { extensions: { KHR_audio_emitter: { emitter: 2 } } }, {}] }
    );
    const index = buildUsageIndex(json);
    expect(index.get(1)?.[0]?.pathText).toBe("/extensions/KHR_audio/emitters/2/gain");
  });

  it("attributes animation/start to every distinct scene node its clip's channels target, deduplicated (UX-1102)", () => {
    const json = docWithGraph(
      [node({ declaration: 0, values: { animation: { value: [0] } } })],
      [{ op: "animation/start" }],
      {
        animations: [
          { name: "Spin", channels: [{ target: { node: 4 } }, { target: { node: 4 } }, { target: { node: 5 } }] }
        ]
      }
    );
    const index = buildUsageIndex(json);
    expect(index.get(4)?.[0]?.kind).toBe("animation");
    expect(index.get(4)?.[0]?.pathText).toBe("animation: 0 (Spin)");
    expect(index.get(5)).toHaveLength(1);
  });

  it("covers every graph in a multi-graph document, tagging each ref with its own graphIndex (UX-1104)", () => {
    const json: UsageDocJson = {
      extensions: {
        KHR_interactivity: {
          graphs: [
            { declarations: [{ op: "pointer/set" }], nodes: [node({ declaration: 0, configuration: { pointer: { value: ["/nodes/1/scale"] } } })] },
            { declarations: [{ op: "pointer/set" }], nodes: [node({ declaration: 0, configuration: { pointer: { value: ["/nodes/1/rotation"] } } })] }
          ]
        }
      }
    };
    const refs = buildUsageIndex(json).get(1);
    expect(refs?.map((r) => r.graphIndex).sort()).toEqual([0, 1]);
  });

  it("never guesses an unrecognized pointer family or an out-of-range animation/emitter index (UX-1105)", () => {
    const json = docWithGraph(
      [
        node({ declaration: 0, configuration: { pointer: { value: ["/materials/2/pbrMetallicRoughness/baseColorFactor"] } } }),
        node({ declaration: 1, values: { animation: { value: [99] } } })
      ],
      [{ op: "pointer/set" }, { op: "animation/start" }]
    );
    expect(buildUsageIndex(json).size).toBe(0);
  });

  it("returns an empty map (never throws) for a document with no KHR_interactivity graphs at all", () => {
    expect(buildUsageIndex({}).size).toBe(0);
    expect(buildUsageIndex({ extensions: {} }).size).toBe(0);
  });

  it("usageRefPathText falls back to the op id for an op family it doesn't special-case", () => {
    expect(usageRefPathText("math/add", { declaration: 0 }, {})).toBe("math/add");
  });
});

describe("buildUsageIndex racer-scale sanity (UX-1113)", () => {
  it("computes r4-racer.glb's real 366-node/one-graph usage index correctly and within a generous time budget", () => {
    const bytes = readFileSync(RACER_GLB_PATH);
    const { json } = parseContainer(new Uint8Array(bytes));
    const doc = json as UsageDocJson;
    const graph = (doc.extensions?.KHR_interactivity?.graphs ?? [])[0];
    expect(graph?.nodes?.length).toBe(366);

    const started = performance.now();
    const index = buildUsageIndex(doc);
    const elapsedMs = performance.now() - started;

    // Real fixture ground truth (verified against the raw asset, see PR
    // description): 3 event/onSelect + 3 event/onHoverIn + 3 event/onHoverOut
    // (one real scene-node target each) + 40 pointer/set nodes (most
    // targeting /materials/*, out of this index's scope per UX-1105 — only
    // the ones addressing /nodes/* count here).
    let totalRefs = 0;
    for (const refs of index.values()) totalRefs += refs.length;
    expect(totalRefs).toBeGreaterThan(0);
    expect(totalRefs).toBeLessThanOrEqual(9 + 40);

    // Generous budget (a real interactive Inspector open should feel
    // instant, well under one animation frame at 60fps/~16ms) — this
    // repo's CI runners are far slower/noisier than a dev machine, so the
    // assertion leaves wide headroom rather than chasing a tight number;
    // see the PR description for the measured figure on a dev machine.
    expect(elapsedMs).toBeLessThan(200);
  });
});
