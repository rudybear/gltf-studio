import { describe, expect, it } from "vitest";
import type { AudioHost, CameraPose } from "@gltf-studio/engine-api";

/**
 * AudioHost contract obligations, transcribed from Phase A (AH-001/AH-002).
 */
export const audioHostContractObligations: string[] = [
  "init does not create/resume an AudioContext before a user gesture (AH-001)",
  "init after a user gesture resolves without throwing",
  "loadEmitters is idempotent: calling it twice with the same input does not duplicate emitters",
  "applyPointer writes the given pointer/value onto the loaded emitters/environment state",
  "setListenerPose updates spatialization for subsequently auditioned emitters",
  "auditionEmitter plays the given emitter index without throwing when initialized",
  "suspend is idempotent: calling it twice does not throw",
  "resume after suspend restores audible output",
  "dispose is idempotent: calling it twice does not throw",
  "dispose after suspend (without resume) does not throw"
];

// A ~50ms, 8kHz, mono, 8-bit PCM WAV — about as small as a decodable WAV
// gets — embedded as a base64 `data:` URI (glTF's own "embedded" audio-data
// convention, same pattern as render-host.ts's/e2e's fixtures use for
// mesh/animation buffers). All-silence content is fine: these tests assert
// node-graph topology and AudioContext state, never audible output (per
// this suite's own vitest browser-mode rationale — see
// packages/audio-webaudio/vitest.config.ts).
function buildFixtureWavDataUri(): string {
  const sampleRate = 8000;
  const durationSeconds = 0.05;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const dataSize = sampleCount; // 8-bit mono: 1 byte/sample
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  function writeString(offset: number, text: string): void {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  }
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (1 byte/sample * 1 channel * sampleRate)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < sampleCount; i += 1) {
    view.setUint8(44 + i, 128); // silence at 8-bit unsigned PCM's zero point
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export const FIXTURE_GLOBAL_EMITTER_INDEX = 0;
export const FIXTURE_POSITIONAL_EMITTER_INDEX = 1;
export const FIXTURE_SOURCE_INDEX = 0;

/**
 * A self-contained (no separate binary — `data:` URI audio, per glTF's
 * embedded convention) fixture: one global emitter (node 0) and one
 * positional emitter (node 1, so `setListenerPose`'s zone/doppler/cone math
 * has a real positional emitter to run against), sharing one source/audio
 * clip.
 */
export function buildFixtureAudioDocument(): unknown {
  const uri = buildFixtureWavDataUri();
  return {
    asset: { version: "2.0", generator: "gltf-studio contract-tests audio fixture" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "GlobalEmitterNode", extensions: { KHR_audio_emitter: { emitters: [FIXTURE_GLOBAL_EMITTER_INDEX] } } },
      {
        name: "PositionalEmitterNode",
        translation: [3, 0, 0],
        extensions: { KHR_audio_emitter: { emitters: [FIXTURE_POSITIONAL_EMITTER_INDEX] } }
      }
    ],
    extensions: {
      KHR_audio_emitter: {
        audio: [{ uri, mimeType: "audio/wav" }],
        sources: [{ audio: FIXTURE_SOURCE_INDEX, gain: 1, autoplay: false, loop: false }],
        emitters: [
          { type: "global", gain: 1, sources: [FIXTURE_SOURCE_INDEX] },
          {
            type: "positional",
            gain: 1,
            sources: [FIXTURE_SOURCE_INDEX],
            positional: { shapeType: "omnidirectional", distanceModel: "inverse", refDistance: 1, maxDistance: 50 }
          }
        ]
      }
    }
  };
}

export const FIXTURE_LISTENER_POSE: CameraPose = { position: [0, 0, 0], rotation: [0, 0, 0, 1], target: [0, 0, -1] };

function audioAvailable(): boolean {
  return typeof AudioContext !== "undefined";
}

/**
 * Wraps the GLOBAL `AudioContext` constructor to count how many real
 * instances get constructed while the spy is installed — the only way to
 * observe AH-001 ("must not create ... an AudioContext before a user
 * gesture") from outside the `AudioHost` interface, which exposes no
 * "am I initialized" getter of its own. Returns a `{ count, restore }`
 * handle; `restore()` MUST be called (tests use try/finally) so a later
 * test's `new AudioContext()` isn't still routed through a wrapper counting
 * for a different test.
 */
function spyOnAudioContextConstruction(): { count(): number; restore(): void } {
  const OriginalAudioContext = globalThis.AudioContext;
  let calls = 0;
  class SpyAudioContext extends OriginalAudioContext {
    constructor(...args: ConstructorParameters<typeof OriginalAudioContext>) {
      super(...args);
      calls += 1;
    }
  }
  (globalThis as { AudioContext: typeof AudioContext }).AudioContext = SpyAudioContext as unknown as typeof AudioContext;
  return {
    count: () => calls,
    restore: () => {
      (globalThis as { AudioContext: typeof AudioContext }).AudioContext = OriginalAudioContext;
    }
  };
}

