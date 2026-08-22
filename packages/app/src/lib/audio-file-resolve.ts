// Resolves a URI-REFERENCED `KHR_audio_emitter.audio[]` clip's bytes against
// a granted project folder — the live-playback counterpart to `pack-gltf.ts`'s
// import-time `packMultiFileGltf`/`directory-resolve.ts`'s
// `resolveUrisFromDirectory` (PR #19/#22's file-map/folder-access machinery),
// reused here rather than reimplemented: those two only ever ran ONCE, at
// import time, then discarded the resolved file map (`specs/document-model.md`
// has no note on this — see this module's own header for why that's
// insufficient for a clip that STAYS uri-referenced in the JSON forever,
// never embedded).
//
// The USER DECISION this backs (Track A audio task): a referenced clip is
// resolved for playback/preview via this exact folder-grant flow WHEN a
// folder has been granted, and stays honestly "unresolved" (never a fake
// silent fallback) otherwise. `WebAudioHost`'s own `resolveAudioUri`
// constructor option (packages/audio-webaudio) is the consumer — App.tsx
// wires a closure over this module's store-held handle so granting a folder
// mid-session (no WebAudioHost reconstruction needed) takes effect on the
// NEXT `loadEmitters` reload.
import { resolveUrisFromDirectory, type DirectoryHandleLike } from "@gltf-studio/storage";

/**
 * Resolves ONE clip uri against `dirHandle` — a thin single-uri wrapper over
 * `resolveUrisFromDirectory`'s batch shape (that function's own
 * candidate-name normalization — raw / percent-decoded / `./`-stripped /
 * bare-basename — is reused verbatim, so a clip authored as `"clips/a.wav"`
 * resolves against a granted folder containing either `clips/a.wav` or a
 * bare `a.wav`, exactly like an image import's uri would). Returns `null`
 * (never throws) when the folder doesn't contain a matching file — an honest
 * "still unresolved" result, not an error.
 */
export async function resolveAudioUriAgainstDirectory(dirHandle: DirectoryHandleLike, uri: string): Promise<ArrayBuffer | null> {
  const { resolved } = await resolveUrisFromDirectory(dirHandle, [uri]);
  const file = resolved.get(uri);
  if (!file) {
    return null;
  }
  return file.arrayBuffer();
}

/**
 * The single, app-layer resolution attempt for a referenced clip's uri —
 * shared by the Assets > Audio Clips tab's own "is this resolvable right
 * now" check (immediate, on import/render, independent of any AudioHost
 * gesture) and its "Embed" action. Deliberately NOT the same code path as
 * `WebAudioHost`'s own internal resolver: that one only ever runs once a
 * real `AudioContext` exists (AH-001's gesture gate — audio DECODING can't
 * happen before a gesture), which would otherwise leave the Assets tab
 * showing neither a resolved NOR an honestly-unresolved state for a
 * referenced clip until the user happens to trigger audio somewhere else
 * first. Byte RESOLUTION (fetch/directory-lookup) has no such gesture
 * requirement — only `AudioContext.decodeAudioData` does — so this runs
 * eagerly. An absolute `http(s)://` uri is fetched directly; anything else
 * resolves against `dirHandle` when granted. Returns `null` (never throws)
 * for anything unresolvable — the caller renders the honest "Unresolved"
 * state, never a fake success.
 */
export async function resolveReferencedClipBytes(uri: string, dirHandle: DirectoryHandleLike | undefined): Promise<ArrayBuffer | null> {
  if (/^https?:\/\//i.test(uri)) {
    try {
      const response = await fetch(uri);
      return response.ok ? await response.arrayBuffer() : null;
    } catch {
      return null;
    }
  }
  if (!dirHandle) {
    return null;
  }
  return resolveAudioUriAgainstDirectory(dirHandle, uri);
}
