import { useState } from "react";
import { SceneEdit, type EditorDocument } from "@gltf-studio/editor-core";
import {
  OSCILLATOR_SOURCE_FIELDS,
  defaultOscillatorSourceParams,
  isOscillatorSourceFieldVisible,
  formatNumberList,
  parseNumberList
} from "@gltf-studio/audio-canvas";
import { useAppStore } from "../../store/app-store";
import type { GltfAudioSourceJson, GltfJsonShape } from "../../lib/gltf-scene";
import { PointerButton } from "./PointerButton";

const DISTANCE_MODELS = ["linear", "inverse", "exponential"] as const;
const SHAPE_TYPES = ["omnidirectional", "cone"] as const;

/**
 * r2: a source is an oscillator when it declares the payload AND has no
 * `audio` index — the same discriminator `@gltf-audiograph`'s
 * `importAudioGraph`/`audio-canvas`'s `map-audio-graph.ts` use (a source
 * can't be both a clip and an oscillator, `AudioGraphJsHost`'s upstream
 * `lintLayeredGraph` flags that as `audio-and-oscillator` if it ever
 * happens). Kept in sync with two other independent copies of this exact
 * discriminator — `@gltf-studio/audio-graph`'s `validators.ts`
 * (`findCustomOscillatorSourceIssues`) and `@gltf-studio/audio-canvas`'s
 * `map-audio-graph.ts` — see `validators.ts`'s doc comment for why these
 * three aren't unified into one shared export.
 */
export function isOscillatorSource(source: GltfAudioSourceJson): boolean {
  return source.extensions?.KHR_audio_graph?.oscillator !== undefined && typeof source.audio !== "number";
}

/**
 * Whole-source replacement for the Clip <-> Oscillator toggle (UX-420):
 * spreads the EXISTING source first (bug fix, code review — a from-scratch
 * object literal here silently dropped every field this type doesn't name,
 * concretely `extras.gltfi` — the audio-graph canvas's synthetic source
 * terminal position, `map-audio-graph.ts`'s UX-617 note — and any other
 * un-modeled extension data), then overrides only the fields that actually
 * change shape, deleting the ones that don't apply to the new mode.
 * Preserves the playback-scheduling fields both shapes share (`gain`/
 * `autoplay`, r2's `SOURCE_SCHEDULE_KEYS`). Switching to Clip picks audio
 * clip 0 when one exists (this section has no clip-picker UI yet — same
 * "no clip replacement/upload" scope as UX-420's original read-only clip
 * display).
 */
export function toOscillatorSource(source: GltfAudioSourceJson): GltfAudioSourceJson {
  const next: GltfAudioSourceJson = { ...source };
  delete next.audio;
  delete next.loop;
  delete next.playbackRate;
  next.extensions = { KHR_audio_graph: { oscillator: defaultOscillatorSourceParams() } };
  return next;
}
/**
 * Bug fix (code review): the caller only offers this via a "Clip" `<option>`
 * that is now `disabled` whenever the document has zero audio clips (see
 * this function's call site) — `audioClipCount` staying 0 here would
 * otherwise produce a source with neither `audio` nor an oscillator
 * payload, a shape `isOscillatorSource` reports as "clip" but that binds no
 * real clip at all (silently broken, no diagnostic anywhere flags it).
 */
export function toClipSource(source: GltfAudioSourceJson, audioClipCount: number): GltfAudioSourceJson {
  const next: GltfAudioSourceJson = { ...source };
  delete next.extensions;
  next.loop = false;
  next.playbackRate = 1;
  next.audio = audioClipCount > 0 ? 0 : source.audio;
  return next;
}

/**
 * specs/ux-inspector.md UX-406/UX-419/UX-420: an emitter's own gain/type/
 * positional-physics/cone fields (`UX-419`) plus a Sources sub-list
 * (`UX-420`), written via `SceneEdit.setAudioEmitterProperty`/
 * `setAudioSourceProperty` against `extensions.KHR_audio_emitter.
 * emitters[emitterIndex]`/`sources[sourceIndex]` (the root-level registries
 * the node's own `extensions.KHR_audio_emitter.emitter` index and the
 * emitter's own `sources: number[]` array point into). The Audition (`▶`)
 * control is real as of M7: the store's `audioHost` (registered by App.tsx
 * per document, specs/engine-api.md AH-001/AH-002) is gesture-gated —
 * `init()` is only ever called from inside this button's own `onClick`, the
 * first real user gesture this control sees, and only once (tracked
 * locally; a second click skips straight to `auditionEmitter` — `init()`
 * itself is idempotent too, so this is a minor redundant-call optimization,
 * not a correctness requirement).
 *
 * BUGFIX (UX-419): the ORIGINAL Distance Model select wrote a TOP-LEVEL
 * `emitters[i].distanceModel` field — `WebAudioHost.buildEmitterChain` only
 * ever reads `emitters[i].positional.distanceModel`, so that field was
 * silently write-only (round-tripped through the document, never actually
 * applied) since M7. Every positional field here now reads/writes under
 * `["positional", ...]`, matching what `WebAudioHost` actually reads.
 */
