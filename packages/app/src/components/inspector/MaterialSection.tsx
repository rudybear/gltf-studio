import { SceneEdit, type EditorDocument } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { hexToRgb01, rgb01ToHex } from "../../lib/color";
import { getTextureInfo, imageIndexForTextureInfo, TEXTURE_SLOTS } from "../../lib/material-textures";
import { useTextureThumbnails } from "../../hooks/use-texture-thumbnails";
import { PointerButton } from "./PointerButton";

const ALPHA_MODES = ["OPAQUE", "MASK", "BLEND"] as const;

/**
 * specs/ux-inspector.md UX-405/UX-415/UX-416: base color / metallic /
 * roughness (UX-405), emissiveFactor / alphaMode+alphaCutoff / doubleSided
 * (UX-415), and the Texture Slots sub-section (UX-416) — written via
 * `SceneEdit.setMaterialProperty`/`clearMaterialTexture`/
 * `setMaterialTextureTransform`. A node's mesh can have primitives pointing
 * at different materials — `materialIndices` (deduped, in first-appearance
 * order, `lib/mesh-info.ts`'s `uniqueMaterialIndices`) may therefore hold
 * more than one entry, in which case each gets its OWN section (suffixed
 * testids/heading) rather than only ever showing "the" material.
 *
 * Texture thumbnails are decoded ONCE here (not per-material, per-slot) via
 * `useTextureThumbnails` and passed down — the document's `images[]` are
 * shared across every material's texture slots, so decoding once per
 * `MaterialSections` render (keyed on `document.container`'s own identity,
 * see that hook's own doc comment) avoids redundant work when a node's mesh
 * references more than one material.
 */
export function MaterialSections({
  materialIndices,
  json,
  document
}: {
  materialIndices: number[];
  json: GltfJsonShape;
  document: EditorDocument;
}): JSX.Element {
  const multiple = materialIndices.length > 1;
  const thumbnails = useTextureThumbnails(document);
  return (
    <>
      {materialIndices.map((materialIndex, orderIndex) => (
        <MaterialSection
          key={materialIndex}
          materialIndex={materialIndex}
          orderIndex={orderIndex}
          multiple={multiple}
          json={json}
          document={document}
          thumbnails={thumbnails}
        />
      ))}
    </>
  );
}

