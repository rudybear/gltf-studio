import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";
import { otherNodesUsingMesh, primitiveModeLabel, triangleCount } from "../../lib/mesh-info";

/**
 * specs/ux-inspector.md UX-407..410: rendered between Transform and Material
 * whenever the selected node's glTF entry has a `mesh`. Primitives are
 * collapsed-by-default `<details>` rows (UX-408); a primitive's material
 * link (UX-409) switches the asset browser to Materials and flashes that
 * row — it deliberately does NOT navigate the Data tab (that's reserved for
 * a deliberate asset-browser-row click, UX-211) and does not fall through to
 * the `<details>` toggle (`preventDefault`/`stopPropagation`).
 */
export function MeshSection({ nodeIndex, meshIndex, json }: { nodeIndex: number; meshIndex: number; json: GltfJsonShape }): JSX.Element | null {
  const selectMaterialContext = useAppStore((s) => s.selectMaterialContext);
  const mesh = json.meshes?.[meshIndex];
  if (!mesh) return null;

  const accessors = json.accessors ?? [];
  const materials = json.materials ?? [];
  const meshName = mesh.name && mesh.name.length > 0 ? mesh.name : `Mesh ${meshIndex}`;
  const others = otherNodesUsingMesh(json, meshIndex, nodeIndex);

  return (
    <div className="inspector-section" data-testid="inspector.mesh.section">
      <h4>
        Mesh #{meshIndex} · {meshName} · {mesh.primitives.length} primitive{mesh.primitives.length === 1 ? "" : "s"}
      </h4>
      <div className="content">
        {mesh.primitives.map((prim, i) => {
          const matIndex = prim.material;
          const matName = matIndex !== undefined ? (materials[matIndex]?.name ?? `Material ${matIndex}`) : undefined;
          const tris = triangleCount(prim, accessors);
          return (
            <details key={i} className="mesh-prim" data-testid={`inspector.mesh.primitive.${i}`}>
              <summary>
                primitive {i} —{" "}
                {matIndex !== undefined ? (
                  <button
                    type="button"
                    className="mesh-mat-link"
                    data-testid={`inspector.mesh.material-link.${i}`}
                    onClick={(e) => {
                      e.preventDefault(); // don't let the click also toggle the <details> open/closed
                      e.stopPropagation();
                      selectMaterialContext(matIndex);
                    }}
                  >
                    material #{matIndex} {matName}
                  </button>
                ) : (
                  <span className="dim">no material</span>
                )}{" "}
                · {primitiveModeLabel(prim.mode)} · indices:{" "}
                {prim.indices !== undefined ? `accessor #${prim.indices}${tris !== undefined ? ` (${tris} tris)` : ""}` : "none (non-indexed)"}
              </summary>
              <div className="mesh-prim-body">
                <div className="mesh-attr-table">
                  {Object.entries(prim.attributes).map(([name, accessorIndex]) => {
                    const accessor = accessors[accessorIndex];
                    return (
                      <div key={name} data-testid={`inspector.mesh.attr.${name}`}>
                        {name} → accessor #{accessorIndex}
                        {accessor ? ` (${accessor.type} ${accessor.componentType} ${accessor.count})` : ""}
                      </div>
                    );
                  })}
                </div>
                {prim.targets && prim.targets.length > 0 && (
                  <div className="dim">morph targets: {prim.targets.length} (weights on node)</div>
                )}
              </div>
            </details>
          );
        })}
        {others.length > 0 && (
          <div className="dim mesh-shared-note" data-testid="inspector.mesh.shared-note">
            also used by: {others.join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
