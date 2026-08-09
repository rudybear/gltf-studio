// Unit coverage for `resolveUrisFromDirectory`/`listFilesRecursive`
// (directory-resolve.ts) -- the URI -> directory-handle resolution behind
// the app's UX-117 "Grant folder access…" flow, backed by
// `MemoryDirectoryHandle` (fs-test-shim.ts) so this runs under plain Node
// with no browser/`window.showDirectoryPicker()` user gesture, exactly like
// filesystem-storage.test.ts's own StorageProvider contract coverage.
import { describe, expect, it } from "vitest";
import { listFilesRecursive, resolveUrisFromDirectory } from "./directory-resolve.js";
import { MemoryDirectoryHandle } from "./fs-test-shim.js";

async function writeFile(dir: MemoryDirectoryHandle, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

describe("listFilesRecursive", () => {
  it("collects every file at the top level, keyed by basename", async () => {
    const dir = new MemoryDirectoryHandle();
    await writeFile(dir, "scene.gltf", "gltf-json");
    await writeFile(dir, "scene.bin", "bin-bytes");

    const files = await listFilesRecursive(dir);
    expect([...files.keys()].sort()).toEqual(["scene.bin", "scene.gltf"]);
    expect(await files.get("scene.gltf")!.text()).toBe("gltf-json");
  });

  it("descends into subdirectories, still keyed by basename", async () => {
    const dir = new MemoryDirectoryHandle();
    const textures = await dir.getDirectoryHandle("textures", { create: true });
    await writeFile(dir, "scene.gltf", "gltf-json");
    await writeFile(textures as MemoryDirectoryHandle, "diffuse.png", "png-bytes");

    const files = await listFilesRecursive(dir);
    expect([...files.keys()].sort()).toEqual(["diffuse.png", "scene.gltf"]);
  });

  it("a name collision across subdirectories keeps whichever copy is found first, never throws", async () => {
    const dir = new MemoryDirectoryHandle();
    const sub = await dir.getDirectoryHandle("sub", { create: true });
    await writeFile(dir, "kick.mp3", "top-level");
    await writeFile(sub as MemoryDirectoryHandle, "kick.mp3", "nested");

    const files = await listFilesRecursive(dir);
    expect(files.size).toBe(1);
    expect(await files.get("kick.mp3")!.text()).toBe("top-level");
  });
});

describe("resolveUrisFromDirectory", () => {
  it("resolves plain-basename URIs directly against the drum-kit-shaped flat directory", async () => {
    const dir = new MemoryDirectoryHandle();
    await writeFile(dir, "drum-kit.bin", "bin-bytes");
    await writeFile(dir, "kick.mp3", "kick-bytes");
    await writeFile(dir, "snare.mp3", "snare-bytes");

    const { resolved, missing } = await resolveUrisFromDirectory(dir, ["drum-kit.bin", "kick.mp3", "snare.mp3"]);
    expect(missing).toEqual([]);
    expect(resolved.size).toBe(3);
    expect(await resolved.get("kick.mp3")!.text()).toBe("kick-bytes");
  });

  it("resolves a percent-encoded URI and a leading './' against the plain basename on disk", async () => {
    const dir = new MemoryDirectoryHandle();
    await writeFile(dir, "my scene.bin", "bin-bytes");
    await writeFile(dir, "diffuse.png", "png-bytes");

    const { resolved, missing } = await resolveUrisFromDirectory(dir, ["my%20scene.bin", "./diffuse.png"]);
    expect(missing).toEqual([]);
    expect(await resolved.get("my%20scene.bin")!.text()).toBe("bin-bytes");
    expect(await resolved.get("./diffuse.png")!.text()).toBe("png-bytes");
  });

  it("resolves a URI carrying a relative subdirectory path against a file actually found in a subdirectory", async () => {
    const dir = new MemoryDirectoryHandle();
    const textures = await dir.getDirectoryHandle("textures", { create: true });
    await writeFile(textures as MemoryDirectoryHandle, "diffuse.png", "png-bytes");

    const { resolved, missing } = await resolveUrisFromDirectory(dir, ["textures/diffuse.png"]);
    expect(missing).toEqual([]);
    expect(await resolved.get("textures/diffuse.png")!.text()).toBe("png-bytes");
  });

  it("reports every still-unresolved URI in `missing`, resolving whatever it can alongside it", async () => {
    const dir = new MemoryDirectoryHandle();
    await writeFile(dir, "drum-kit.bin", "bin-bytes");
    // "crash.mp3" deliberately absent -- simulates the user granting access to
    // the wrong (or an incomplete) folder.

    const { resolved, missing } = await resolveUrisFromDirectory(dir, ["drum-kit.bin", "crash.mp3"]);
    expect(missing).toEqual(["crash.mp3"]);
    expect(resolved.size).toBe(1);
    expect(resolved.has("drum-kit.bin")).toBe(true);
  });
});
