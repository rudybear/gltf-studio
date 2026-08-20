// WebAudioHost behavior beyond the generic AudioHost contract (which can't
// assert anything package-specific): the container-shape loadEmitters input,
// the nonstandard `/playing` one-shot trigger pointer, and the
// KHR_audio_environment machinery (zones/doppler/reverb) not throwing when
// actually present in a document.
import { describe, expect, it } from "vitest";
import { WebAudioHost } from "../src/index.js";

function silentWavBytes(sampleCount = 400): Uint8Array {
  const dataSize = sampleCount;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < sampleCount; i += 1) view.setUint8(44 + i, 128);
  return new Uint8Array(buffer);
}

describe("WebAudioHost extras", () => {
  it("loadEmitters accepts the { json, binary } container shape, resolving bufferView audio against the binary chunk", async () => {
    const wav = silentWavBytes();
    const doc = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "N", extensions: { KHR_audio_emitter: { emitters: [0] } } }],
      buffers: [{ byteLength: wav.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: wav.byteLength }],
      extensions: {
        KHR_audio_emitter: {
          audio: [{ bufferView: 0, mimeType: "audio/wav" }],
          sources: [{ audio: 0 }],
          emitters: [{ type: "global", sources: [0] }]
        }
      }
    };
    const host = new WebAudioHost();
    await host.init();
    await expect(host.loadEmitters({ json: doc, binary: wav.buffer })).resolves.toBeUndefined();
    expect(() => host.auditionEmitter(0)).not.toThrow();
    host.dispose();
  });

  it("applyPointer's nonstandard /sources/{i}/playing trigger fires a one-shot voice without throwing", async () => {
    const wav = silentWavBytes();
    let binary = "";
    for (const byte of wav) binary += String.fromCharCode(byte);
    const uri = `data:audio/wav;base64,${btoa(binary)}`;
    const doc = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "N", extensions: { KHR_audio_emitter: { emitters: [0] } } }],
      extensions: {
        KHR_audio_emitter: {
          audio: [{ uri }],
          sources: [{ audio: 0, loop: false }],
          emitters: [{ type: "global", sources: [0] }]
        }
      }
    };
    const host = new WebAudioHost();
    await host.init();
    await host.loadEmitters(doc);
    expect(() => host.applyPointer("/extensions/KHR_audio_emitter/sources/0/playing", [1])).not.toThrow();
    expect(() => host.applyPointer("/extensions/KHR_audio_emitter/sources/0/playing", [0])).not.toThrow();
    host.dispose();
  });

  it("does not throw when KHR_audio_environment zones/doppler/reverb are present and setListenerPose is called repeatedly", async () => {
    const doc = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1], extensions: { KHR_audio_environment: { environment: 0 } } }],
      nodes: [
        {
          name: "Zone",
          extensions: {
            KHR_audio_environment: { environment: 0, shape: { type: "sphere", radius: 10 }, blendDistance: 2, priority: 1 }
          }
        },
        {
          name: "Emitter",
          translation: [1, 0, 0],
          extensions: { KHR_audio_emitter: { emitters: [0] } }
        }
      ],
      extensions: {
        KHR_audio_emitter: { audio: [], sources: [], emitters: [{ type: "positional", positional: { shapeType: "omnidirectional" } }] },
        KHR_audio_environment: {
          environments: [{ reverb: { preset: "concertHall" }, doppler: { enabled: true } }]
        }
      }
    };
    const host = new WebAudioHost();
    await host.init();
    await host.loadEmitters(doc);
    expect(() => host.setListenerPose({ position: [0, 0, 0], rotation: [0, 0, 0, 1] })).not.toThrow();
    expect(() => host.setListenerPose({ position: [20, 0, 0], rotation: [0, 0, 0, 1] })).not.toThrow();
    host.dispose();
  });
});

