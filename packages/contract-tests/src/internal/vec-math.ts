// Minimal, dependency-free vector/quaternion math used only by this
// package's real RenderHost contract assertions (packages/contract-tests/src/render-host.ts)
// — kept implementation-agnostic (no three.js import) since contract-tests
// must stay usable against any future RenderHost implementation, not just
// engine-three. Two things need this:
//   1. RH-016/RH-017's camera pose round-trip test needs a real,
//      non-identity unit quaternion to set/read back.
//   2. RH-003's gizmo drag/commit test needs to know, in SCREEN space,
//      which direction each world axis points for a given camera pose —
//      without any camera-projection API on the RenderHost interface, the
//      best any implementation-agnostic test can do is approximate (ignore
//      perspective foreshortening) using the camera's own look-at basis.
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * The camera's own right/up/forward basis for a `position` looking at
 * `target` (three.js convention: the camera's local -Z axis points from
 * `position` toward `target`, i.e. `forward` below is local +Z).
 */
export function lookAtBasis(position: Vec3, target: Vec3, worldUp: Vec3 = [0, 1, 0]): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = normalize3(subtract3(position, target));
  let right = cross3(worldUp, forward);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) {
    right = [1, 0, 0]; // degenerate: forward parallel to worldUp
  }
  right = normalize3(right);
  const up = cross3(forward, right);
  return { forward, right, up };
}

/** Rotation-matrix-to-quaternion (Shepperd's method), columns = [right, up, -forward]. */
export function lookAtQuaternion(position: Vec3, target: Vec3, worldUp: Vec3 = [0, 1, 0]): Quat {
  const { forward, right, up } = lookAtBasis(position, target, worldUp);
  const m00 = right[0];
  const m10 = right[1];
  const m20 = right[2];
  const m01 = up[0];
  const m11 = up[1];
  const m21 = up[2];
  const m02 = -forward[0];
  const m12 = -forward[1];
  const m22 = -forward[2];

  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** Projects a world-space direction onto a camera's screen-space (x-right, y-down) axes. Ignores perspective foreshortening — good enough for picking a *search direction*, not an exact pixel distance. */
export function worldDirectionToScreen(worldDir: Vec3, basis: { right: Vec3; up: Vec3 }): { dx: number; dy: number } {
  return { dx: dot3(worldDir, basis.right), dy: -dot3(worldDir, basis.up) };
}
