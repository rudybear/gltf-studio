import { useEffect, useState } from "react";
import type { EditorDocument } from "@gltf-studio/editor-core";
import { decodeTextureThumbnails } from "../lib/texture-thumbnails.js";

const EMPTY = new Map<number, string>();

/**
 * specs/ux-inspector.md UX-416: `imageIndex -> data: URL` thumbnails for the
 * Texture Slots sub-section, decoded once per LOADED document rather than
 * on every keystroke — keyed on `document.container`'s own identity (stable
 * across every in-session edit; a fresh `Container` only appears on
 * import/reload/save, per `document.ts`'s DOC-001) rather than
 * `document.json` (which gets a fresh identity on every single command,
 * including edits that never touch `images[]` at all — none of this
 * feature's own edits do, texture slots are cleared/transformed on
 * MATERIALS, never on `images[]` itself, so `container` alone is both
 * correct and avoids redundant re-decodes while e.g. dragging a transform
 * slider).
 */
export function useTextureThumbnails(document: EditorDocument | undefined): Map<number, string> {
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(EMPTY);
  const container = document?.container;

  useEffect(() => {
    if (!document || !container) {
      setThumbnails(EMPTY);
      return;
    }
    let cancelled = false;
    void decodeTextureThumbnails(document).then((result) => {
      if (!cancelled) setThumbnails(result);
    });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on `container` alone, not `document` — see this hook's own doc comment above.
  }, [container]);

  return thumbnails;
}
