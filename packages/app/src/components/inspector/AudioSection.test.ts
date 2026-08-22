// Pure-function regression coverage for AudioSection.tsx's Clip <-> Oscillator
// toggle helpers (specs/ux-inspector.md UX-424) — added by a code-review pass
// on the r2 audio-graph migration, which found two real bugs in the
// from-scratch object literals these functions originally built:
//   1. `extras`/unmodeled fields were silently dropped on every toggle
//      (the audio-graph canvas's synthetic source-terminal position lives
//      at `source.extras.gltfi` — map-audio-graph.ts's UX-617 note).
//   2. Switching to Clip mode on a document with zero audio clips produced
//      a source with neither `audio` nor an oscillator payload — neither
//      shape, silently broken with no diagnostic anywhere.
import { describe, expect, it, vi } from "vitest";
import type { GltfAudioSourceJson } from "../../lib/gltf-scene.js";

// AudioSection.tsx imports `useAppStore`, which constructs a real
// `IndexedDBStorage` at MODULE load time (`../../store/app-store.ts`) — this
// throws outside a real/injected `IDBFactory` (packages/storage's own
// indexeddb-storage.ts). Same stub `app-store.test.ts` already uses: this
// file only exercises AudioSection.tsx's pure Clip/Oscillator toggle
// helpers, never dispatchCommand/autosave, so a real store is never needed.
vi.mock("@gltf-studio/storage", () => ({
  IndexedDBStorage: class {
    capabilities = { fileHandles: false, remote: false };
    autosaveJournal = vi.fn(async () => {});
  }
}));

const { isOscillatorSource, toClipSource, toOscillatorSource } = await import("./AudioSection.js");

describe("toOscillatorSource / toClipSource: preserve extras and other un-modeled fields (regression, code review)", () => {
  it("toOscillatorSource preserves extras.gltfi (the canvas's synthetic terminal position) across the toggle", () => {
    const clipSource: GltfAudioSourceJson & { extras?: unknown } = {
      name: "beep",
      audio: 0,
      gain: 0.8,
      loop: true,
      playbackRate: 1.5,
      extras: { gltfi: { x: 10, y: 20 } }
    };
    const result = toOscillatorSource(clipSource) as GltfAudioSourceJson & { extras?: unknown };
    expect(result.extras).toEqual({ gltfi: { x: 10, y: 20 } });
    expect(result.name).toBe("beep");
    expect(result.gain).toBe(0.8);
    // Clip-only fields are dropped — they don't apply to an oscillator source.
    expect(result.audio).toBeUndefined();
    expect(result.loop).toBeUndefined();
    expect(result.playbackRate).toBeUndefined();
    expect(isOscillatorSource(result)).toBe(true);
  });

  it("toClipSource preserves extras.gltfi across the toggle back", () => {
    const oscillatorSource: GltfAudioSourceJson & { extras?: unknown } = {
      name: "tone",
      gain: 1,
      extensions: { KHR_audio_graph: { oscillator: { type: "sine", frequency: 440 } } },
      extras: { gltfi: { x: 5, y: 6 } }
    };
    const result = toClipSource(oscillatorSource, 3) as GltfAudioSourceJson & { extras?: unknown };
    expect(result.extras).toEqual({ gltfi: { x: 5, y: 6 } });
    expect(result.audio).toBe(0);
    expect(result.extensions?.KHR_audio_graph?.oscillator).toBeUndefined();
    expect(isOscillatorSource(result)).toBe(false);
  });

  it("toClipSource does not fabricate a valid clip binding when the document has zero audio clips (the caller must disable the Clip option in this case — see AudioSection.tsx's <option disabled> comment)", () => {
    const oscillatorSource: GltfAudioSourceJson = { name: "tone", extensions: { KHR_audio_graph: { oscillator: { type: "sine" } } } };
    const result = toClipSource(oscillatorSource, 0);
    // Documents the caller contract: with audioClipCount 0, this function alone
    // cannot produce a valid clip source (there is no clip to bind) — the UI's
    // own responsibility (disabling "Clip") is what actually prevents reaching
    // this state, not this function.
    expect(result.audio).toBeUndefined();
    expect(isOscillatorSource(result)).toBe(false);
  });
});
