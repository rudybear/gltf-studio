// Pure spatial-audio helpers implementing KHR_audio_environment semantics.
//
// LIFTED VERBATIM (M7, per the program plan's reuse table) from
// /glTF-audio/gltf-webgpu/src/extensions/audio/spatial.ts — this file has no
// imports and no WebGPU/three.js coupling, so it moved across unchanged
// (byte-identical aside from this provenance header). Do not hand-edit
// without checking whether the upstream file changed too.

export type Vec3 = [number, number, number];

export interface ReverbProperties {
  type?: "parametric" | "impulseResponse";
  preset?: string;
  mix?: number;
  decayTime?: number;
  decayHFRatio?: number;
  reflectionsGain?: number;
  reflectionsDelay?: number;
  reverbGain?: number;
  reverbDelay?: number;
  diffusion?: number;
  density?: number;
  audio?: number;
  normalize?: boolean;
}

export interface ResolvedReverbParams {
  mix: number;
  decayTime: number;
  decayHFRatio: number;
  reflectionsGain: number;
  reflectionsDelay: number;
  reverbGain: number;
  reverbDelay: number;
  diffusion: number;
  density: number;
}

const REVERB_DEFAULTS: ResolvedReverbParams = {
  mix: 0.5,
  decayTime: 1.5,
  decayHFRatio: 0.83,
  reflectionsGain: 1.0,
  reflectionsDelay: 0.02,
  reverbGain: 1.0,
  reverbDelay: 0.04,
  diffusion: 1.0,
  density: 1.0
};

export const REVERB_PRESETS: Record<string, Partial<ResolvedReverbParams>> = {
  generic:     { decayTime: 1.49,  decayHFRatio: 0.83, reflectionsDelay: 0.007, reverbDelay: 0.011 },
  smallRoom:   { decayTime: 0.4,   decayHFRatio: 0.83, reflectionsDelay: 0.002, reverbDelay: 0.003 },
  mediumRoom:  { decayTime: 1.1,   decayHFRatio: 0.83, reflectionsDelay: 0.01,  reverbDelay: 0.011 },
  largeRoom:   { decayTime: 4.32,  decayHFRatio: 0.59, reflectionsDelay: 0.02,  reverbDelay: 0.03 },
  bathroom:    { decayTime: 1.49,  decayHFRatio: 0.54, reflectionsDelay: 0.007, reverbDelay: 0.011 },
  concertHall: { decayTime: 3.92,  decayHFRatio: 0.7,  reflectionsDelay: 0.02,  reverbDelay: 0.029 },
  cathedral:   { decayTime: 5.5,   decayHFRatio: 0.6,  reflectionsDelay: 0.025, reverbDelay: 0.04 },
  cave:        { decayTime: 2.91,  decayHFRatio: 1.3,  reflectionsDelay: 0.015, reverbDelay: 0.022 },
  arena:       { decayTime: 7.24,  decayHFRatio: 0.33, reflectionsDelay: 0.02,  reverbDelay: 0.03 },
  hangar:      { decayTime: 10.05, decayHFRatio: 0.23, reflectionsDelay: 0.02,  reverbDelay: 0.03 },
  corridor:    { decayTime: 1.79,  decayHFRatio: 0.59, reflectionsDelay: 0.007, reverbDelay: 0.011 },
  forest:      { decayTime: 1.49,  decayHFRatio: 0.54, reflectionsDelay: 0.162, reverbDelay: 0.088 },
  underwater:  { decayTime: 1.49,  decayHFRatio: 0.1,  reflectionsDelay: 0.007, reverbDelay: 0.011 }
};

export function resolveReverbParams(reverb: ReverbProperties | undefined): ResolvedReverbParams {
  const preset = reverb?.preset ? REVERB_PRESETS[reverb.preset] : undefined;
  const merged: ResolvedReverbParams = { ...REVERB_DEFAULTS, ...preset };
  if (!reverb) {
    return merged;
  }
  for (const key of Object.keys(REVERB_DEFAULTS) as Array<keyof ResolvedReverbParams>) {
    const value = (reverb as Record<string, unknown>)[key];
    if (typeof value === "number") {
      merged[key] = value;
    }
  }
  return merged;
}

