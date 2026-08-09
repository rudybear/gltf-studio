// Euler<->quaternion conversion for the Inspector's Transform section
// (specs/ux-inspector.md UX-404). The authored document stores
// `node.rotation` as a glTF quaternion `[x, y, z, w]` — that is the format's
// on-disk truth, and the only shape `SceneEdit.setTransform` ever writes or
// reads. UX-404 nonetheless specifies the Rotation row as three plain XYZ
// numeric fields (matching the approved mockup), which for a quaternion
// means showing an Euler-angle editor in degrees over that quaternion truth.
//
// The quaternion is authoritative: nothing here keeps its own separate
// rotation state that could drift from the document. Every render decomposes
// the CURRENT `node.rotation` quaternion to degrees fresh (`quatToEulerDeg`);
// every edit re-composes the three degree fields back to a quaternion
// (`eulerDegToQuat`) before calling `SceneEdit.setTransform`. Because Euler
// angles are a lossy, non-unique representation of a rotation (gimbal lock,
// +-360 wraparound), the displayed degrees can visibly "normalize" after a
// round trip through the quaternion even though the resulting orientation is
// unchanged — an inherent, accepted property of any Euler-over-quaternion
// widget, not a bug in this conversion.
//
// Uses the XYZ intrinsic Tait-Bryan convention — the same order three.js's
// default `Euler` order (and the `Quaternion.setFromEuler`/`Matrix4.compose`
// pair it uses internally) assumes — so a value typed here matches what the
// engine-three viewport (which consumes `THREE.Quaternion` directly for the
// same `node.rotation` field) actually renders.
export type Quat = [number, number, number, number];
export type EulerDeg = [number, number, number];

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Decomposes a glTF rotation quaternion `[x,y,z,w]` to XYZ-order Euler degrees for display. */
export function quatToEulerDeg([x, y, z, w]: Quat): EulerDeg {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  // Rotation-matrix elements implied by the quaternion (no scale factored
  // in) — same derivation three.js's Matrix4.compose uses for the rotation
  // part, laid out here row-major for direct use below.
  const m11 = 1 - 2 * (yy + zz);
  const m12 = 2 * (xy - wz);
  const m13 = 2 * (xz + wy);
  const m22 = 1 - 2 * (xx + zz);
  const m23 = 2 * (yz - wx);
  const m32 = 2 * (yz + wx);
  const m33 = 1 - 2 * (xx + yy);

  const clampedM13 = Math.max(-1, Math.min(1, m13));
  const ey = Math.asin(clampedM13);
  let ex: number;
  let ez: number;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    // Gimbal lock (rotation near +-90deg about Y): X and Z become coupled —
    // matching three.js's own convention, the remaining single degree of
    // freedom is assigned entirely to X, and Z is pinned to 0.
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex * RAD2DEG, ey * RAD2DEG, ez * RAD2DEG];
}

/** Composes XYZ-order Euler degrees back into a glTF rotation quaternion `[x,y,z,w]`. */
export function eulerDegToQuat([xDeg, yDeg, zDeg]: EulerDeg): Quat {
  const x = xDeg * DEG2RAD;
  const y = yDeg * DEG2RAD;
  const z = zDeg * DEG2RAD;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3
  ];
}
