import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store/app-store";
import { flattenSceneTree, type GltfJsonShape } from "../../lib/gltf-scene";
import { NodeIcon } from "../scene-tree/NodeIcon";
import {
  buildPointerContentTree,
  lightPropPath,
  lightPropsFor,
  materialPropPath,
  nodePropPath,
  nodePropsFor,
  parsePointerPath,
  MATERIAL_PROPS,
  type AnimatablePropertyDef,
  type PointerTreeRow
} from "../../lib/pointer-vocab";

/**
 * specs/ux-pointer-picker.md UX-900..908: the modal pointer-config dialog
 * every `✎` affordance opens (currently only `specs/ux-graph-canvas.md`'s
 * `UX-505` pointer-node icon — see that file's task note for the Inspector
 * `◈` unification status). Mounted once at App.tsx's top level (like
 * ToastLayer/TestIdOverlay), driven entirely by the store's
 * `pointerPickerRequest` (null = closed).
 */
export function PointerPickerDialog(): JSX.Element | null {
  // Named `editorDocument` (not `document`) so it doesn't shadow the global
  // `window.document` the Escape-key listener effect below needs.
  const editorDocument = useAppStore((s) => s.document);
  const request = useAppStore((s) => s.pointerPickerRequest);
  const showIndices = useAppStore((s) => s.showIndices);
  const closePointerPicker = useAppStore((s) => s.closePointerPicker);
  const confirmPointerPicker = useAppStore((s) => s.confirmPointerPicker);

  const json = editorDocument?.json as GltfJsonShape | undefined;

  const [query, setQuery] = useState("");
  const [section, setSection] = useState<PointerTreeRow["section"] | null>(null);
  const [selKey, setSelKey] = useState<number | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // UX-907: preselect the tree item/property/component an EXISTING pointer
  // config names, every time the dialog is opened (a fresh `request` object
  // identity, since `openPointerPicker` always creates a new one) — never
  // "blank" for a node that already has a valid path.
  useEffect(() => {
    if (!request) return;
    setQuery("");
    const parsed = request.currentPath ? parsePointerPath(request.currentPath, json) : null;
    if (parsed) {
      setSection(parsed.section);
      setSelKey(parsed.index);
      setPath(request.currentPath ?? null);
      setType(parsed.type);
      setExpanded(parsed.compIndex !== undefined ? { [parsed.propKey]: true } : {});
    } else {
      setSection(null);
      setSelKey(null);
      setPath(null);
      setType(null);
      setExpanded({});
    }
    // `request` (a new object identity per open) is the intended re-run
    // trigger — `json` deliberately isn't a dependency here (re-parsing the
    // same still-open request against a mid-edit document would fight the
    // user's in-progress tree/property selection).
  }, [request]);

  // UX-908: Escape closes, equivalently to Cancel/close-x/backdrop-click.
  useEffect(() => {
    if (!request) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") closePointerPicker();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [request, closePointerPicker]);

  const sceneRows = useMemo(() => flattenSceneTree(json), [json]);
  const treeRows = useMemo(() => buildPointerContentTree(json, sceneRows), [json, sceneRows]);

  if (!request) return null;

  const q = query.trim().toLowerCase();
  const matches = (label: string) => q.length === 0 || label.toLowerCase().includes(q);

  function selectTreeRow(row: PointerTreeRow) {
    setSection(row.section);
    setSelKey(row.index);
    setPath(null);
    setType(null);
    setExpanded({});
  }

  function selectWhole(prop: AnimatablePropertyDef, base: string) {
    if (!prop.wholeSelectable) return;
    setPath(base);
    setType(prop.type);
  }

  function selectComponent(base: string, i: number) {
    setPath(`${base}/${i}`);
    setType("float");
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function renderTreeSection(label: string, rows: PointerTreeRow[]) {
    const visible = rows.filter((r) => matches(r.label));
    return (
      <div key={label}>
        <div className="pp-section-title">{label}</div>
        {visible.length === 0 ? (
          <div className="empty-note pp-empty-note">No matches</div>
        ) : (
          visible.map((row, i) => (
            <div
              key={`${row.section}-${row.index}`}
              className={`tree-row${section === row.section && selKey === row.index ? " selected" : ""}`}
              style={{ paddingLeft: 6 + row.depth * 14 }}
              data-testid={`pointer-picker.tree.${row.section}.${i}`}
              onClick={() => selectTreeRow(row)}
            >
              <span className="twisty-spacer" />
              <NodeIcon type={row.icon} />
              <span className="tree-label">
                {row.label}
                {showIndices ? <span className="dim"> #{row.index}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
    );
  }

  function propRow(prop: AnimatablePropertyDef, base: string) {
    if (!matches(prop.label)) return null;
    const isExpanded = !!expanded[prop.key];
    const isSelected = path === base;
    return (
      <div className="pp-prop" key={prop.key}>
        <div
          className={`pp-prop-head${isSelected ? " selected" : ""}${!prop.wholeSelectable ? " pp-prop-head-unselectable" : ""}`}
          data-testid={`pointer-picker.prop.${prop.key}`}
          onClick={() => selectWhole(prop, base)}
        >
          {prop.comps > 0 ? (
            <button
              type="button"
              className="pp-twisty"
              data-testid={`pointer-picker.prop.${prop.key}.twisty`}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(prop.key);
              }}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="twisty-spacer" />
          )}
          <span className="pp-prop-name">{prop.label}</span>
          <span className="type-chip">{prop.type}</span>
        </div>
        {prop.comps > 0 && isExpanded ? (
          <div className="pp-prop-comps">
            {Array.from({ length: prop.comps }, (_, i) => (
              <div
                key={i}
                className={`pp-comp-row${path === `${base}/${i}` ? " selected" : ""}`}
                data-testid={`pointer-picker.prop.${prop.key}.${i}`}
                onClick={() => selectComponent(base, i)}
              >
                /{i} <span className="type-chip">float</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderProps() {
    if (section === "animations") {
      const clip = json?.animations?.[selKey ?? -1];
      // UX-905: animation clips are not themselves pointer targets.
      return (
        <div className="pp-empty-hint">
          {clip?.name ? `${clip.name} — ` : ""}Animations are targets of animation/start — drag the clip into the graph instead.
        </div>
      );
    }
    if (section === "nodes" && selKey !== null) {
      return nodePropsFor(selKey, json).map((prop) => propRow(prop, nodePropPath(selKey, prop.key)));
    }
    if (section === "materials" && selKey !== null) {
      return MATERIAL_PROPS.map((prop) => propRow(prop, materialPropPath(selKey, prop.key)));
    }
    if (section === "lights" && selKey !== null) {
      return lightPropsFor(selKey, json).map((prop) => propRow(prop, lightPropPath(selKey, prop.key)));
    }
    return <div className="pp-empty-hint">Select a node, material, light, or animation on the left.</div>;
  }

  const nodeRows = treeRows.filter((r) => r.section === "nodes");
  const materialRows = treeRows.filter((r) => r.section === "materials");
  const lightRows = treeRows.filter((r) => r.section === "lights");
  const animationRows = treeRows.filter((r) => r.section === "animations");

  return (
    <div
      className="modal-overlay open"
      data-testid="pointer-picker.dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePointerPicker(); // UX-908: backdrop click closes without writing.
      }}
    >
      <div className="pp-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Choose pointer target</h3>
          <button className="close-x" data-testid="pointer-picker.close-x" onClick={closePointerPicker}>
            ✕
          </button>
        </div>
        <div className="modal-search">
          <input
            className="field"
            placeholder="Search nodes, materials, lights, animations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="pointer-picker.search"
          />
        </div>
        <div className="modal-body">
          <div className="pp-tree" data-testid="pointer-picker.tree">
            {renderTreeSection("Nodes", nodeRows)}
            {renderTreeSection("Materials", materialRows)}
            {renderTreeSection("Lights", lightRows)}
            {renderTreeSection("Animations", animationRows)}
          </div>
          <div className="pp-props" data-testid="pointer-picker.props">
            {renderProps()}
          </div>
        </div>
        <div className="modal-foot">
          <span className="pp-path mono" data-testid="pointer-picker.path">
            {path ?? "—"}
          </span>
          <span className="type-chip" data-testid="pointer-picker.type-chip" style={{ visibility: type ? "visible" : "hidden" }}>
            {type ?? ""}
          </span>
          <div className="topbar-spacer" />
          <button className="btn" data-testid="pointer-picker.cancel" onClick={closePointerPicker}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="pointer-picker.confirm"
            disabled={!path || !type}
            onClick={() => {
              if (path && type) confirmPointerPicker(path, type);
            }}
          >
            Use pointer
          </button>
        </div>
      </div>
    </div>
  );
}
