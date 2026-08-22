// D2 (specs/ux-debugger.md UX-1505): pure, Node-testable coverage of the
// breakpoint-injection mechanism the debug compiled-play pipeline uses to
// turn a gutter breakpoint into a real DevTools pause (see that function's
// own header comment for why a literal `debugger;` statement, not a CDP
// `setBreakpointByUrl` call, is the only mechanism available here).
import { describe, expect, it } from "vitest";
import { injectBreakpoints } from "./debug-breakpoints.js";

describe("injectBreakpoints (specs/ux-debugger.md UX-1505)", () => {
  it("returns the text unchanged when no lines are requested", () => {
    const text = "a();\nb();\nc();";
    expect(injectBreakpoints(text, [])).toBe(text);
  });

  it("inserts one `debugger;` line immediately before the requested 1-based line", () => {
    const text = "a();\nb();\nc();";
    const result = injectBreakpoints(text, [2]);
    expect(result.split("\n")).toEqual(["a();", "debugger;", "b();", "c();"]);
  });

  it("handles multiple breakpoints without offset drift — every requested line still has its OWN `debugger;` immediately above it, and every other line is otherwise untouched", () => {
    const text = "a();\nb();\nc();\nd();";
    const result = injectBreakpoints(text, [1, 3]);
    expect(result.split("\n")).toEqual(["debugger;", "a();", "b();", "debugger;", "c();", "d();"]);
  });

  it("de-duplicates a line requested more than once — one `debugger;`, not two", () => {
    const text = "a();\nb();";
    const result = injectBreakpoints(text, [2, 2]);
    expect(result.split("\n")).toEqual(["a();", "debugger;", "b();"]);
  });

  it("is order-independent — an unsorted, unsorted-input line list produces the identical result as its sorted form", () => {
    const text = "a();\nb();\nc();\nd();";
    expect(injectBreakpoints(text, [3, 1])).toBe(injectBreakpoints(text, [1, 3]));
  });

  it("silently ignores a stale line past EOF rather than throwing or corrupting the rest of the text", () => {
    const text = "a();\nb();";
    const result = injectBreakpoints(text, [1, 99]);
    expect(result.split("\n")).toEqual(["debugger;", "a();", "b();"]);
  });

  it("ignores non-positive/non-integer lines defensively", () => {
    const text = "a();\nb();";
    expect(injectBreakpoints(text, [0, -1, 1.5])).toBe(text);
  });

  it("every other line's text is byte-for-byte identical to the un-injected source — this is a pure insertion, never a rewrite", () => {
    const text = "function onTick() {\n  V.counter = V.counter + 1;\n}\n";
    const result = injectBreakpoints(text, [2]);
    const withoutInjectedLines = result.split("\n").filter((l) => l !== "debugger;");
    expect(withoutInjectedLines.join("\n")).toBe(text);
  });
});