export interface ZoneShape {
  type: string;
  size?: Vec3;
  radius?: number;
}

export interface ZoneBinding {
  environmentIndex: number;
  shape: ZoneShape;
  blendDistance: number;
  priority: number;
  nodeIndex: number;
}

function rotateVecByQuat(v: Vec3, q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx)
  ];
}

export function quatRotate(v: Vec3, q: [number, number, number, number]): Vec3 {
  return rotateVecByQuat(v, q);
}

export function quatConjugateRotate(v: Vec3, q: [number, number, number, number]): Vec3 {
  return rotateVecByQuat(v, [-q[0], -q[1], -q[2], q[3]]);
}

/** Signed distance to the zone boundary in local units; negative = inside. */
export function distanceToZoneBoundary(localPoint: Vec3, shape: ZoneShape): number {
  if (shape.type === "sphere") {
    const radius = shape.radius ?? 0;
    return Math.hypot(localPoint[0], localPoint[1], localPoint[2]) - radius;
  }
  if (shape.type === "box") {
    const half = (shape.size ?? [0, 0, 0]).map((v) => v / 2);
    const q: Vec3 = [
      Math.abs(localPoint[0]) - half[0],
      Math.abs(localPoint[1]) - half[1],
      Math.abs(localPoint[2]) - half[2]
    ];
    const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
    const inside = Math.min(Math.max(q[0], q[1], q[2]), 0);
    return outside + inside;
  }
  return Number.POSITIVE_INFINITY;
}

export function zoneVolume(shape: ZoneShape): number {
  if (shape.type === "sphere") {
    const radius = shape.radius ?? 0;
    return (4 / 3) * Math.PI * radius ** 3;
  }
  if (shape.type === "box") {
    const size = shape.size ?? [0, 0, 0];
    return size[0] * size[1] * size[2];
  }
  return Number.POSITIVE_INFINITY;
}

export interface ZoneSelection {
  environmentIndex?: number;
  blendToOutside: number;
  outsideEnvironmentIndex?: number;
}

/**
 * Zone selection per spec 2.3: listener position picks the zone; highest
 * priority wins, ties go to the smallest volume; scene default otherwise.
 * `localize` maps the listener's world position into a zone's local space.
 */
export function selectEnvironment(
  zones: ZoneBinding[],
  defaultEnvironmentIndex: number | undefined,
  listenerWorldPos: Vec3,
  localize: (zone: ZoneBinding, world: Vec3) => Vec3
): ZoneSelection {
  const containing: Array<{ zone: ZoneBinding; depth: number }> = [];
  for (const zone of zones) {
    const local = localize(zone, listenerWorldPos);
    const distance = distanceToZoneBoundary(local, zone.shape);
    if (distance <= 0) {
      containing.push({ zone, depth: -distance });
    }
  }
  if (containing.length === 0) {
    return { environmentIndex: defaultEnvironmentIndex, blendToOutside: 0 };
  }
  containing.sort((a, b) => {
    if (b.zone.priority !== a.zone.priority) {
      return b.zone.priority - a.zone.priority;
    }
    return zoneVolume(a.zone.shape) - zoneVolume(b.zone.shape);
  });
  const winner = containing[0];
  const runnerUp = containing[1];
  const outsideEnvironmentIndex = runnerUp ? runnerUp.zone.environmentIndex : defaultEnvironmentIndex;
  let blendToOutside = 0;
  if (winner.zone.blendDistance > 0 && winner.depth < winner.zone.blendDistance) {
    blendToOutside = 1 - winner.depth / winner.zone.blendDistance;
  }
  return { environmentIndex: winner.zone.environmentIndex, blendToOutside, outsideEnvironmentIndex };
}

