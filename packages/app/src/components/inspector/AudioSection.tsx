import { useState } from "react";
import { SceneEdit, type EditorDocument } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { PointerButton } from "./PointerButton";

const DISTANCE_MODELS = ["linear", "inverse", "exponential"] as const;

/**
 * specs/ux-inspector.md UX-406: gain (with a `◈` pointer-shortcut) and a
 * distance-model select, written via `SceneEdit.setAudioEmitterProperty`
 * against `extensions.KHR_audio_emitter.emitters[emitterIndex]` (the
 * root-level emitters registry the node's own
 * `extensions.KHR_audio_emitter.emitter` index points into). The Audition
 * (`▶`) control is real as of M7: the store's `audioHost` (registered by
 * App.tsx per document, specs/engine-api.md AH-001/AH-002) is gesture-gated
 * — `init()` is only ever called from inside this button's own `onClick`,
 * the first real user gesture this control sees, and only once (tracked
 * locally; a second click skips straight to `auditionEmitter` — `init()`
 * itself is idempotent too, so this is a minor redundant-call optimization,
 * not a correctness requirement).
 */
export function AudioSection({
  emitterIndex,
  json,
  document
}: {
  emitterIndex: number;
  json: GltfJsonShape;
  document: EditorDocument;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const audioHost = useAppStore((s) => s.audioHost);
  const [initialized, setInitialized] = useState(false);
  const [auditioning, setAuditioning] = useState(false);
  const emitter = json.extensions?.KHR_audio_emitter?.emitters?.[emitterIndex] ?? {};
  const gain = emitter.gain ?? 1;
  const distanceModel = emitter.distanceModel ?? "inverse";

  function setGain(value: number): void {
    dispatchCommand(SceneEdit.setAudioEmitterProperty(document, emitterIndex, ["gain"], value));
  }
  function setDistanceModel(value: string): void {
    dispatchCommand(SceneEdit.setAudioEmitterProperty(document, emitterIndex, ["distanceModel"], value));
  }

  async function audition(): Promise<void> {
    if (!audioHost || auditioning) return;
    setAuditioning(true);
    try {
      if (!initialized) {
        await audioHost.init(); // AH-001: gesture-gated — this onClick IS the gesture.
        setInitialized(true);
      }
      audioHost.auditionEmitter(emitterIndex);
    } finally {
      setAuditioning(false);
    }
  }

  return (
    <div className="inspector-section" data-testid="inspector.audio.section">
      <h4>Audio Emitter</h4>
      <div className="content">
        <div className="field-row">
          <label>Gain</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={gain}
            data-testid="inspector.audio.gain"
            onChange={(e) => setGain(Number(e.target.value))}
          />
          <PointerButton propKey="gain" path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/gain`} signature="float" />
        </div>
        <div className="field-row">
          <label>Distance Model</label>
          <select
            className="field"
            data-testid="inspector.audio.distance-model"
            value={distanceModel}
            onChange={(e) => setDistanceModel(e.target.value)}
          >
            {DISTANCE_MODELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn small"
          data-testid="inspector.audio.audition"
          disabled={!audioHost || auditioning}
          title="Play a brief local preview of this emitter."
          onClick={() => void audition()}
        >
          ▶ Audition
        </button>
      </div>
    </div>
  );
}
