import { SceneEdit, type EditorDocument } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { hexToRgb01, rgb01ToHex } from "../../lib/color";
import { PointerButton } from "./PointerButton";

/**
 * specs/ux-inspector.md UX-405: base color / metallic / roughness, written
 * via `SceneEdit.setMaterialProperty`. A node's mesh can have primitives
 * pointing at different materials — `materialIndices` (deduped, in
 * first-appearance order, `lib/mesh-info.ts`'s `uniqueMaterialIndices`) may
 * therefore hold more than one entry, in which case each gets its OWN
 * section (suffixed testids/heading) rather than only ever showing "the"
 * material.
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
  return (
    <>
      {materialIndices.map((materialIndex, orderIndex) => (
        <MaterialSection key={materialIndex} materialIndex={materialIndex} orderIndex={orderIndex} multiple={multiple} json={json} document={document} />
      ))}
    </>
  );
}

function MaterialSection({
  materialIndex,
  orderIndex,
  multiple,
  json,
  document
}: {
  materialIndex: number;
  orderIndex: number;
  multiple: boolean;
  json: GltfJsonShape;
  document: EditorDocument;
}): JSX.Element {
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const material = json.materials?.[materialIndex];
  const pbr = material?.pbrMetallicRoughness ?? {};
  const baseColor = pbr.baseColorFactor ?? [1, 1, 1, 1];
  const metallic = pbr.metallicFactor ?? 1;
  const roughness = pbr.roughnessFactor ?? 1;

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
      </div>
    </div>
  );
}
