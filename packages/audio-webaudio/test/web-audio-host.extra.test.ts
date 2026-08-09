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
