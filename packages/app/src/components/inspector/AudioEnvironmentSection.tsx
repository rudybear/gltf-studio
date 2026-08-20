import { SceneEdit, type EditorDocument } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { PointerButton } from "./PointerButton";

/** `spatial.ts`'s 13-entry `REVERB_PRESETS` table (specs/ux-inspector.md UX-421) — mirrored here as a plain list purely for the Inspector's select options; the actual reverb math lives entirely in `@gltf-studio/audio-webaudio`. */
const REVERB_PRESETS = [
  "generic",
  "smallRoom",
  "mediumRoom",
  "largeRoom",
  "bathroom",
  "concertHall",
  "cathedral",
  "cave",
  "arena",
  "hangar",
  "corridor",
  "forest",
  "underwater"
] as const;

/**
 * specs/ux-inspector.md UX-421/UX-422: `KHR_audio_environment` authoring —
 * shown for every selected node (any node can become a reverb zone, unlike
 * `AudioSection`/`LightSection`/`CameraSection`, which are gated on the
 * node already carrying the relevant fact). Three states:
 *
 *  1. The document has NO `KHR_audio_environment` extension anywhere: a
 *     "No audio environment" empty state with an "Add environment" action
 *     (`SceneEdit.addAudioEnvironment`) — never a silently missing section.
 *  2. At least one environment exists, but THIS node isn't a zone yet
 *     (`node.extensions.KHR_audio_environment.environment` is unset): an
 *     "Add environment zone" action (`SceneEdit.addAudioZone`, defaulting
 *     to environment 0 and a radius-5 sphere). Skipped for a node already
 *     bound as a LISTENER (`.listener` set, `CameraSection`'s own row) —
 *     `addAudioZone` overwrites the whole `KHR_audio_environment` object,
 *     which would silently clobber that binding (`SceneEdit.addAudioZone`'s
 *     own doc comment already documents this trade-off) — a small inline
 *     note explains why the action isn't offered there instead.
 *  3. This node IS a zone: Environment select (reassigning which
 *     `environments[]` entry it routes to) + that environment's own Reverb
 *     Preset/Mix fields (`SceneEdit.setAudioEnvironmentProperty`), plus the
 *     zone's own Shape/Blend Distance/Priority fields (`SceneEdit.
 *     setNodeAudioEnvironmentProperty`).
 *
 * The scene-wide default environment / active listener bindings are two
 * selects at the top (`SceneEdit.setSceneAudioEnvironment`/
 * `setSceneAudioActiveListener`) — scene-wide, not per-node, settings, so
 * shown once here rather than duplicated on every node.
 */