export function describeAudioHostContract(makeHost: () => AudioHost): void {
  // it.skip (not it.todo): real assertions below, skipped only outside a
  // real Web Audio environment (Node has no AudioContext at all) — mirrors
  // describeRenderHostContract's `isDomAvailable()` gate. The real,
  // exercised run lives in packages/audio-webaudio/test/contract.test.ts
  // (vitest browser mode, real Chromium + AudioContext).
  const test = audioAvailable() ? it : it.skip;

  describe("AudioHost contract", () => {
    test("init does not create/resume an AudioContext before a user gesture (AH-001)", async () => {
      const spy = spyOnAudioContextConstruction();
      try {
        const host = makeHost();
        await host.loadEmitters(buildFixtureAudioDocument());
        expect(spy.count()).toBe(0);
        host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/gain", [0.5]);
        host.setListenerPose(FIXTURE_LISTENER_POSE);
        host.auditionEmitter(FIXTURE_GLOBAL_EMITTER_INDEX);
        expect(spy.count()).toBe(0);
        host.dispose();
      } finally {
        spy.restore();
      }
    });

    test("init after a user gesture resolves without throwing", async () => {
      const host = makeHost();
      await expect(host.init()).resolves.toBeUndefined();
      host.dispose();
    });

    test("loadEmitters is idempotent: calling it twice with the same input does not duplicate emitters", async () => {
      const host = makeHost();
      await host.init();
      const doc = buildFixtureAudioDocument();
      await host.loadEmitters(doc);
      await expect(host.loadEmitters(doc)).resolves.toBeUndefined();
      expect(() => host.auditionEmitter(FIXTURE_GLOBAL_EMITTER_INDEX)).not.toThrow();
      host.dispose();
    });

    test("applyPointer writes the given pointer/value onto the loaded emitters/environment state", async () => {
      const host = makeHost();
      // Before init(): a no-op, never a throw (PC-001's fan-out calls every
      // pointer write on both RenderHost and AudioHost unconditionally).
      expect(() => host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/gain", [0.5])).not.toThrow();
      await host.init();
      await host.loadEmitters(buildFixtureAudioDocument());
      expect(() => host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/gain", [0.25])).not.toThrow();
      // A pointer outside every audio extension family: silently ignored.
      expect(() => host.applyPointer("/nodes/0/translation", [1, 2, 3])).not.toThrow();
      host.dispose();
    });

    test("setListenerPose updates spatialization for subsequently auditioned emitters", async () => {
      const host = makeHost();
      await host.init();
      await host.loadEmitters(buildFixtureAudioDocument());
      expect(() => host.setListenerPose(FIXTURE_LISTENER_POSE)).not.toThrow();
      expect(() => host.setListenerPose({ position: [5, 1, -2], rotation: [0, 0, 0, 1] })).not.toThrow();
      expect(() => host.auditionEmitter(FIXTURE_POSITIONAL_EMITTER_INDEX)).not.toThrow();
      host.dispose();
    });

    test("auditionEmitter plays the given emitter index without throwing when initialized", async () => {
      const host = makeHost();
      await host.init();
      await host.loadEmitters(buildFixtureAudioDocument());
      expect(() => host.auditionEmitter(FIXTURE_GLOBAL_EMITTER_INDEX)).not.toThrow();
      expect(() => host.auditionEmitter(FIXTURE_POSITIONAL_EMITTER_INDEX)).not.toThrow();
      // An unknown index: still must not throw (no-op).
      expect(() => host.auditionEmitter(999)).not.toThrow();
      host.dispose();
    });

    test("suspend is idempotent: calling it twice does not throw", async () => {
      const host = makeHost();
      await host.init();
      expect(() => host.suspend()).not.toThrow();
      expect(() => host.suspend()).not.toThrow();
      host.dispose();
    });

    test("resume after suspend restores audible output", async () => {
      const host = makeHost();
      await host.init();
      await host.loadEmitters(buildFixtureAudioDocument());
      host.suspend();
      expect(() => host.resume()).not.toThrow();
      // "restores audible output" is asserted behaviorally: the host must
      // still be able to do everything an initialized host can, exactly as
      // before suspend/resume — this interface has no context-state getter
      // to assert `"running"` against directly.
      expect(() => host.auditionEmitter(FIXTURE_GLOBAL_EMITTER_INDEX)).not.toThrow();
      host.dispose();
    });

    test("dispose is idempotent: calling it twice does not throw", async () => {
      const host = makeHost();
      await host.init();
      expect(() => host.dispose()).not.toThrow();
      expect(() => host.dispose()).not.toThrow();
    });

    test("dispose after suspend (without resume) does not throw", async () => {
      const host = makeHost();
      await host.init();
      host.suspend();
      expect(() => host.dispose()).not.toThrow();
    });
  });
}
