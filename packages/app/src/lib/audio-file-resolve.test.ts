// Unit coverage for `resolveAudioUriAgainstDirectory` — the live-playback
// counterpart to `pack-gltf.ts`'s import-time-only directory resolution (see
// this module's own header comment). Uses a tiny hand-rolled
// `DirectoryHandleLike` double rather than `@gltf-studio/storage`'s own
// internal `fs-test-shim.ts` (not part of that package's public `exports`
// map — a real cross-package import boundary, not an oversight).
import { describe, expect, it } from "vitest";
import type { DirectoryHandleLike, FileHandleLike, FileLike } from "@gltf-studio/storage";
import { resolveAudioUriAgainstDirectory } from "./audio-file-resolve.js";

function fakeFile(bytes: Uint8Array): FileLike {
  return {
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    async text() {
      return new TextDecoder().decode(bytes);
    }
  };
}

/** A flat (single-level) directory double — sufficient for these tests, which only exercise basename matching. */
function fakeDirectory(files: Record<string, Uint8Array>): DirectoryHandleLike {
  const entries = new Map<string, FileHandleLike>(
    Object.entries(files).map(([name, bytes]) => [
      name,
      {
        kind: "file" as const,
        name,
        async getFile() {
          return fakeFile(bytes);
        },
        async createWritable() {
          throw new Error("not implemented in this test double");
        }
      }
    ])
  );
  return {
    kind: "directory",
    name: "root",
    async getDirectoryHandle() {
      throw new Error("no subdirectories in this test double");
    },
    async getFileHandle(name: string) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`not found: ${name}`);
      return entry;
    },
    async removeEntry() {
      throw new Error("not implemented in this test double");
    },
    async *keys() {
      for (const name of entries.keys()) yield name;
    }
  };
}

describe("resolveAudioUriAgainstDirectory", () => {
  it("resolves a clip whose uri is a bare basename present in the granted directory", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const dir = fakeDirectory({ "beep.wav": bytes });
    const result = await resolveAudioUriAgainstDirectory(dir, "beep.wav");
    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(bytes);
  });

  it("resolves a clip authored with a relative path prefix against the basename in a flat granted directory", async () => {
    const bytes = new Uint8Array([9, 9]);
    const dir = fakeDirectory({ "explosion.mp3": bytes });
    const result = await resolveAudioUriAgainstDirectory(dir, "clips/explosion.mp3");
    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(bytes);
  });

  it("returns null (never throws) when the granted directory doesn't contain a matching file", async () => {
    const dir = fakeDirectory({ "other.wav": new Uint8Array([1]) });
    const result = await resolveAudioUriAgainstDirectory(dir, "missing.wav");
    expect(result).toBeNull();
  });
});
