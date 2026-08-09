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
 * (`▶`) control is a disabled stub — real playback needs the play-mode
 * runtime, which arrives at M6.
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
  const emitter = json.extensions?.KHR_audio_emitter?.emitters?.[emitterIndex] ?? {};
  const gain = emitter.gain ?? 1;
  const distanceModel = emitter.distanceModel ?? "inverse";

  function setGain(value: number): void {
    dispatchCommand(SceneEdit.setAudioEmitterProperty(document, emitterIndex, ["gain"], value));
  }
  function setDistanceModel(value: string): void {
    dispatchCommand(SceneEdit.setAudioEmitterProperty(document, emitterIndex, ["distanceModel"], value));
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
        <button className="btn small" data-testid="inspector.audio.audition" disabled title="Play mode arrives in M6.">
          ▶ Audition
        </button>
      </div>
    </div>
  );
}
