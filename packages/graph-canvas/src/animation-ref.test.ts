// UX-508 / UX-1118: animation/start|stop's `animation` ref literal is the JSON Pointer "/animations/N".
import { describe, expect, it } from "vitest";
import { animationRefIndex, animationRefPointer } from "./animation-ref.js";
import { validateInteractivityGraph } from "./validation.js";

describe("animation ref literal (UX-508)", () => {
  it("round-trips pointer form and still reads the legacy bare index", () => {
    expect(animationRefPointer(3)).toBe("/animations/3");
    expect(animationRefIndex("/animations/3")).toBe(3);
    expect(animationRefIndex(2)).toBe(2);
    expect(animationRefIndex("/nodes/1")).toBeUndefined();
    expect(animationRefIndex(undefined)).toBeUndefined();
  });

  it("a graph using the pointer form is spec-valid; the old bare-index form is rejected (GV152)", () => {
    const graph = (value: Array<string | number>) => ({
      types: [{ signature: "ref" }, { signature: "float" }],
      declarations: [{ op: "event/onStart" }, { op: "animation/start" }],
      nodes: [
        { declaration: 0, flows: { out: { node: 1, socket: "in" } } },
        {
          declaration: 1,
          values: { animation: { type: 0, value }, startTime: { type: 1, value: [0] }, endTime: { type: 1, value: [1] }, speed: { type: 1, value: [1] } }
        }
      ]
    });
    expect(validateInteractivityGraph(graph(["/animations/0"])).ok).toBe(true);
    expect(validateInteractivityGraph(graph([0])).diagnostics.some((d) => d.code === "GV152")).toBe(true);
  });
});