/**
 * Emitter/environment authoring (specs/ux-inspector.md UX-419/UX-423,
 * specs/engine-api.md's extended AH-pointer-value-tbd note): the five
 * newly-recognized `positional/*` pointer families apply DIRECTLY onto the
 * live `PannerNode` with no graph rebuild — asserted here by reaching into
 * `WebAudioHost`'s own internal `emitterInstances` (a deliberate white-box
 * check: AH-002 keeps the public `AudioHost` interface minimal on purpose,
 * so "the panner attribute actually changed to the exact value" can't be
 * observed any other way short of measuring rendered audio, which the task
 * this covers explicitly asks tests NOT to do).
 */
describe("WebAudioHost applyPointer: positional emitter physics (UX-419/UX-423)", () => {
  function positionalEmitterDoc() {
    return {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Speaker", extensions: { KHR_audio_emitter: { emitter: 0 } } }],
      extensions: {
        KHR_audio_emitter: {
          audio: [],
          sources: [],
          emitters: [
            {
              type: "positional",
              gain: 1,
              sources: [],
              positional: {
                shapeType: "cone",
                distanceModel: "inverse",
                refDistance: 1,
                maxDistance: 40,
                rolloffFactor: 1,
                coneInnerAngle: 0.5,
                coneOuterAngle: 1.0,
                coneOuterGain: 0.1
              }
            }
          ]
        }
      }
    };
  }

  async function hostWithPanner(): Promise<{ host: WebAudioHost; panner: PannerNode }> {
    const host = new WebAudioHost();
    await host.init();
    await host.loadEmitters(positionalEmitterDoc());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance = (host as any).emitterInstances[0];
    expect(instance.panner).toBeTruthy();
    return { host, panner: instance.panner as PannerNode };
  }

  it("refDistance/maxDistance apply directly to the panner, no rebuild (instance identity unchanged)", async () => {
    const { host, panner } = await hostWithPanner();
    host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/positional/refDistance", [3]);
    host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/positional/maxDistance", [80]);
    expect(panner.refDistance).toBe(3);
    expect(panner.maxDistance).toBe(80);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((host as any).emitterInstances[0].panner).toBe(panner); // same PannerNode instance -> confirms no graph rebuild happened.
    host.dispose();
  });

  it("cone angles convert glTF radians to PannerNode degrees; coneOuterGain applies verbatim", async () => {
    const { host, panner } = await hostWithPanner();
    host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/positional/coneInnerAngle", [Math.PI / 2]);
    host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/positional/coneOuterAngle", [Math.PI]);
    host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/positional/coneOuterGain", [0.4]);
    expect(panner.coneInnerAngle).toBeCloseTo(90, 5);
    expect(panner.coneOuterAngle).toBeCloseTo(180, 5);
    expect(panner.coneOuterGain).toBeCloseTo(0.4, 5);
    host.dispose();
  });

  it("is a no-op (does not throw) for an emitter index with no panner (a global emitter)", async () => {
    const host = new WebAudioHost();
    await host.init();
    await host.loadEmitters({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Ambience", extensions: { KHR_audio_emitter: { emitter: 0 } } }],
      extensions: { KHR_audio_emitter: { audio: [], sources: [], emitters: [{ type: "global", gain: 1, sources: [] }] } }
    });
    expect(() => host.applyPointer("/extensions/KHR_audio_emitter/emitters/0/positional/refDistance", [5])).not.toThrow();
    host.dispose();
  });
});

/**
 * Emitter/environment authoring (specs/ux-inspector.md UX-421/UX-422): the
 * KHR_audio_environment machinery (environments/listeners/zones/scene
 * bindings) this pass adds Inspector UI for relies on the pre-existing
 * `attachAudioHost` reload-on-edit path (specs/ux-inspector.md UX-423), not
 * a new `WebAudioHost` code path of its own — so this suite confirms
 * `loadEmitters` builds a correct, inspectable graph topology (reverb
 * convolver wired, zone/listener bindings resolved) for a document
 * authored via the NEW `SceneEdit` factories' exact output shape, rather
 * than re-testing `spatial.ts`'s already-covered math.
 */
