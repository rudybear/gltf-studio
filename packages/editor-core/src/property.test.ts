// Property tests (DOC-032, DOC-033, DOC-034). Builds a synthetic container
// via `@gltfi/gltf`'s real `writeContainer`/`parseContainer` (test-fixtures.ts)
// and drives random sequences of commands built exclusively from the
// implemented `GraphEdit`/`SceneEdit` factories — never a hand-rolled patch.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Command } from "./command.js";
import { applyCommand, createDocument, type EditorDocument } from "./document.js";
import { GraphEdit } from "./graph-edit.js";
import { HistoryStack } from "./history.js";
import { deepEqualJson, typedPathFromPointer } from "./json-pointer.js";
import { applyPatches } from "./patch.js";
import { save } from "./save.js";
import { SceneEdit } from "./scene-edit.js";
import { containerFromJson, fixtureGltfJson } from "./test-fixtures.js";
import { locateJsonSpan } from "@gltfi/gltf";

const OPS = ["event/onStart", "event/onTick", "math/add", "math/multiply"];

type Step =
  | { kind: "addNode"; opIndex: number; x: number; y: number }
  | { kind: "removeNode"; pick: number }
  | { kind: "connectFlow"; from: number; to: number; fromSocket: string; toSocket: string }
  | { kind: "connectValue"; node: number; source: number; socket: string }
  | { kind: "disconnect"; node: number; socket: string; which: 0 | 1 }
  | { kind: "setLiteral"; node: number; socket: string; value: number }
  | { kind: "setNodePosition"; node: number; x: number; y: number }
  | { kind: "addVariable"; id: string; value: number }
  | { kind: "addCustomEvent"; id: string }
  | { kind: "setTransform"; node: number; x: number }
  | { kind: "setName"; node: number; name: string }
  | { kind: "setMaterialProperty"; value: number }
  | { kind: "setAudioEmitterProperty"; value: number };

const socketArb = fc.constantFrom("a", "b", "c", "out", "in");
const nonNegInt = fc.integer({ min: 0, max: 1000 });

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("addNode" as const), opIndex: fc.integer({ min: 0, max: OPS.length - 1 }), x: fc.integer(), y: fc.integer() }),
  fc.record({ kind: fc.constant("removeNode" as const), pick: nonNegInt }),
  fc.record({ kind: fc.constant("connectFlow" as const), from: nonNegInt, to: nonNegInt, fromSocket: socketArb, toSocket: socketArb }),
  fc.record({ kind: fc.constant("connectValue" as const), node: nonNegInt, source: nonNegInt, socket: socketArb }),
  fc.record({ kind: fc.constant("disconnect" as const), node: nonNegInt, socket: socketArb, which: fc.constantFrom(0 as const, 1 as const) }),
  fc.record({ kind: fc.constant("setLiteral" as const), node: nonNegInt, socket: socketArb, value: fc.integer() }),
  fc.record({ kind: fc.constant("setNodePosition" as const), node: nonNegInt, x: fc.integer(), y: fc.integer() }),
  fc.record({ kind: fc.constant("addVariable" as const), id: fc.string({ minLength: 1, maxLength: 6 }), value: fc.integer() }),
  fc.record({ kind: fc.constant("addCustomEvent" as const), id: fc.string({ minLength: 1, maxLength: 6 }) }),
  fc.record({ kind: fc.constant("setTransform" as const), node: nonNegInt, x: fc.integer() }),
  fc.record({ kind: fc.constant("setName" as const), node: nonNegInt, name: fc.string({ maxLength: 8 }) }),
  fc.record({ kind: fc.constant("setMaterialProperty" as const), value: fc.integer() }),
  fc.record({ kind: fc.constant("setAudioEmitterProperty" as const), value: fc.integer() })
);

interface Model {
  graphNodeCount: number;
}

const SCENE_NODE_COUNT = 2; // fixed by the fixture

