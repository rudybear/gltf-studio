// specs/ux-shell.md UX-132 (PC-012): mapping a load-time InteractivityValidationError onto the "Play blocked" panel's state.
import { describe, expect, it } from "vitest";
import { toPlayBlockedInfo } from "./play-blocked";

describe("toPlayBlockedInfo (UX-132)", () => {
  it("keeps only error-severity diagnostics, carries node index/path, and defaults graphIndex to the played graph (0)", () => {
    const info = toPlayBlockedInfo({
      scope: "extension",
      diagnostics: [
        { severity: "error", code: "GV113", message: "`events` must be a non-empty JSON array", section: "Validation", path: "events", outcome: "rejectExtension" },
        { severity: "warning", code: "GV127", message: "declaration 0 belongs to an extension", section: "Declarations" },
        { severity: "error", code: "GV027", message: "node 5 is missing `variables`", section: "Nodes", nodeIndex: 5, graphIndex: 2, path: "nodes[5].configuration" }
      ]
    });
    expect(info.scope).toBe("extension");
    expect(info.diagnostics).toEqual([
      { code: "GV113", message: "`events` must be a non-empty JSON array", section: "Validation", graphIndex: 0, path: "events" },
      { code: "GV027", message: "node 5 is missing `variables`", section: "Nodes", nodeIndex: 5, graphIndex: 2, path: "nodes[5].configuration" }
    ]);
  });
});
