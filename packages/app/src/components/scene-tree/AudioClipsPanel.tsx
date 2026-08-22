import { useEffect, useRef, useState } from "react";
import { AudioClipInUseError, countAudioClipUsage, SceneEdit, type Command, type EditorDocument } from "@gltf-studio/editor-core";
import type { DirectoryHandleLike } from "@gltf-studio/storage";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { extractBinaryChunk } from "../../lib/audio-container.js";
import { resolveEmbeddedClipBytes } from "../../lib/audio-clip-bytes.js";
import { resolveReferencedClipBytes } from "../../lib/audio-file-resolve.js";
import { decodeClipDuration, playClipPreview, type ClipPreviewHandle } from "../../lib/audio-clip-preview.js";
import { NodeIcon } from "./NodeIcon";

function guessMimeType(fileName: string, fileType: string): string {
  if (fileType) return fileType;
  if (/\.mp3$/i.test(fileName)) return "audio/mpeg";
  if (/\.ogg$/i.test(fileName)) return "audio/ogg";
  if (/\.wav$/i.test(fileName)) return "audio/wav";
  return "application/octet-stream";
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "…";
  if (!Number.isFinite(seconds)) return "unknown";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, "0")}` : `${s}s`;
}

/**
 * specs/ux-scene-tree.md UX-2xx (clip management, closing
 * OPEN(UX-asset-audio-tab-tbd) — see that spec's own updated note for why
 * clip rows don't need Data-tab addressing): the Assets > Audio Clips tab's
 * real content — list document `extensions.KHR_audio_emitter.audio[]`
 * entries (embedded-vs-referenced badge, duration + preview-play when
 * resolvable, an honest "unresolved" state for an unreachable referenced
 * uri), Import (embed a local file), Add-by-reference (uri text entry),
 * per-row Embed (a resolvable referenced clip -> bufferView), and
 * delete-blocked-when-used (mirrors the Variables panel's exact policy,
 * `SceneEdit.removeAudioClip`/`AudioClipInUseError`).
 */
export function AudioClipsPanel({
  document,
  dispatchCommand,
  audioFolderHandle,
  grantAudioFolder,
  showIndices,
  pushToast
}: {
  document: EditorDocument;
  dispatchCommand: (command: Command) => void;
  audioFolderHandle: DirectoryHandleLike | undefined;
  grantAudioFolder: (dirHandle: DirectoryHandleLike) => void;
  showIndices: boolean;
  pushToast: (text: string) => void;
}): JSX.Element {
  const json = document.json as GltfJsonShape;
  const clips = json.extensions?.KHR_audio_emitter?.audio ?? [];
  const binary = extractBinaryChunk(document.container);

  const [addByReferenceOpen, setAddByReferenceOpen] = useState(false);
  const [referenceUri, setReferenceUri] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Resolvability check for every REFERENCED clip, run eagerly here (not
   * gated behind any `AudioHost` gesture — see `resolveReferencedClipBytes`'s
   * own doc comment for why this deliberately does NOT reuse `WebAudioHost`'s
   * internal resolver/cache) and re-run whenever the clip list or the
   * granted folder changes. `undefined` = still checking (never rendered as
   * a final state); `null` = confirmed unresolved; otherwise the resolved
   * bytes, driving both the "Unresolved" badge/duration/preview AND the
   * `handleEmbed` action below (so a row's Embed button and its own
   * resolved-state check can never disagree).
   */
  const [referencedResolutions, setReferencedResolutions] = useState<Map<number, ArrayBuffer | null>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const referencedIndices = clips.map((clip, i) => ({ clip, i })).filter(({ clip }) => typeof clip.uri === "string" && typeof clip.bufferView !== "number");
    void Promise.all(
      referencedIndices.map(async ({ clip, i }) => {
        const bytes = await resolveReferencedClipBytes(clip.uri!, audioFolderHandle);
        return [i, bytes] as const;
      })
    ).then((results) => {
      if (cancelled) return;
      setReferencedResolutions(new Map(results));
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the joined uri list (not the whole `clips` array reference,
    // which is a fresh object on every document edit anywhere) so
    // re-resolving (repeating a fetch/directory lookup) only happens when
    // the set of referenced uris actually changes.
  }, [clips.map((c) => c.uri).join("|"), audioFolderHandle]);

  const anyUnresolved = clips.some((clip, i) => typeof clip.uri === "string" && referencedResolutions.get(i) === null);

  async function handleImportFile(file: File): Promise<void> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      // Validate BEFORE committing anything to the document (task requirement)
      // — a throwaway AudioContext.decodeAudioData call; a corrupt/unsupported
      // file never reaches SceneEdit at all.
      await decodeClipDuration(arrayBuffer.slice(0));
      const mimeType = guessMimeType(file.name, file.type);
      const { command } = SceneEdit.addAudioClipEmbedded(document, {
        bytes: new Uint8Array(arrayBuffer),
        mimeType,
        name: file.name
      });
      dispatchCommand(command);
    } catch {
      pushToast(`Import failed: "${file.name}" isn't a decodable audio file.`);
    }
  }

  function handleAddByReference(): void {
    const uri = referenceUri.trim();
    if (!uri) return;
    const { command } = SceneEdit.addAudioClipUri(document, { uri, name: uri.split("/").pop() });
    dispatchCommand(command);
    setReferenceUri("");
    setAddByReferenceOpen(false);
  }

  function handleEmbed(clipIndex: number): void {
    const target = clips[clipIndex];
    // Reuses the SAME resolution this panel already computed for the
    // "Unresolved" badge (`referencedResolutions`) rather than re-resolving —
    // the row's Embed button is only ever rendered enabled when this is
    // already known to be non-null (see the row's own `disabled` below), so
    // this is a defensive re-check, not the primary resolution path.
    const bytes = referencedResolutions.get(clipIndex);
    if (!target?.uri || !bytes) {
      pushToast(`Can't embed "${target?.uri ?? "this clip"}" — it isn't resolvable yet (grant folder access, or check the URL).`);
      return;
    }
    dispatchCommand(SceneEdit.embedAudioClip(document, clipIndex, new Uint8Array(bytes), { mimeType: target.mimeType }));
  }

  function handleDelete(clipIndex: number): void {
    try {
      dispatchCommand(SceneEdit.removeAudioClip(document, clipIndex));
    } catch (err) {
      if (err instanceof AudioClipInUseError) {
        pushToast(err.message);
      } else {
        pushToast(err instanceof Error ? err.message : "Couldn't delete this clip.");
      }
    }
  }

  async function handleGrantFolder(): Promise<void> {
    const picker = (window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) {
      pushToast("This browser doesn't support folder access — referenced clips will stay unresolved.");
      return;
    }
    try {
      const handle = await picker({ mode: "read" });
      grantAudioFolder(handle);
    } catch {
      // user cancelled the picker — not an error.
    }
  }

  return (
    <div className="audio-clips-panel" data-testid="asset-browser.audio-clips.panel">
      <div className="audio-clips-actions">
        <button className="btn small" data-testid="asset-browser.audio-clips.import" onClick={() => importInputRef.current?.click()}>
          Import
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          data-testid="asset-browser.audio-clips.import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleImportFile(file);
          }}
        />
        <button
          className="btn small"
          data-testid="asset-browser.audio-clips.add-reference"
          onClick={() => setAddByReferenceOpen((open) => !open)}
        >
          Add by reference
        </button>
        {anyUnresolved && (
          <button className="btn small" data-testid="asset-browser.audio-clips.grant-folder" onClick={() => void handleGrantFolder()}>
            Grant folder access
          </button>
        )}
      </div>

      {addByReferenceOpen && (
        <div className="audio-clip-add-reference" data-testid="asset-browser.audio-clips.add-reference-form">
          <input
            type="text"
            placeholder="relative/path/or/https://…"
            value={referenceUri}
            data-testid="asset-browser.audio-clips.reference-uri"
            onChange={(e) => setReferenceUri(e.target.value)}
          />
          <button
            className="btn small icon-only"
            title="Pick a local file just to fill in its name as a relative path."
            data-testid="asset-browser.audio-clips.reference-pick-file"
            onClick={() => referenceFileInputRef.current?.click()}
          >
            …
          </button>
          <input
            ref={referenceFileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setReferenceUri(file.name);
            }}
          />
          <button className="btn small" data-testid="asset-browser.audio-clips.reference-confirm" onClick={handleAddByReference} disabled={!referenceUri.trim()}>
            Add
          </button>
        </div>
      )}

      {clips.length === 0 ? (
        <div className="empty-note" data-testid="asset-browser.audio-clips.empty">
          {"None in this document — Import a file, or Add by reference."}
        </div>
      ) : (
        <div className="asset-list">
          {clips.map((clip, i) => {
            const isEmbedded = typeof clip.bufferView === "number";
            const resolution = referencedResolutions.get(i);
            return (
              <AudioClipRow
                key={i}
                index={i}
                clip={clip}
                showIndex={showIndices}
                playableBytes={isEmbedded ? resolveEmbeddedClipBytes(json, binary, i) : (resolution ?? null)}
                checking={!isEmbedded && !referencedResolutions.has(i)}
                unresolved={!isEmbedded && referencedResolutions.has(i) && resolution === null}
                usageCount={countAudioClipUsage(document.json, i)}
                onEmbed={() => handleEmbed(i)}
                onDelete={() => handleDelete(i)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function AudioClipRow({
  index,
  clip,
  showIndex,
  playableBytes,
  checking,
  unresolved,
  usageCount,
  onEmbed,
  onDelete
}: {
  index: number;
  clip: { name?: string; uri?: string; mimeType?: string; bufferView?: number };
  showIndex: boolean;
  /** Embedded: always the clip's own bytes. Referenced: the resolved bytes, once resolution completes successfully — `null` otherwise (still checking, or confirmed unresolved; see `checking`/`unresolved`). */
  playableBytes: ArrayBuffer | null;
  /** Referenced clip only: resolution hasn't completed yet — never true for an embedded clip, which needs no async resolution at all. */
  checking: boolean;
  /** Referenced clip only: resolution completed and failed. */
  unresolved: boolean;
  usageCount: number;
  onEmbed: () => void;
  onDelete: () => void;
}): JSX.Element {
  const isEmbedded = typeof clip.bufferView === "number";
  const label = clip.name ?? clip.uri ?? (isEmbedded ? `Clip ${index}` : `audio #${index}`);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const previewRef = useRef<ClipPreviewHandle | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (playableBytes) {
      decodeClipDuration(playableBytes)
        .then((d) => !cancelled && setDuration(d))
        .catch(() => !cancelled && setDuration(NaN));
    }
    return () => {
      cancelled = true;
    };
  }, [playableBytes]);

  function togglePreview(): void {
    if (playing) {
      previewRef.current?.stop();
      setPlaying(false);
      return;
    }
    if (!playableBytes) return;
    setPlaying(true);
    void playClipPreview(playableBytes)
      .then((handle) => {
        previewRef.current = handle;
      })
      .catch(() => setPlaying(false));
  }

  return (
    <div className="asset-item audio-clip-row" data-testid={`asset-browser.audio-clips.${index}`}>
      <NodeIcon type="clip" />
      <span>
        {showIndex ? `#${index} ` : ""}
        {label}
      </span>
      <span className={`badge ${isEmbedded ? "badge-embedded" : "badge-referenced"}`} data-testid={`asset-browser.audio-clips.${index}.badge`}>
        {isEmbedded ? "Embedded" : "Referenced"}
      </span>
      {!isEmbedded && unresolved && (
        <span className="badge badge-unresolved" data-testid={`asset-browser.audio-clips.${index}.unresolved`}>
          Unresolved
        </span>
      )}
      <span className="mono dim" data-testid={`asset-browser.audio-clips.${index}.duration`}>
        {isEmbedded ? formatDuration(duration) : checking ? "…" : unresolved ? "—" : formatDuration(duration)}
      </span>
      <button
        className="btn small icon-only"
        title={playableBytes ? "Play a preview." : checking ? "Checking…" : "Not resolvable yet."}
        disabled={!playableBytes}
        data-testid={`asset-browser.audio-clips.${index}.preview`}
        onClick={(e) => {
          e.stopPropagation();
          togglePreview();
        }}
      >
        {playing ? "■" : "▶"}
      </button>
      {!isEmbedded && (
        <button
          className="btn small"
          disabled={!playableBytes}
          title={playableBytes ? "Embed this clip's bytes into the document." : "Not resolvable yet."}
          data-testid={`asset-browser.audio-clips.${index}.embed`}
          onClick={(e) => {
            e.stopPropagation();
            onEmbed();
          }}
        >
          Embed
        </button>
      )}
      <button
        className="btn small icon-only"
        title={usageCount > 0 ? `Used by ${usageCount} source(s) — remove those references first.` : "Delete this clip."}
        disabled={usageCount > 0}
        data-testid={`asset-browser.audio-clips.${index}.delete`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ✕
      </button>
    </div>
  );
}