describe("WebAudioHost: KHR_audio_environment topology from freshly-authored documents (UX-421/UX-422)", () => {
  it("builds a reverb convolver + gate/return gain chain for an authored environment, gated to zero outside any zone", async () => {
    const doc = {
      asset: { version: "2.0" },
      scene: 0,
      // Deliberately NO scene-wide default `environment` here (only
      // `activeListener`) — this test's own "outside the zone -> gate
      // closed" assertion below needs "outside" to mean NO active
      // environment at all (selectEnvironment falls back to
      // `defaultEnvironmentIndex`, which must stay `undefined`); a scene
      // default pointing at the SAME one environment the zone also targets
      // would keep it selected (at full weight) everywhere, zone or not.
      scenes: [{ nodes: [0, 1], extensions: { KHR_audio_environment: { activeListener: 0 } } }],
      nodes: [
        {
          name: "Zone",
          extensions: { KHR_audio_environment: { environment: 0, shape: { type: "sphere", radius: 5 }, blendDistance: 1, priority: 0 } }
        },
        { name: "Listener", camera: 0, extensions: { KHR_audio_environment: { listener: 0 } } }
      ],
      cameras: [{ type: "perspective", perspective: { yfov: 0.8, znear: 0.1 } }],
      extensions: {
        KHR_audio_emitter: { audio: [], sources: [], emitters: [] },
        KHR_audio_environment: {
          listeners: [{ name: "Player", gain: 0.9, spatializationModel: "HRTF" }],
          environments: [{ name: "Studio", reverb: { preset: "mediumRoom", mix: 0.3 } }]
        }
      }
    };
    const host = new WebAudioHost();
    await host.init();
    await host.loadEmitters(doc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyHost = host as any;
    const bus = anyHost.environmentBuses.get(0);
    expect(bus).toBeTruthy();
    expect(bus.returnGain.gain.value).toBeCloseTo(0.3, 5); // reverb.mix authored via addAudioEnvironment/setAudioEnvironmentProperty.
    expect(anyHost.listenerBus.gain.value).toBeCloseTo(0.9, 5); // listener.gain, resolved via selectListener's activeListener-pinned path.
    expect(anyHost.zones.length).toBe(1);
    expect(anyHost.zones[0].blendDistance).toBe(1);

    // Listener starts far outside the (radius-5) zone -> gate stays closed (0), never throws.
    expect(() => host.setListenerPose({ position: [100, 0, 0], rotation: [0, 0, 0, 1] })).not.toThrow();
    expect(bus.gate.gain.value).toBeCloseTo(0, 1);
    host.dispose();
  });

  it("reverb.mix changes apply live via applyPointer without rebuilding the environment bus", async () => {
    const doc = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      extensions: {
        KHR_audio_emitter: { audio: [], sources: [], emitters: [] },
        KHR_audio_environment: { environments: [{ name: "Hall", reverb: { preset: "concertHall", mix: 0.5 } }] }
      }
    };
    const host = new WebAudioHost();
    await host.init();
    await host.loadEmitters(doc);
    host.applyPointer("/extensions/KHR_audio_environment/environments/0/reverb/mix", [0.75]);
    // applyPointer schedules this via AudioParam.setTargetAtTime (a smooth
    // exponential approach against the REAL audio clock, specs/engine-api.md's
    // applyPointer doc comment), not an instant `.value =` write — so this
    // waits real wall-clock time (several of the 0.02s time constants used)
    // before reading `.value` back, rather than asserting an exact figure.
    await new Promise((resolve) => setTimeout(resolve, 200));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((host as any).environmentBuses.get(0).returnGain.gain.value).toBeCloseTo(0.75, 1);
    host.dispose();
  });
});