export function AudioSection({
  emitterIndex,
  nodeIndex,
  json,
  document
}: {
  emitterIndex: number;
  /**
   * Multi-emitter-per-node (closing PR #48's documented gap,
   * `SceneEdit.addEmitterToNode`/`removeEmitterFromNode`): the owning node's
   * index, needed only for the "Remove this emitter" action below — every
   * OTHER field in this section still addresses the emitter/source/clip
   * registries directly by their OWN index, never by node.
   */
  nodeIndex: number;
  json: GltfJsonShape;
  document: EditorDocument;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const audioHost = useAppStore((s) => s.audioHost);
  const renderHost = useAppStore((s) => s.renderHost);
  const [initialized, setInitialized] = useState(false);
  const [auditioning, setAuditioning] = useState(false);
  const emitter = json.extensions?.KHR_audio_emitter?.emitters?.[emitterIndex] ?? {};
  const type = emitter.type ?? "positional";
  const gain = emitter.gain ?? 1;
  const positional = emitter.positional ?? {};
  const shapeType = positional.shapeType ?? "omnidirectional";
  const distanceModel = positional.distanceModel ?? "inverse";
  const refDistance = positional.refDistance ?? 1;
  const maxDistance = positional.maxDistance ?? 0;
  const rolloffFactor = positional.rolloffFactor ?? 1;
  const coneInnerAngle = positional.coneInnerAngle ?? 0;
  const coneOuterAngle = positional.coneOuterAngle ?? 0;
  const coneOuterGain = positional.coneOuterGain ?? 0;
  const sourceIndices = emitter.sources ?? [];
  const audioClips = json.extensions?.KHR_audio_emitter?.audio ?? [];
  const sources = json.extensions?.KHR_audio_emitter?.sources ?? [];

  function setEmitterProp(path: Array<string | number>, value: unknown): void {
    dispatchCommand(SceneEdit.setAudioEmitterProperty(document, emitterIndex, path, value));
  }
  function setSourceProp(sourceIndex: number, path: Array<string | number>, value: unknown): void {
    dispatchCommand(SceneEdit.setAudioSourceProperty(document, sourceIndex, path, value));
  }

  /**
   * Listener-pose gap (specs/engine-api.md's documented note, closed here):
   * Audition previously played against the Web Audio API's default listener
   * pose (origin, facing -Z) always — `Viewport.tsx`'s own per-frame
   * `setListenerPose` feed is deliberately gated on `playState === "playing"`
   * only (a perf tradeoff for the whole viewport, not revisited here). This
   * is a ONE-SHOT snapshot instead of a continuous feed: `renderHost.
   * getCameraPose()` (the SAME `CameraPose` shape play mode's own feed
   * uses) is read and pushed to `audioHost.setListenerPose` exactly once,
   * right before `auditionEmitter` — a positional emitter now pans/
   * attenuates against wherever the viewport camera actually is AT THE
   * MOMENT Audition is clicked, not a hardcoded origin. It does NOT track
   * further camera movement during playback (that would need reinstating
   * the interval feed this section deliberately avoids re-adding, per
   * `Viewport.tsx`'s own perf-flake history) — a real, honest, narrower
   * remaining gap than before, not a full live feed.
   */
  async function audition(): Promise<void> {
    if (!audioHost || auditioning) return;
    setAuditioning(true);
    try {
      if (!initialized) {
        await audioHost.init(); // AH-001: gesture-gated — this onClick IS the gesture.
        setInitialized(true);
      }
      if (renderHost) {
        audioHost.setListenerPose(renderHost.getCameraPose());
      }
      audioHost.auditionEmitter(emitterIndex);
    } finally {
      setAuditioning(false);
    }
  }

  return (
    <div className="inspector-section" data-testid="inspector.audio.section">
      <div className="section-header-row">
        <h4>Audio Emitter</h4>
        <button
          className="btn small icon-only"
          title="Remove this emitter from the node."
          data-testid={`inspector.audio.${emitterIndex}.remove-emitter`}
          onClick={() => dispatchCommand(SceneEdit.removeEmitterFromNode(document, nodeIndex, emitterIndex))}
        >
          ✕
        </button>
      </div>
      <div className="content">
        <div className="field-row">
          <label>Type</label>
          <select
            className="field"
            data-testid="inspector.audio.type"
            value={type}
            onChange={(e) => setEmitterProp(["type"], e.target.value)}
          >
            <option value="global">global</option>
            <option value="positional">positional</option>
          </select>
        </div>
        <div className="field-row">
          <label>Gain</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={gain}
            data-testid="inspector.audio.gain"
            onChange={(e) => setEmitterProp(["gain"], Number(e.target.value))}
          />
          <PointerButton propKey="gain" path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/gain`} signature="float" />
        </div>

        {type === "positional" && (
          <>
            <div className="field-row">
              <label>Shape</label>
              <select
                className="field"
                data-testid="inspector.audio.shape-type"
                value={shapeType}
                onChange={(e) => setEmitterProp(["positional", "shapeType"], e.target.value)}
              >
                {SHAPE_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label>Distance Model</label>
              <select
                className="field"
                data-testid="inspector.audio.distance-model"
                value={distanceModel}
                onChange={(e) => setEmitterProp(["positional", "distanceModel"], e.target.value)}
              >
                {DISTANCE_MODELS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label>Ref Distance</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={refDistance}
                data-testid="inspector.audio.ref-distance"
                onChange={(e) => setEmitterProp(["positional", "refDistance"], Number(e.target.value))}
              />
              <PointerButton
                propKey="audio-ref-distance"
                path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/positional/refDistance`}
                signature="float"
              />
            </div>
            <div className="field-row">
              <label>Max Distance</label>
              <input
                type="number"
                step="1"
                min="0"
                value={maxDistance}
                placeholder="unbounded"
                data-testid="inspector.audio.max-distance"
                onChange={(e) => setEmitterProp(["positional", "maxDistance"], Number(e.target.value))}
              />
              <PointerButton
                propKey="audio-max-distance"
                path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/positional/maxDistance`}
                signature="float"
              />
            </div>
            <div className="field-row">
              <label>Rolloff Factor</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={rolloffFactor}
                data-testid="inspector.audio.rolloff-factor"
                onChange={(e) => setEmitterProp(["positional", "rolloffFactor"], Number(e.target.value))}
              />
              <PointerButton
                propKey="audio-rolloff-factor"
                path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/positional/rolloffFactor`}
                signature="float"
              />
            </div>
            {shapeType === "cone" && (
              <>
                <div className="field-row">
                  <label>Cone Inner Angle</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={coneInnerAngle}
                    data-testid="inspector.audio.cone-inner-angle"
                    onChange={(e) => setEmitterProp(["positional", "coneInnerAngle"], Number(e.target.value))}
                  />
                  <PointerButton
                    propKey="audio-cone-inner-angle"
                    path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/positional/coneInnerAngle`}
                    signature="float"
                  />
                </div>
                <div className="field-row">
                  <label>Cone Outer Angle</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={coneOuterAngle}
                    data-testid="inspector.audio.cone-outer-angle"
                    onChange={(e) => setEmitterProp(["positional", "coneOuterAngle"], Number(e.target.value))}
                  />
                  <PointerButton
                    propKey="audio-cone-outer-angle"
                    path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/positional/coneOuterAngle`}
                    signature="float"
                  />
                </div>
                <div className="field-row">
                  <label>Cone Outer Gain</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={coneOuterGain}
                    data-testid="inspector.audio.cone-outer-gain"
                    onChange={(e) => setEmitterProp(["positional", "coneOuterGain"], Number(e.target.value))}
                  />
                  <PointerButton
                    propKey="audio-cone-outer-gain"
                    path={`/extensions/KHR_audio_emitter/emitters/${emitterIndex}/positional/coneOuterGain`}
                    signature="float"
                  />
                </div>
              </>
            )}
          </>
        )}

        <div className="audio-sources" data-testid="inspector.audio.sources">
          <h5>Sources</h5>
          {sourceIndices.length === 0 && (
            <div className="empty-note" data-testid="inspector.audio.sources.empty">
              No sources yet.
            </div>
          )}
            {sourceIndices.map((sourceIndex) => {
              const source = sources[sourceIndex] ?? {};
              const oscillatorMode = isOscillatorSource(source);
              const oscillator = source.extensions?.KHR_audio_graph?.oscillator ?? {};
              function setOscillatorProp(key: string, value: unknown): void {
                setSourceProp(sourceIndex, ["extensions", "KHR_audio_graph", "oscillator", key], value);
              }
              return (
                <div className="audio-source-row" data-testid={`inspector.audio.source.${sourceIndex}`} key={sourceIndex}>
                  <div className="section-header-row">
                    <button
                      className="btn small icon-only"
                      title="Remove this source from the emitter."
                      data-testid={`inspector.audio.source.${sourceIndex}.remove`}
                      onClick={() => dispatchCommand(SceneEdit.removeSourceFromEmitter(document, emitterIndex, sourceIndex))}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="field-row">
                    <label>Source Type</label>
                    <select
                      className="field"
                      data-testid={`inspector.audio.source.${sourceIndex}.type-select`}
                      value={oscillatorMode ? "oscillator" : "clip"}
                      onChange={(e) =>
                        setSourceProp(
                          sourceIndex,
                          [],
                          e.target.value === "oscillator" ? toOscillatorSource(source) : toClipSource(source, audioClips.length)
                        )
                      }
                    >
                      {/* Bug fix (code review): disabled when the document has zero audio clips — otherwise
                          switching to Clip mode here would produce a source with neither `audio` nor an
                          oscillator payload, silently broken with no diagnostic (toClipSource's own doc comment). */}
                      <option value="clip" disabled={audioClips.length === 0}>
                        Clip
                      </option>
                      <option value="oscillator">Oscillator</option>
                    </select>
                  </div>
                  {/* r2: an oscillator source's `loop`/`playbackRate` are declared-but-ignored per spec (see this file's
                      `toOscillatorSource` comment) — hidden here rather than shown-but-inert. */}
                  {!oscillatorMode && (
                    <>
                      <div className="field-row">
                        <label>Clip</label>
                        <select
                          className="field"
                          data-testid={`inspector.audio.source.${sourceIndex}.clip`}
                          value={source.audio ?? ""}
                          disabled={audioClips.length === 0}
                          onChange={(e) => setSourceProp(sourceIndex, ["audio"], Number(e.target.value))}
                        >
                          {audioClips.length === 0 && <option value="">no clips — import one first</option>}
                          {audioClips.map((clip, clipIndex) => (
                            <option key={clipIndex} value={clipIndex}>
                              {clip.name ?? clip.uri ?? `Clip ${clipIndex}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field-row">
                        <label>Playback Rate</label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.01"
                          value={source.playbackRate ?? 1}
                          data-testid={`inspector.audio.source.${sourceIndex}.playback-rate`}
                          onChange={(e) => setSourceProp(sourceIndex, ["playbackRate"], Number(e.target.value))}
                        />
                      </div>
                      <div className="field-row">
                        <label>Loop</label>
                        <input
                          type="checkbox"
                          checked={source.loop ?? false}
                          data-testid={`inspector.audio.source.${sourceIndex}.loop`}
                          onChange={(e) => setSourceProp(sourceIndex, ["loop"], e.target.checked)}
                        />
                      </div>
                    </>
                  )}
                  <div className="field-row">
                    <label>Gain</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={source.gain ?? 1}
                      data-testid={`inspector.audio.source.${sourceIndex}.gain`}
                      onChange={(e) => setSourceProp(sourceIndex, ["gain"], Number(e.target.value))}
                    />
                  </div>
                  <div className="field-row">
                    <label>Autoplay</label>
                    <input
                      type="checkbox"
                      checked={source.autoplay ?? false}
                      data-testid={`inspector.audio.source.${sourceIndex}.autoplay`}
                      onChange={(e) => setSourceProp(sourceIndex, ["autoplay"], e.target.checked)}
                    />
                  </div>
                  {oscillatorMode &&
                    OSCILLATOR_SOURCE_FIELDS.filter((field) => isOscillatorSourceFieldVisible(field, oscillator as Record<string, unknown>)).map((field) => {
                      const testId = `inspector.audio.source.${sourceIndex}.oscillator.${field.key}`;
                      const value = (oscillator as Record<string, unknown>)[field.key] ?? field.default;
                      if (field.type === "enum") {
                        return (
                          <div className="field-row" key={field.key}>
                            <label>{field.label}</label>
                            <select className="field" data-testid={testId} value={String(value)} onChange={(e) => setOscillatorProp(field.key, e.target.value)}>
                              {(field.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      }
                      if (field.type === "periodic-wave") {
                        const current = (value ?? {}) as { real?: number[]; imag?: number[] };
                        return (
                          <OscillatorPeriodicWaveFields
                            key={field.key}
                            testId={testId}
                            real={current.real ?? []}
                            imag={current.imag ?? []}
                            onCommit={(real, imag) => setOscillatorProp(field.key, { real, imag })}
                          />
                        );
                      }
                      return (
                        <div className="field-row" key={field.key}>
                          <label>{field.label}</label>
                          <input
                            type="number"
                            step={field.step ?? "any"}
                            min={field.min}
                            max={field.max}
                            value={typeof value === "number" ? value : Number(value) || 0}
                            data-testid={testId}
                            // Bug fix (code review): `e.target.valueAsNumber` is `NaN` for a
                            // momentarily-cleared input (backspaced to empty while retyping) —
                            // `setOscillatorProp` would write that straight through
                            // `SceneEdit.setAudioSourceProperty`, and `JSON.stringify(NaN)`
                            // serializes as `null`, producing a schema-invalid
                            // `oscillator.frequency: null`. `Number(e.target.value)` matches
                            // every OTHER numeric field in this section (Playback Rate, Gain)
                            // and coerces an empty string to `0` instead.
                            onChange={(e) => setOscillatorProp(field.key, Number(e.target.value))}
                          />
                        </div>
                      );
                    })}
                </div>
              );
            })}
          <div className="audio-sources-add-row">
            <button
              className="btn small"
              data-testid="inspector.audio.sources.add-clip"
              disabled={audioClips.length === 0}
              title={audioClips.length === 0 ? "Import a clip in the Assets > Audio Clips tab first." : "Add a clip source."}
              onClick={() => dispatchCommand(SceneEdit.addSourceToEmitter(document, emitterIndex, { audioIndex: 0 }).command)}
            >
              + Add clip source
            </button>
            <button
              className="btn small"
              data-testid="inspector.audio.sources.add-oscillator"
              onClick={() => dispatchCommand(SceneEdit.addSourceToEmitter(document, emitterIndex).command)}
            >
              + Add oscillator source
            </button>
          </div>
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

/** `periodicWave`'s `{real: number[], imag: number[]}` Fourier-coefficient pair — two comma/whitespace-separated-number textareas committed together on blur, mirroring `audio-canvas`'s `audio-param-panel.tsx` `PeriodicWaveField` (not the SAME component: that one is driven by `audioNodeSpec`'s NODE-kind lookup, which an oscillator SOURCE has no entry in — see audio-node-registry.ts's header comment) but sharing its `parseNumberList`/`formatNumberList` parse/format primitives (code review — this used to reimplement them verbatim). */
function OscillatorPeriodicWaveFields({
  testId,
  real,
  imag,
  onCommit
}: {
  testId: string;
  real: number[];
  imag: number[];
  onCommit: (real: number[], imag: number[]) => void;
}): JSX.Element {
  const [realText, setRealText] = useState(() => formatNumberList(real));
  const [imagText, setImagText] = useState(() => formatNumberList(imag));
  function commit(nextRealText: string, nextImagText: string): void {
    onCommit(parseNumberList(nextRealText), parseNumberList(nextImagText));
  }
  return (
    <div className="field-row">
      <label htmlFor={`${testId}.real`}>real</label>
      <textarea
        id={`${testId}.real`}
        data-testid={`${testId}.real`}
        rows={2}
        value={realText}
        onChange={(e) => setRealText(e.target.value)}
        onBlur={() => commit(realText, imagText)}
      />
      <label htmlFor={`${testId}.imag`}>imag</label>
      <textarea
        id={`${testId}.imag`}
        data-testid={`${testId}.imag`}
        rows={2}
        value={imagText}
        onChange={(e) => setImagText(e.target.value)}
        onBlur={() => commit(realText, imagText)}
      />
    </div>
  );
}
