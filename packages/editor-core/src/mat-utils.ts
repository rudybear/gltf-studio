// Minimal column-major Mat4/Quat/Vec3 helpers needed by `scene-edit.ts`'s
// `reparentNode` (DOC-052) to preserve a node's WORLD transform across a
// reparent. `packages/editor-core` stays dependency-free (no three.js, no
// gl-matrix — see this package's own header comment / `document.ts`'s
// purity requirements), so these are hand-rolled rather than imported.
//
// `mat4Identity`/`mat4Multiply`/`mat4Invert`/`mat4FromTranslationRotationScale`/
// `vec3TransformMat4` are LIFTED, verbatim, from
// `/glTF-audio/gltf-webgpu/src/renderer/math.ts` — the same source
// `packages/audio-webaudio/src/math.ts` already lifts `mat4Invert`/
// `vec3TransformMat4` from (see that file's own header comment) — reusing
// its exact element layout/convention: column-major, `m[0..2]`/`m[4..6]`/
// `m[8..10]` are the local X/Y/Z basis columns (each already scaled), `m[12..14]`
// is translation, matching glTF's own `node.matrix` layout so a node's
// `matrix` array can be read directly into a `Mat4` with no reordering.
//
// `mat4Decompose` is NOT lifted from that source (which has no decompose of
// its own) — it reimplements the standard matrix-to-TRS algorithm three.js's
// `Matrix4.decompose`/`Quaternion.setFromRotationMatrix` use (a well-known,
// public-domain construction: column lengths for scale, a determinant-sign
// flip on the first scale component for a mirrored/negatively-scaled matrix,
// then Shepperd's trace method for the normalized rotation submatrix ->
// quaternion), written directly against this file's own column-major layout.
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export function mat4Identity(): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i += 1) {
    const ai0 = a[i];
    const ai1 = a[i + 4];
    const ai2 = a[i + 8];
    const ai3 = a[i + 12];
    out[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
    out[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
    out[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
  return out;
}

export function mat4FromTranslationRotationScale(translation: Vec3, rotation: Quat, scale: Vec3): Mat4 {
  const [tx, ty, tz] = translation;
  const [qx, qy, qz, qw] = rotation;
  const [sx, sy, sz] = scale;

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  const out = new Float32Array(16);
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
  return out;
}

export function mat4Invert(m: Mat4): Mat4 | null {
  const out = new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0) {
    return null;
  }
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function vec3TransformMat4(m: Mat4, v: Vec3): Vec3 {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = w ? 1 / w : 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw
  ];
}

/**
 * Decomposes an affine `Mat4` into translation + rotation quaternion +
 * scale, tolerant of a mirrored (negative-determinant) matrix — the product
 * of an ancestor chain that itself carries a negative scale somewhere is a
 * legitimate, if unusual, glTF scene. See this file's header comment for
 * the algorithm's provenance.
 */
export function mat4Decompose(m: Mat4): { translation: Vec3; rotation: Quat; scale: Vec3 } {
  const translation: Vec3 = [m[12], m[13], m[14]];

  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);

  // Determinant of the upper-left 3x3 (the affine matrix's own determinant,
  // since the bottom row is always (0,0,0,1) for every matrix this file
  // ever builds/consumes) — negative means an odd number of axis flips is
  // baked into this transform; three.js's own `Matrix4.decompose` folds
  // that sign entirely into `sx` so `rotation` alone stays a pure rotation.
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  if (det < 0) sx = -sx;

  const invSX = sx !== 0 ? 1 / sx : 0;
  const invSY = sy !== 0 ? 1 / sy : 0;
  const invSZ = sz !== 0 ? 1 / sz : 0;

  // Rotation-only matrix, normalized columns (each basis column divided by
  // its own scale factor). Named `m11`.."m33" in (row,col) order to match
  // three.js's `Quaternion.setFromRotationMatrix` derivation directly.
  const m11 = m[0] * invSX, m21 = m[1] * invSX, m31 = m[2] * invSX;
  const m12 = m[4] * invSY, m22 = m[5] * invSY, m32 = m[6] * invSY;
  const m13 = m[8] * invSZ, m23 = m[9] * invSZ, m33 = m[10] * invSZ;

  const trace = m11 + m22 + m33;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m32 - m23) * s;
    y = (m13 - m31) * s;
    z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }

  return { translation, rotation: [x, y, z, w], scale: [sx, sy, sz] };
}
