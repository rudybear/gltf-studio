// Synthetic KHR_interactivity documents shared by this package's own tests.
// Not exported from index.ts (test-only helper) and not itself a
// `*.test.ts` file, so vitest's `include` pattern never picks it up as a
// suite (see packages/editor-core/src/test-fixtures.ts for the identical
// convention this file follows).
//
// Both graphs below are handwritten directly against @gltfi/kernel's
// registry.ts op specs (event/onTick, event/onStart, variable/get,
// variable/set, math/add, pointer/set) — verified end-to-end against the
// real @gltfi/runtime interpreter before being trusted in a test (see this
// package's implementation notes: an out-of-range flow target node index
// reliably throws a TypeError from inside InteractivityRuntime.tick, which
// tickCounterGraph's error-variant fixture below exploits deliberately to
// exercise the "engine-error" diagnostic path).

/** onTick -> variable/get(counter) -> math/add(+1) -> variable/set(counter). Increments `counter` by 1 every tick. */
export function tickCounterGltfJson(): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "int" }],
            variables: [{ id: "counter", type: 0, value: [0] }],
            events: [],
            declarations: [
              { op: "event/onTick" },
              { op: "variable/get" },
              { op: "math/add" },
              { op: "variable/set" }
            ],
            nodes: [
              { declaration: 0, configuration: {}, values: {}, flows: { out: { node: 3, socket: "in" } } },
              { declaration: 1, configuration: { variable: { value: [0] } }, values: {}, flows: {} },
              {
                declaration: 2,
                configuration: {},
                values: { a: { node: 1, socket: "value" }, b: { type: 0, value: [1] } },
                flows: {}
              },
              {
                declaration: 3,
                configuration: { variables: { value: [0] } },
                values: { "0": { node: 2, socket: "value" } },
                flows: {}
              }
            ]
          }
        ]
      }
    }
  };
}

/** Same shape as tickCounterGltfJson, but onTick's flow targets a node index that doesn't exist -> InteractivityRuntime.tick throws. */
export function throwingTickGltfJson(): Record<string, unknown> {
  const json = tickCounterGltfJson() as {
    extensions: { KHR_interactivity: { graphs: [{ nodes: [{ flows: { out: { node: number } } }] }] } };
  };
  json.extensions.KHR_interactivity.graphs[0].nodes[0].flows.out.node = 999;
  return json;
}

/** onStart -> pointer/set("/test/pointer", 42). Fires exactly once, synchronously, from InteractivityRuntime.start(). */
export function onStartPointerSetGltfJson(pointer = "/test/pointer", value = 42): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "int" }],
            variables: [],
            events: [],
            declarations: [{ op: "event/onStart" }, { op: "pointer/set" }],
            nodes: [
              { declaration: 0, configuration: {}, values: {}, flows: { out: { node: 1, socket: "in" } } },
              {
                declaration: 1,
                configuration: { pointer: { value: [pointer] }, type: { value: [0] } },
                values: { value: { type: 0, value: [value] } },
                flows: {}
              }
            ]
          }
        ]
      }
    }
  };
}

/** onTick -> pointer/set("/test/pointer", 42). Fires on every tick (unlike onStartPointerSetGltfJson's once-only fire). */
export function onTickPointerSetGltfJson(pointer = "/test/pointer", value = 42): Record<string, unknown> {
  return {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_interactivity"],
    extensions: {
      KHR_interactivity: {
        graph: 0,
        graphs: [
          {
            types: [{ signature: "int" }],
            variables: [],
            events: [],
            declarations: [{ op: "event/onTick" }, { op: "pointer/set" }],
            nodes: [
              { declaration: 0, configuration: {}, values: {}, flows: { out: { node: 1, socket: "in" } } },
              {
                declaration: 1,
                configuration: { pointer: { value: [pointer] }, type: { value: [0] } },
                values: { value: { type: 0, value: [value] } },
                flows: {}
              }
            ]
          }
        ]
      }
    }
  };
}

/** A document with no KHR_interactivity extension at all — start() should reject clearly. */
export function noGraphGltfJson(): Record<string, unknown> {
  return { asset: { version: "2.0" } };
}