export interface DopplerProperties {
  enabled?: boolean;
  scale?: number;
  speedOfSound?: number;
}

/** Doppler per spec 2.5: pitch = (c + s·vL) / (c − s·vS); positive = approaching. */
export function computeDopplerPitch(
  doppler: DopplerProperties | undefined,
  listenerPos: Vec3,
  listenerVel: Vec3,
  emitterPos: Vec3,
  emitterVel: Vec3
): number {
  if (!doppler?.enabled) {
    return 1.0;
  }
  const c = doppler.speedOfSound ?? 343.0;
  const s = doppler.scale ?? 1.0;
  const dx = emitterPos[0] - listenerPos[0];
  const dy = emitterPos[1] - listenerPos[1];
  const dz = emitterPos[2] - listenerPos[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance === 0) {
    return 1.0;
  }
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const vL = listenerVel[0] * nx + listenerVel[1] * ny + listenerVel[2] * nz;
  const vS = -(emitterVel[0] * nx + emitterVel[1] * ny + emitterVel[2] * nz);
  const denom = Math.max(c - s * vS, 1e-3);
  const numer = Math.max(c + s * vL, 0);
  return numer / denom;
}

const FULL_BANDWIDTH_HZ = 20000;

/** Air absorption per spec 3.4: 20 kHz at refDistance → cutoff at maxDistance, log-interpolated. */
export function computeAirAbsorptionCutoff(
  refDistance: number,
  maxDistance: number,
  cutoffAtMaxDistance: number,
  distance: number
): number {
  if (!(maxDistance > refDistance) || !(cutoffAtMaxDistance > 0)) {
    return FULL_BANDWIDTH_HZ;
  }
  const fraction = Math.min(Math.max((distance - refDistance) / (maxDistance - refDistance), 0), 1);
  return Math.exp(Math.log(FULL_BANDWIDTH_HZ) + fraction * (Math.log(cutoffAtMaxDistance) - Math.log(FULL_BANDWIDTH_HZ)));
}

/** Cone low-pass per spec 3.4. Angles are diameters in radians. */
export function computeConeCutoff(
  coneInnerAngle: number,
  coneOuterAngle: number,
  coneOuterCutoff: number | undefined,
  offAxisAngle: number
): number {
  if (!(typeof coneOuterCutoff === "number" && coneOuterCutoff > 0)) {
    return FULL_BANDWIDTH_HZ;
  }
  const innerHalf = coneInnerAngle / 2;
  const outerHalf = coneOuterAngle / 2;
  if (offAxisAngle <= innerHalf) {
    return FULL_BANDWIDTH_HZ;
  }
  if (offAxisAngle >= outerHalf || outerHalf <= innerHalf) {
    return coneOuterCutoff;
  }
  const fraction = (offAxisAngle - innerHalf) / (outerHalf - innerHalf);
  return Math.exp(Math.log(FULL_BANDWIDTH_HZ) + fraction * (Math.log(coneOuterCutoff) - Math.log(FULL_BANDWIDTH_HZ)));
}

export function combineCutoffs(a: number, b: number): number {
  return Math.min(a, b);
}

/** Custom distance curve per spec 3.3: uniform samples refDistance→maxDistance, lerped. */
export function sampleDistanceCurve(
  curve: number[],
  refDistance: number,
  maxDistance: number,
  distance: number
): number {
  if (curve.length === 0) {
    return 1;
  }
  if (curve.length === 1 || !(maxDistance > refDistance)) {
    return curve[0];
  }
  const fraction = Math.min(Math.max((distance - refDistance) / (maxDistance - refDistance), 0), 1);
  const position = fraction * (curve.length - 1);
  const index = Math.floor(position);
  if (index >= curve.length - 1) {
    return curve[curve.length - 1];
  }
  const t = position - index;
  return curve[index] * (1 - t) + curve[index + 1] * t;
}
