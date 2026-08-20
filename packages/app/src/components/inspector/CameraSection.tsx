import { SceneEdit, type EditorDocument } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { PointerButton } from "./PointerButton";

/**
 * specs/ux-inspector.md UX-418: a node whose glTF entry carries `camera`
 * shows this section — perspective `yfov`/`znear`/`zfar`, each written via
 * `SceneEdit.setCameraProperty` against core glTF's `cameras[cameraIndex]`
 * (no extension involved). These edits round-trip through the document
 * (undoable, and correctly persisted/exported) but do NOT yet preview live
 * through this camera in the viewport — `ThreeRenderHost`'s own viewport
 * camera is an independent free-fly camera, not derived from any scene
 * camera node, and there is no vendored pointer-router route for a camera's
 * perspective fields either (camera properties aren't part of KHR_
 * interactivity's node/material Object Model families the router covers).
 * Wiring a "look through this camera" viewport mode is a real, scoped-out
 * follow-up (noted inline, not silently missing) — see this requirement's
 * own PR description for why v1 stops at "property editing" rather than
 * attempting live preview.
 *
 * UX-422 (emitter/environment/listener authoring, audio pass 3/3) adds a
 * Listener row: when the document has at least one `KHR_audio_environment`
 * listener, either a "Bind as listener" action (`SceneEdit.
 * setNodeAudioEnvironmentProperty(…, ["listener"], …)`, offered once a
 * listener exists — creating the FIRST one is `AudioEnvironmentSection`'s
 * own "Add environment"/empty-state action, `SceneEdit.addAudioListener`,
 * kept there since a listener is a document-wide registry entry, not a
 * camera-specific concept) or, once bound, editable Gain/Spatialization
 * Model fields against that listener's own root registry entry
 * (`SceneEdit.setAudioListenerProperty`).
 */
export function CameraSection({
  cameraIndex,
  nodeIndex,
  json,
  document
}: {
  cameraIndex: number;
  nodeIndex: number;
  json: GltfJsonShape;
  document: EditorDocument;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const camera = json.cameras?.[cameraIndex];
  const perspective = camera?.perspective;
  const yfov = perspective?.yfov ?? 0.8;
  const znear = perspective?.znear ?? 0.1;
  const zfar = perspective?.zfar;
  const listeners = json.extensions?.KHR_audio_environment?.listeners ?? [];
  const listenerIndex = json.nodes?.[nodeIndex]?.extensions?.KHR_audio_environment?.listener;
  const listener = typeof listenerIndex === "number" ? listeners[listenerIndex] : undefined;

  function setYfov(value: number): void {
    dispatchCommand(SceneEdit.setCameraProperty(document, cameraIndex, ["perspective", "yfov"], value));
  }
  function setZnear(value: number): void {
    dispatchCommand(SceneEdit.setCameraProperty(document, cameraIndex, ["perspective", "znear"], value));
  }
  function setZfar(value: number): void {
    dispatchCommand(SceneEdit.setCameraProperty(document, cameraIndex, ["perspective", "zfar"], value));
  }
  function bindListener(index: number): void {
    dispatchCommand(SceneEdit.setNodeAudioEnvironmentProperty(document, nodeIndex, ["listener"], index));
  }
  function setListenerGain(value: number): void {
    if (typeof listenerIndex !== "number") return;
    dispatchCommand(SceneEdit.setAudioListenerProperty(document, listenerIndex, ["gain"], value));
  }
  function setListenerSpatializationModel(value: string): void {
    if (typeof listenerIndex !== "number") return;
    dispatchCommand(SceneEdit.setAudioListenerProperty(document, listenerIndex, ["spatializationModel"], value));
  }

  return (
    <div className="inspector-section" data-testid="inspector.camera.section">
      <h4>Camera</h4>
      <div className="content">
        <div className="field-row">
          <label>Y FOV</label>
          <input type="number" step="0.01" min="0.01" value={yfov} data-testid="inspector.camera.yfov" onChange={(e) => setYfov(Number(e.target.value))} />
          <PointerButton propKey="camera-yfov" path={`/cameras/${cameraIndex}/perspective/yfov`} signature="float" />
        </div>
        <div className="field-row">
          <label>Near</label>
          <input
            type="number"
            step="0.01"
            min="0.001"
            value={znear}
            data-testid="inspector.camera.znear"
            onChange={(e) => setZnear(Number(e.target.value))}
          />
          <PointerButton propKey="camera-znear" path={`/cameras/${cameraIndex}/perspective/znear`} signature="float" />
        </div>
        <div className="field-row">
          <label>Far</label>
          <input
            type="number"
            step="1"
            min="0"
            value={zfar ?? ""}
            placeholder="infinite"
            data-testid="inspector.camera.zfar"
            onChange={(e) => setZfar(Number(e.target.value))}
          />
          <PointerButton propKey="camera-zfar" path={`/cameras/${cameraIndex}/perspective/zfar`} signature="float" />
        </div>
        <div className="empty-note" data-testid="inspector.camera.note">
          This camera does not yet preview live in the viewport — that's a later iteration. Edits above still apply to the document.
        </div>

        {listeners.length > 0 &&
          (listener ? (
            <>
              <div className="field-row">
                <label>Listener Gain</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={listener.gain ?? 1}
                  data-testid="inspector.camera.listener-gain"
                  onChange={(e) => setListenerGain(Number(e.target.value))}
                />
              </div>
              <div className="field-row">
                <label>Spatialization Model</label>
                <select
                  className="field"
                  data-testid="inspector.camera.listener-spatialization-model"
                  value={listener.spatializationModel ?? "HRTF"}
                  onChange={(e) => setListenerSpatializationModel(e.target.value)}
                >
                  <option value="HRTF">HRTF</option>
                  <option value="equalpower">equalpower</option>
                </select>
              </div>
            </>
          ) : (
            <div className="field-row">
              <label>Listener</label>
              <select
                className="field"
                data-testid="inspector.camera.bind-listener"
                value=""
                onChange={(e) => e.target.value !== "" && bindListener(Number(e.target.value))}
              >
                <option value="" disabled>
                  Bind as listener…
                </option>
                {listeners.map((candidate, index) => (
                  <option key={index} value={index}>
                    {candidate.name ?? `Listener ${index}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
      </div>
    </div>
  );
}