function MaterialSection({
  materialIndex,
  orderIndex,
  multiple,
  json,
  document,
  thumbnails
}: {
  materialIndex: number;
  orderIndex: number;
  multiple: boolean;
  json: GltfJsonShape;
  document: EditorDocument;
  thumbnails: Map<number, string>;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const material = json.materials?.[materialIndex];
  const pbr = material?.pbrMetallicRoughness ?? {};
  const baseColor = pbr.baseColorFactor ?? [1, 1, 1, 1];
  const metallic = pbr.metallicFactor ?? 1;
  const roughness = pbr.roughnessFactor ?? 1;
  const emissiveFactor = material?.emissiveFactor ?? [0, 0, 0];
  const alphaMode = material?.alphaMode ?? "OPAQUE";
  const alphaCutoff = material?.alphaCutoff ?? 0.5;
  const doubleSided = material?.doubleSided ?? false;

  const sectionTestId = multiple ? `inspector.material.section.${orderIndex}` : "inspector.material.section";
  const suffix = (base: string) => (multiple ? `${base}.${orderIndex}` : base);

  function setBaseColor(hex: string): void {
    const [r, g, b] = hexToRgb01(hex);
    dispatchCommand(SceneEdit.setMaterialProperty(document, materialIndex, ["pbrMetallicRoughness", "baseColorFactor"], [r, g, b, baseColor[3] ?? 1]));
  }
  function setMetallic(value: number): void {
    dispatchCommand(SceneEdit.setMaterialProperty(document, materialIndex, ["pbrMetallicRoughness", "metallicFactor"], value));
  }
  function setRoughness(value: number): void {
    dispatchCommand(SceneEdit.setMaterialProperty(document, materialIndex, ["pbrMetallicRoughness", "roughnessFactor"], value));
  }
  function setEmissiveFactor(hex: string): void {
    dispatchCommand(SceneEdit.setMaterialProperty(document, materialIndex, ["emissiveFactor"], hexToRgb01(hex)));
  }
  function setAlphaMode(value: string): void {
    dispatchCommand(SceneEdit.setMaterialProperty(document, materialIndex, ["alphaMode"], value));
  }
  function setAlphaCutoff(value: number): void {
    dispatchCommand(SceneEdit.setMaterialProperty(document, materialIndex, ["alphaCutoff"], value));
  }
  function setDoubleSided(value: boolean): void {
    dispatchCommand(SceneEdit.setMaterialProperty(document, materialIndex, ["doubleSided"], value));
  }

  return (
    <div className="inspector-section" data-testid={sectionTestId}>
      <h4>
        Material{multiple ? ` #${materialIndex}${material?.name ? " " + material.name : ""}` : ""}
      </h4>
      <div className="content">
        <div className="field-row">
          <label>Base Color</label>
          <input
            type="color"
            value={rgb01ToHex(baseColor)}
            data-testid={suffix("inspector.material.base-color")}
            onChange={(e) => setBaseColor(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label>Metallic</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={metallic}
            data-testid={suffix("inspector.material.metallic")}
            onChange={(e) => setMetallic(Number(e.target.value))}
          />
          <PointerButton
            propKey={suffix("metallic")}
            path={`/materials/${materialIndex}/pbrMetallicRoughness/metallicFactor`}
            signature="float"
          />
        </div>
        <div className="field-row">
          <label>Roughness</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={roughness}
            data-testid={suffix("inspector.material.roughness")}
            onChange={(e) => setRoughness(Number(e.target.value))}
          />
          <PointerButton
            propKey={suffix("roughness")}
            path={`/materials/${materialIndex}/pbrMetallicRoughness/roughnessFactor`}
            signature="float"
          />
        </div>
        {/* UX-415: emissiveFactor/alphaMode+alphaCutoff/doubleSided — each renders live
            (see specs/ux-inspector.md UX-415's own doc comment for each field's render
            path: emissiveFactor/alphaCutoff go straight through the vendored
            pointer-router; doubleSided goes through engine-three's own direct
            three.js Material.side apply, material-extras.ts; alphaMode is a
            load-time-only glTF field with no runtime pointer, so it takes the
            generic "needs-reload" fallback, which re-parses it correctly.) */}
        <div className="field-row">
          <label>Emissive</label>
          <input
            type="color"
            value={rgb01ToHex(emissiveFactor)}
            data-testid={suffix("inspector.material.emissive")}
            onChange={(e) => setEmissiveFactor(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label>Alpha Mode</label>
          <select
            className="field"
            data-testid={suffix("inspector.material.alpha-mode")}
            value={alphaMode}
            onChange={(e) => setAlphaMode(e.target.value)}
          >
            {ALPHA_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
        {alphaMode === "MASK" && (
          <div className="field-row">
            <label>Alpha Cutoff</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={alphaCutoff}
              data-testid={suffix("inspector.material.alpha-cutoff")}
              onChange={(e) => setAlphaCutoff(Number(e.target.value))}
            />
            <PointerButton propKey={suffix("alpha-cutoff")} path={`/materials/${materialIndex}/alphaCutoff`} signature="float" />
          </div>
        )}
        <div className="field-row">
          <label>Double Sided</label>
          <input
            type="checkbox"
            checked={doubleSided}
            data-testid={suffix("inspector.material.double-sided")}
            onChange={(e) => setDoubleSided(e.target.checked)}
          />
        </div>
      </div>
      <TextureSlotsSubsection materialIndex={materialIndex} suffix={suffix} json={json} document={document} thumbnails={thumbnails} />
    </div>
  );
}

/**
 * specs/ux-inspector.md UX-416: lists the 5 core-glTF texture-info slots
 * (`lib/material-textures.ts`'s `TEXTURE_SLOTS`) a material can carry — each
 * showing a decoded thumbnail when set (`useTextureThumbnails`, "…" while
 * still decoding, "not set" when the slot is absent), a Clear control, and
 * — for a slot that IS set — its `KHR_texture_transform` offset/scale/
 * rotation as small editable fields (`SceneEdit.setMaterialTextureTransform`,
 * live via the vendored pointer-router's own per-texture-info rows). v1 is
 * READ + CLEAR + transform-edit only — texture REPLACEMENT/upload is a
 * bigger, separately-scoped lift (this section's own PR notes it as a
 * follow-up, not silently missing).
 */
function TextureSlotsSubsection({
  materialIndex,
  suffix,
  json,
  document,
  thumbnails
}: {
  materialIndex: number;
  suffix: (base: string) => string;
  json: GltfJsonShape;
  document: EditorDocument;
  thumbnails: Map<number, string>;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const material = json.materials?.[materialIndex];

  return (
    <div className="content texture-slots" data-testid={suffix("inspector.material.texture-slots")}>
      <h5>Textures</h5>
      {TEXTURE_SLOTS.map((slot) => {
        const textureInfo = getTextureInfo(material, slot);
        const imageIndex = imageIndexForTextureInfo(json, textureInfo);
        const thumbUrl = imageIndex !== undefined ? thumbnails.get(imageIndex) : undefined;
        const transform = textureInfo?.extensions?.KHR_texture_transform;
        const offset = transform?.offset ?? [0, 0];
        const scale = transform?.scale ?? [1, 1];
        const rotation = transform?.rotation ?? 0;

        function setTransform(field: "offset" | "scale" | "rotation", value: number[] | number): void {
          dispatchCommand(SceneEdit.setMaterialTextureTransform(document, materialIndex, slot.path, field, value));
        }

        return (
          <div key={slot.key} className="texture-slot-row" data-testid={suffix(`inspector.material.texture.${slot.key}`)}>
            <div className="texture-slot-thumb">
              {textureInfo ? (
                thumbUrl ? (
                  <img src={thumbUrl} alt={slot.label} data-testid={suffix(`inspector.material.texture.${slot.key}.thumb`)} />
                ) : (
                  <span className="dim texture-thumb-placeholder">…</span>
                )
              ) : (
                <span className="dim texture-thumb-placeholder" data-testid={suffix(`inspector.material.texture.${slot.key}.unset`)}>
                  not set
                </span>
              )}
            </div>
            <div className="texture-slot-meta">
              <span>{slot.label}</span>
              {textureInfo && (
                <button
                  type="button"
                  className="btn small"
                  data-testid={suffix(`inspector.material.texture.${slot.key}.clear`)}
                  onClick={() => dispatchCommand(SceneEdit.clearMaterialTexture(document, materialIndex, slot.path))}
                >
                  Clear
                </button>
              )}
            </div>
            {textureInfo && (
              <div className="texture-transform-row" data-testid={suffix(`inspector.material.texture.${slot.key}.transform`)}>
                <label className="axis-label">off</label>
                <input
                  type="number"
                  step="0.01"
                  value={offset[0]}
                  data-testid={suffix(`inspector.material.texture.${slot.key}.offset-x`)}
                  onChange={(e) => setTransform("offset", [Number(e.target.value), offset[1]])}
                />
                <input
                  type="number"
                  step="0.01"
                  value={offset[1]}
                  data-testid={suffix(`inspector.material.texture.${slot.key}.offset-y`)}
                  onChange={(e) => setTransform("offset", [offset[0], Number(e.target.value)])}
                />
                <label className="axis-label">scale</label>
                <input
                  type="number"
                  step="0.01"
                  value={scale[0]}
                  data-testid={suffix(`inspector.material.texture.${slot.key}.scale-x`)}
                  onChange={(e) => setTransform("scale", [Number(e.target.value), scale[1]])}
                />
                <input
                  type="number"
                  step="0.01"
                  value={scale[1]}
                  data-testid={suffix(`inspector.material.texture.${slot.key}.scale-y`)}
                  onChange={(e) => setTransform("scale", [scale[0], Number(e.target.value)])}
                />
                <label className="axis-label">rot</label>
                <input
                  type="number"
                  step="0.01"
                  value={rotation}
                  data-testid={suffix(`inspector.material.texture.${slot.key}.rotation`)}
                  onChange={(e) => setTransform("rotation", Number(e.target.value))}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