/** Maps a raw generated `Step` onto the CURRENT document's valid index ranges and builds the corresponding Command, or returns `undefined` for a step that's a no-op given current state (e.g. removing from an empty graph). */
function interpretStep(document: EditorDocument, step: Step, model: Model): Command | undefined {
  const n = model.graphNodeCount;
  switch (step.kind) {
    case "addNode":
      model.graphNodeCount += 1;
      return GraphEdit.addNode(document, 0, OPS[step.opIndex], { position: { x: step.x, y: step.y } });
    case "removeNode": {
      if (n === 0) return undefined;
      model.graphNodeCount -= 1;
      return GraphEdit.removeNode(document, 0, step.pick % n);
    }
    case "connectFlow":
      if (n === 0) return undefined;
      return GraphEdit.connectFlow(document, 0, step.from % n, step.fromSocket, step.to % n, step.toSocket);
    case "connectValue":
      if (n === 0) return undefined;
      return GraphEdit.connectValue(document, 0, step.node % n, step.socket, step.source % n);
    case "disconnect": {
      if (n === 0) return undefined;
      try {
        return GraphEdit.disconnect(document, 0, step.node % n, step.socket, step.which === 0 ? "value" : "flow");
      } catch {
        return undefined; // nothing wired at that socket right now — not a failure, just skip this step.
      }
    }
    case "setLiteral":
      if (n === 0) return undefined;
      return GraphEdit.setLiteral(document, 0, step.node % n, step.socket, { type: 0, value: [step.value] });
    case "setNodePosition":
      if (n === 0) return undefined;
      return GraphEdit.setNodePosition(document, 0, step.node % n, step.x, step.y);
    case "addVariable":
      return GraphEdit.addVariable(document, 0, { id: step.id, type: 0, value: [step.value] });
    case "addCustomEvent":
      return GraphEdit.addCustomEvent(document, 0, { id: step.id });
    case "setTransform":
      return SceneEdit.setTransform(document, step.node % SCENE_NODE_COUNT, { translation: [step.x, 0, 0] });
    case "setName":
      return SceneEdit.setName(document, step.node % SCENE_NODE_COUNT, step.name);
    case "setMaterialProperty":
      return SceneEdit.setMaterialProperty(document, 0, ["extras", "probe"], step.value);
    case "setAudioEmitterProperty":
      return SceneEdit.setAudioEmitterProperty(document, 0, ["gain"], step.value);
  }
}

function freshDocument(): EditorDocument {
  return createDocument(containerFromJson(fixtureGltfJson()));
}

describe("property: command+inverse round-trip (DOC-032)", () => {
  it("applying patches then inverse restores the pre-command json, for every command in a random sequence", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        let document = freshDocument();
        const model: Model = { graphNodeCount: 2 };
        for (const step of steps) {
          const command = interpretStep(document, step, model);
          if (!command) continue;
          const before = document.json;
          const after = applyPatches(before, command.patches);
          const restored = applyPatches(after, command.inverse);
          expect(deepEqualJson(restored, before)).toBe(true);
          document = applyCommand(document, command);
        }
      }),
      { numRuns: 200 }
    );
  });
});

describe("property: undo-all ≡ initial (DOC-033)", () => {
  it("undoing once per pushed command restores the starting json, for every random sequence", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        const initial = freshDocument();
        const stack = new HistoryStack(initial);
        const model: Model = { graphNodeCount: 2 };
        let pushCount = 0;
        for (const step of steps) {
          const command = interpretStep(stack.document, step, model);
          if (!command) continue;
          stack.push(command);
          pushCount += 1;
        }
        for (let i = 0; i < pushCount; i += 1) stack.undo();
        expect(deepEqualJson(stack.document.json, initial.json)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});

describe("property: save invariant (DOC-034)", () => {
  it("reparsing saved bytes deep-equals the in-memory json; splice-mode saves byte-preserve outside dirty roots", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        const initial = freshDocument();
        let document = initial;
        const model: Model = { graphNodeCount: 2 };
        for (const step of steps) {
          const command = interpretStep(document, step, model);
          if (!command) continue;
          document = applyCommand(document, command);
        }

        const { document: saved, report } = save(document);

        // Always true, splice or reserialize: the saved bytes reparse to
        // exactly the in-memory json.
        expect(deepEqualJson(saved.container.json, document.json)).toBe(true);

        // When splicing succeeded with exactly ONE dirty root (no fallback,
        // and no second root whose own edit could otherwise fall inside the
        // "everything after this root" region checked below), the ORIGINAL
        // pristine text outside that root's span is byte-preserved — the
        // other half of DOC-034/DOC-026. (When DOC-025's whole-document
        // reserialize fallback triggers, byte preservation outside dirty
        // roots is explicitly not guaranteed — that is the fallback's whole
        // reason to exist. Multi-root splices are covered by dedicated
        // fixed-scenario tests in save.test.ts instead of here, since
        // checking "outside ALL roots" from a single before/after span pair
        // needs the roots' relative order, not just each root in isolation.)
        if (!report.reserialized && report.splicedRoots.length === 1) {
          const [root] = report.splicedRoots;
          const typedPath = typedPathFromPointer(root, initial.json);
          if (typedPath !== undefined) {
            const span = locateJsonSpan(initial.container.jsonText, typedPath);
            if (span !== undefined) {
              const prefix = initial.container.jsonText.slice(0, span.start);
              const suffix = initial.container.jsonText.slice(span.end);
              expect(saved.container.jsonText.startsWith(prefix)).toBe(true);
              expect(saved.container.jsonText.endsWith(suffix)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
