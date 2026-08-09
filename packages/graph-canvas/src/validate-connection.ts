// Pure connection-validation rule for the canvas's onConnect handler
// (specs/ux-graph-canvas.md's UX-5xx block doesn't number this rule
// directly — it's this task's own "connect" bullet): flow ports only wire
// forward to flow ports; value ports only wire to value ports of an
// EXACTLY matching resolved type. Deliberately simple for v1 — no
// any-numeric-to-float leniency (e.g. int -> float is rejected, same as
// bool -> int): a resolved-but-mismatched concrete type pair is a real
// authoring error the canvas should catch immediately rather than silently
// coerce. A port whose type mapGraph could not resolve (generic chains that
// never got real evidence) is treated permissively (undefined type doesn't
// by itself disqualify a connection) since rejecting it would be a false
// positive, not a real type error.
import type { MappedPort } from "./map-graph.js";

export type ConnectionValidation = { ok: true } | { ok: false; reason: string };

export function validateConnection(source: MappedPort, target: MappedPort): ConnectionValidation {
  const sourceIsFlow = source.kind === "flow-out";
  const targetIsFlow = target.kind === "flow-in";
  if (sourceIsFlow !== targetIsFlow) {
    return { ok: false, reason: `Cannot connect a ${source.kind} port to a ${target.kind} port.` };
  }
  if (sourceIsFlow && targetIsFlow) {
    return { ok: true };
  }
  // Both value ports (source.kind === "value-out", target.kind === "value-in" — the only remaining case
  // GraphView's onConnect ever offers, since it only calls this after matching react-flow handle-kind pairing).
  if (source.type !== undefined && target.type !== undefined && source.type !== target.type) {
    return { ok: false, reason: `Type mismatch: ${source.type} -> ${target.type}.` };
  }
  return { ok: true };
}
