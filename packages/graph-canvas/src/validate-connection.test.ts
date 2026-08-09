import { describe, expect, it } from "vitest";
import { validateConnection } from "./validate-connection.js";
import type { MappedPort } from "./map-graph.js";

function port(kind: MappedPort["kind"], type?: string): MappedPort {
  return { id: `${kind}:x`, name: "x", kind, type };
}

describe("validateConnection", () => {
  it("accepts flow-out -> flow-in", () => {
    expect(validateConnection(port("flow-out"), port("flow-in"))).toEqual({ ok: true });
  });

  it("rejects flow-out -> value-in (mismatched port class)", () => {
    const result = validateConnection(port("flow-out"), port("value-in"));
    expect(result.ok).toBe(false);
  });

  it("rejects value-out -> flow-in (mismatched port class)", () => {
    const result = validateConnection(port("value-out"), port("flow-in"));
    expect(result.ok).toBe(false);
  });

  it("accepts value-out -> value-in when resolved types match exactly", () => {
    expect(validateConnection(port("value-out", "float"), port("value-in", "float"))).toEqual({ ok: true });
  });

  it("rejects value-out -> value-in when resolved types differ (no numeric leniency in v1)", () => {
    const result = validateConnection(port("value-out", "int"), port("value-in", "float"));
    expect(result.ok).toBe(false);
  });

  it("accepts value-out -> value-in when either side's type is unresolved", () => {
    expect(validateConnection(port("value-out", undefined), port("value-in", "float"))).toEqual({ ok: true });
    expect(validateConnection(port("value-out", "float"), port("value-in", undefined))).toEqual({ ok: true });
  });
});
