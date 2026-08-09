import { describe, expect, it } from "vitest";
import { eulerDegToQuat, quatToEulerDeg, type Quat } from "./transform-math.js";

function normalize(q: Quat): Quat {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function expectQuatClose(a: Quat, b: Quat, epsilon = 1e-6): void {
  // A quaternion and its negation represent the SAME rotation — so either
  // sign match is acceptable, not just a component-wise close match.
  const sameSign = a.every((v, i) => Math.abs(v - b[i]) < epsilon);
  const flippedSign = a.every((v, i) => Math.abs(v + b[i]) < epsilon);
  expect(sameSign || flippedSign).toBe(true);
}

describe("quatToEulerDeg / eulerDegToQuat (specs/ux-inspector.md UX-404)", () => {
  it("the identity quaternion decomposes to zero degrees on every axis", () => {
    // `-0`/`0` both mean "zero degrees" here — `atan2`/`asin` can legitimately
    // return signed zero, which `toEqual` (unlike `toBeCloseTo`) treats as
    // distinct from `+0` per `Object.is` semantics.
    const [ex, ey, ez] = quatToEulerDeg([0, 0, 0, 1]);
    expect(ex).toBeCloseTo(0, 10);
    expect(ey).toBeCloseTo(0, 10);
    expect(ez).toBeCloseTo(0, 10);
  });

  it("zero-degree Euler composes to the identity quaternion", () => {
    expect(eulerDegToQuat([0, 0, 0])).toEqual([0, 0, 0, 1]);
  });

  it("round-trips a simple single-axis rotation (90deg about Y)", () => {
    const q = eulerDegToQuat([0, 90, 0]);
    const backToDeg = quatToEulerDeg(q);
    expect(backToDeg[0]).toBeCloseTo(0, 5);
    expect(backToDeg[1]).toBeCloseTo(90, 5);
    expect(backToDeg[2]).toBeCloseTo(0, 5);
  });

  it("round-trips a combined XYZ rotation degrees -> quat -> degrees -> quat (quat is the stable fixed point, not necessarily the degrees)", () => {
    const original: [number, number, number] = [15, -32.5, 47];
    const q1 = eulerDegToQuat(original);
    const degrees2 = quatToEulerDeg(q1);
    const q2 = eulerDegToQuat(degrees2);
    // The intermediate degrees need not equal `original` bit-for-bit (Euler
    // decomposition is not unique), but re-composing them must yield the
    // SAME rotation (quaternion, up to sign) as the first pass — the
    // quaternion is the fixed point this conversion pair preserves.
    expectQuatClose(normalize(q1), normalize(q2));
  });

  it("a node.rotation quaternion straight off a real document decomposes to finite degrees (no NaN from an unnormalized/edge-case quaternion)", () => {
    const q = normalize([0, 0.7071068, 0, 0.7071068]); // 90deg about Y, glTF order
    const [ex, ey, ez] = quatToEulerDeg(q);
    expect(Number.isFinite(ex)).toBe(true);
    expect(Number.isFinite(ey)).toBe(true);
    expect(Number.isFinite(ez)).toBe(true);
    expect(ey).toBeCloseTo(90, 3);
  });
});
