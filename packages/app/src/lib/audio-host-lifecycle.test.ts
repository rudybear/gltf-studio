// Regression coverage for the audio-host-keying bug (specs/ux-shell.md's M7
// "audio-host-keying fix" follow-up): `attachAudioHost` must key its
// load/reload wiring on `HistoryStack` (stable for the life of one project),
// not `EditorDocument` (a new object every `history.freeze()`/`unfreeze()`,
// DOC-045 -- exactly what `startPlay`/`stopPlay` call). This proves the
// caller-owned `AudioHostLike` (and, in production, its `AudioContext`)
// survives a freeze/unfreeze cycle intact, while a real content change
// (`history.push`) still triggers a reload.
import { describe, expect, it, vi } from "vitest";
import type { Container } from "@gltfi/gltf";
import { createDocument, HistoryStack, type Command } from "@gltf-studio/editor-core";
import { attachAudioHost, type AudioHostLike } from "./audio-host-lifecycle.js";

// Same minimal-fake-`Container` pattern as packages/app/src/store/app-store.test.ts's
// `fakeContainer` -- a plain "glb"-kind shape built inline rather than
// round-tripped through @gltfi/gltf's real writeContainer/parseContainer,
// since `test-fixtures.ts` (which does that) is editor-core-internal, not
// exported from its public "." entry point.
function fakeContainer(json: unknown): Container {
  return {
    kind: "glb",
    chunks: [],
    jsonChunkIndex: 0,
    jsonText: JSON.stringify(json),
    json,
    binaryChunk: undefined
  };
}

// Modeled on document.test.ts's `renameCommand` helper.
function renameCommand(name: string, prevName: string): Command {
  return {
    id: "rename",
    label: "Rename node 0",
    patches: [{ op: "replace", path: "/nodes/0/name", value: name }],
    inverse: [{ op: "replace", path: "/nodes/0/name", value: prevName }]
  };
}

function fakeHost(): AudioHostLike {
  return {
    loadEmitters: vi.fn(async () => {}),
    dispose: vi.fn()
  };
}

function makeHistory(): HistoryStack {
  const document = createDocument(fakeContainer({ asset: { version: "2.0" }, nodes: [{ name: "Alpha" }] }));
  return new HistoryStack(document);
}

describe("attachAudioHost", () => {
  it("loads emitters exactly once up front", () => {
    const history = makeHistory();
    const host = fakeHost();
    attachAudioHost(history, host);
    expect(host.loadEmitters).toHaveBeenCalledTimes(1);
  });

  it("survives a freeze/unfreeze cycle (startPlay/stopPlay, DOC-045) without reloading or disposing", () => {
    const history = makeHistory();
    const host = fakeHost();
    attachAudioHost(history, host);
    expect(host.loadEmitters).toHaveBeenCalledTimes(1);

    history.freeze();
    history.unfreeze();

    expect(host.loadEmitters).toHaveBeenCalledTimes(1);
    expect(host.dispose).not.toHaveBeenCalled();
  });

  it("reloads emitters on a real content change (history.push)", () => {
    const history = makeHistory();
    const host = fakeHost();
    attachAudioHost(history, host);
    expect(host.loadEmitters).toHaveBeenCalledTimes(1);

    history.push(renameCommand("Zed", "Alpha"));

    expect(host.loadEmitters).toHaveBeenCalledTimes(2);
  });

  it("teardown disposes the host and unsubscribes from further history activity", () => {
    const history = makeHistory();
    const host = fakeHost();
    const teardown = attachAudioHost(history, host);
    expect(host.loadEmitters).toHaveBeenCalledTimes(1);

    teardown();
    expect(host.dispose).toHaveBeenCalledTimes(1);

    history.push(renameCommand("Zed", "Alpha"));
    history.freeze();
    history.unfreeze();

    expect(host.loadEmitters).toHaveBeenCalledTimes(1);
    expect(host.dispose).toHaveBeenCalledTimes(1);
  });
});
