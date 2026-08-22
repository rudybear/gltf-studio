import { SceneEdit, type EditorDocument } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { hexToRgb01, rgb01ToHex } from "../../lib/color";
import { PointerButton } from "./PointerButton";

/**
 * specs/ux-inspector.md UX-417 (r2, full punctual-light control): a node
 * whose glTF entry carries `extensions.KHR_lights_punctual.light` shows
 * this section — an EDITABLE type dropdown (point/spot/directional, r2 —
 * previously read-only), a color picker, an intensity field (own `◈`), and
 * (only when meaningful for the light's own CURRENT type, per the glTF
 * spec's own "range"/"spot" definitions) range and spot inner/outer cone
 * angle. Every editable field here writes via `SceneEdit.setLightProperty`
 * against the ROOT `extensions.KHR_lights_punctual.lights[lightIndex]`
 * registry (addressed by LIGHT index, not the node's own index) and renders
 * live through the vendored @gltfi/three-adapter's own KHR_lights_punctual
 * pointer-router rows — no direct-apply workaround needed here, unlike
 * `MaterialSection`'s doubleSided/texture-clear cases (those have no
 * vendored route; every property this section exposes does). The type
 * dropdown itself writes via the dedicated `SceneEdit.setLightType`
 * (DOC-065) instead — a single whole-light-object replace, not a
 * `setLightProperty(..., ["type"], ...)` call, since converting a type also
 * adds/drops the type-specific `range`/`spot` fields in the SAME undoable
 * command (see that factory's own doc comment for the exact carry-over
 * rules) — a bare `type` field write alone would leave a schema-invalid
 * light (e.g. a `"directional"` light still carrying a `spot` object).
 */
export function LightSection({ lightIndex, json, document }: { lightIndex: number; json: GltfJsonShape; document: EditorDocument }): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const light = json.extensions?.KHR_lights_punctual?.lights?.[lightIndex] ?? {};
  const type = light.type ?? "directional";
  const color = light.color ?? [1, 1, 1];
  const intensity = light.intensity ?? 1;
  const range = light.range ?? 0;
  const innerConeAngle = light.spot?.innerConeAngle ?? 0;
  const outerConeAngle = light.spot?.outerConeAngle ?? Math.PI / 4;

  function setType(newType: "point" | "spot" | "directional"): void {
    dispatchCommand(SceneEdit.setLightType(document, lightIndex, newType));
  }
  function setColor(hex: string): void {
    dispatchCommand(SceneEdit.setLightProperty(document, lightIndex, ["color"], hexToRgb01(hex)));
  }
  function setIntensity(value: number): void {
    dispatchCommand(SceneEdit.setLightProperty(document, lightIndex, ["intensity"], value));
  }
  function setRange(value: number): void {
    dispatchCommand(SceneEdit.setLightProperty(document, lightIndex, ["range"], value));
  }
  function setInnerConeAngle(value: number): void {
    dispatchCommand(SceneEdit.setLightProperty(document, lightIndex, ["spot", "innerConeAngle"], value));
  }
  function setOuterConeAngle(value: number): void {
    dispatchCommand(SceneEdit.setLightProperty(document, lightIndex, ["spot", "outerConeAngle"], value));
  }

  return (
    <div className="inspector-section" data-testid="inspector.light.section">
      <h4>Light</h4>
      <div className="content">
        <div className="field-row">
          <label>Type</label>
          <select
            className="field"
            value={type}
            data-testid="inspector.light.type"
            onChange={(e) => setType(e.target.value as "point" | "spot" | "directional")}
          >
            <option value="point">point</option>
            <option value="spot">spot</option>
            <option value="directional">directional</option>
          </select>
        </div>
        <div className="field-row">
          <label>Color</label>
          <input type="color" value={rgb01ToHex(color)} data-testid="inspector.light.color" onChange={(e) => setColor(e.target.value)} />
        </div>
        <div className="field-row">
          <label>Intensity</label>
          <input
            type="number"
            step="1"
            min="0"
            value={intensity}
            data-testid="inspector.light.intensity"
            onChange={(e) => setIntensity(Number(e.target.value))}
          />
          <PointerButton propKey="light-intensity" path={`/extensions/KHR_lights_punctual/lights/${lightIndex}/intensity`} signature="float" />
        </div>
        {type !== "directional" && (
          <div className="field-row">
            <label>Range</label>
            <input type="number" step="0.1" min="0" value={range} data-testid="inspector.light.range" onChange={(e) => setRange(Number(e.target.value))} />
            <PointerButton propKey="light-range" path={`/extensions/KHR_lights_punctual/lights/${lightIndex}/range`} signature="float" />
          </div>
        )}
        {type === "spot" && (
          <>
            <div className="field-row">
              <label>Inner Cone Angle</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={innerConeAngle}
                data-testid="inspector.light.inner-cone-angle"
                onChange={(e) => setInnerConeAngle(Number(e.target.value))}
              />
              <PointerButton
                propKey="light-inner-cone-angle"
                path={`/extensions/KHR_lights_punctual/lights/${lightIndex}/spot/innerConeAngle`}
                signature="float"
              />
            </div>
            <div className="field-row">
              <label>Outer Cone Angle</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={outerConeAngle}
                data-testid="inspector.light.outer-cone-angle"
                onChange={(e) => setOuterConeAngle(Number(e.target.value))}
              />
              <PointerButton
                propKey="light-outer-cone-angle"
                path={`/extensions/KHR_lights_punctual/lights/${lightIndex}/spot/outerConeAngle`}
                signature="float"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
