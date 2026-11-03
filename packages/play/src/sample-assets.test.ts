// PC-012: load-time validation (spec "Validation") means every starter-gallery asset must be
// spec-valid, or Play refuses it. Guards samples/*.glb against regressing to an old generator output
// (e.g. champagne.glb once shipped `events: []`, which the validator rejects).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InteractivityRuntime, resolveGraph, validateExtension } from "@gltfi/runtime";

const samplesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../samples");

function glbJson(name: string): { json: Record<string, unknown>; bin: Uint8Array | null } {
  const buf = readFileSync(resolve(samplesDir, name));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8")) as Record<string, unknown>;
  const binStart = 20 + jsonLen;
  const bin = binStart + 8 <= buf.byteLength ? new Uint8Array(buf.subarray(binStart + 8, binStart + 8 + view.getUint32(binStart, true))) : null;
  return { json, bin };
}

describe("starter gallery assets are spec-valid KHR_interactivity (PC-012)", () => {
  for (const name of ["playground.glb", "r4-racer.glb", "champagne.glb"]) {
    it(`${name}: validateExtension accepts it, and the interpreter loads + starts it`, () => {
      const { json, bin } = glbJson(name);
      const ext = (json.extensions as { KHR_interactivity?: unknown } | undefined)?.KHR_interactivity;
      expect(ext).toBeDefined();
      const result = validateExtension(ext);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(result.ok).toBe(true);
      const graph = resolveGraph(json);
      const runtime = new InteractivityRuntime(graph, json, bin);
      runtime.bindAdapter({ applyPointer: () => undefined });
      runtime.start();
      runtime.tick(1 / 60);
    });
  }
});