export function AudioEnvironmentSection({
  nodeIndex,
  json,
  document
}: {
  nodeIndex: number;
  json: GltfJsonShape;
  document: EditorDocument;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const environments = json.extensions?.KHR_audio_environment?.environments ?? [];
  const listeners = json.extensions?.KHR_audio_environment?.listeners ?? [];
  const hasExtension = environments.length > 0 || listeners.length > 0;
  const sceneIndex = json.scene ?? 0;
  const sceneBinding = json.scenes?.[sceneIndex]?.extensions?.KHR_audio_environment ?? {};
  const node = json.nodes?.[nodeIndex];
  const zoneBinding = node?.extensions?.KHR_audio_environment;
  const isListener = typeof zoneBinding?.listener === "number";
  const isZone = typeof zoneBinding?.environment === "number";

  function addEnvironment(): void {
    const { command } = SceneEdit.addAudioEnvironment(document, `Environment ${environments.length + 1}`);
    dispatchCommand(command);
  }

  if (!hasExtension) {
    return (
      <div className="inspector-section" data-testid="inspector.audio-environment.section">
        <h4>Audio Environment</h4>
        <div className="content">
          <div className="empty-note" data-testid="inspector.audio-environment.empty">
            No audio environment in this document.
          </div>
          <button className="btn small" data-testid="inspector.audio-environment.add-environment" onClick={addEnvironment}>
            + Add environment
          </button>
        </div>
      </div>
    );
  }

  const environmentIndex = zoneBinding?.environment;
  const environment = typeof environmentIndex === "number" ? environments[environmentIndex] : undefined;
  const reverbPreset = environment?.reverb?.preset ?? "mediumRoom";
  const reverbMix = environment?.reverb?.mix ?? 0.5;
  const shape = zoneBinding?.shape ?? { type: "sphere", radius: 5 };
  const blendDistance = zoneBinding?.blendDistance ?? 0;
  const priority = zoneBinding?.priority ?? 0;

  function addZone(): void {
    const command = SceneEdit.addAudioZone(document, nodeIndex, 0);
    dispatchCommand(command);
  }
  function setZoneEnvironment(index: number): void {
    dispatchCommand(SceneEdit.setNodeAudioEnvironmentProperty(document, nodeIndex, ["environment"], index));
  }
  function setBlendDistance(value: number): void {
    dispatchCommand(SceneEdit.setNodeAudioEnvironmentProperty(document, nodeIndex, ["blendDistance"], value));
  }
  function setPriority(value: number): void {
    dispatchCommand(SceneEdit.setNodeAudioEnvironmentProperty(document, nodeIndex, ["priority"], value));
  }
  function setShapeRadius(value: number): void {
    dispatchCommand(SceneEdit.setNodeAudioEnvironmentProperty(document, nodeIndex, ["shape"], { type: "sphere", radius: value }));
  }
  function setReverbPreset(preset: string): void {
    if (typeof environmentIndex !== "number") return;
    dispatchCommand(SceneEdit.setAudioEnvironmentProperty(document, environmentIndex, ["reverb", "preset"], preset));
  }
  function setReverbMix(mix: number): void {
    if (typeof environmentIndex !== "number") return;
    dispatchCommand(SceneEdit.setAudioEnvironmentProperty(document, environmentIndex, ["reverb", "mix"], mix));
  }
  function setSceneEnvironment(value: string): void {
    dispatchCommand(SceneEdit.setSceneAudioEnvironment(document, sceneIndex, value === "" ? null : Number(value)));
  }
  function setSceneActiveListener(value: string): void {
    dispatchCommand(SceneEdit.setSceneAudioActiveListener(document, sceneIndex, value === "" ? null : Number(value)));
  }

  return (
    <div className="inspector-section" data-testid="inspector.audio-environment.section">
      <h4>Audio Environment</h4>
      <div className="content">
        <div className="field-row">
          <label>Scene Default</label>
          <select
            className="field"
            data-testid="inspector.audio-environment.scene-environment"
            value={sceneBinding.environment ?? ""}
            onChange={(e) => setSceneEnvironment(e.target.value)}
          >
            <option value="">(none)</option>
            {environments.map((env, index) => (
              <option key={index} value={index}>
                {env.name ?? `Environment ${index}`}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label>Scene Listener</label>
          <select
            className="field"
            data-testid="inspector.audio-environment.scene-listener"
            value={sceneBinding.activeListener ?? ""}
            onChange={(e) => setSceneActiveListener(e.target.value)}
            disabled={listeners.length === 0}
          >
            <option value="">(none)</option>
            {listeners.map((listener, index) => (
              <option key={index} value={index}>
                {listener.name ?? `Listener ${index}`}
              </option>
            ))}
          </select>
        </div>

        <button className="btn small" data-testid="inspector.audio-environment.add-environment" onClick={addEnvironment}>
          + Add environment
        </button>

        {isZone ? (
          <>
            <div className="field-row">
              <label>Zone Environment</label>
              <select
                className="field"
                data-testid="inspector.audio-environment.zone-environment"
                value={environmentIndex}
                onChange={(e) => setZoneEnvironment(Number(e.target.value))}
              >
                {environments.map((env, index) => (
                  <option key={index} value={index}>
                    {env.name ?? `Environment ${index}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label>Reverb Preset</label>
              <select
                className="field"
                data-testid="inspector.audio-environment.reverb-preset"
                value={reverbPreset}
                onChange={(e) => setReverbPreset(e.target.value)}
              >
                {REVERB_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label>Reverb Mix</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={reverbMix}
                data-testid="inspector.audio-environment.reverb-mix"
                onChange={(e) => setReverbMix(Number(e.target.value))}
              />
              {typeof environmentIndex === "number" && (
                <PointerButton
                  propKey="audio-environment-reverb-mix"
                  path={`/extensions/KHR_audio_environment/environments/${environmentIndex}/reverb/mix`}
                  signature="float"
                />
              )}
            </div>
            <div className="field-row">
              <label>Zone Radius</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={shape.radius ?? 5}
                data-testid="inspector.audio-environment.zone-radius"
                onChange={(e) => setShapeRadius(Number(e.target.value))}
              />
            </div>
            <div className="field-row">
              <label>Blend Distance</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={blendDistance}
                data-testid="inspector.audio-environment.blend-distance"
                onChange={(e) => setBlendDistance(Number(e.target.value))}
              />
            </div>
            <div className="field-row">
              <label>Priority</label>
              <input
                type="number"
                step="1"
                value={priority}
                data-testid="inspector.audio-environment.priority"
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
          </>
        ) : isListener ? (
          <div className="empty-note" data-testid="inspector.audio-environment.is-listener-note">
            This node is bound as a listener (see the Camera section) — a node is a zone or a listener,
            never both, so "Add environment zone" isn't offered here.
          </div>
        ) : (
          <button className="btn small" data-testid="inspector.audio-environment.add-zone" onClick={addZone}>
            + Add environment zone
          </button>
        )}
      </div>
    </div>
  );
}
