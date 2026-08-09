import { useMemo, useState } from "react";
import { SCENE_NODE_DRAG_MIME } from "@gltf-studio/graph-canvas";
import { useAppStore } from "../../store/app-store";
import { flattenSceneTree, visibleRows, type GltfJsonShape } from "../../lib/gltf-scene";
import { NodeIcon } from "./NodeIcon";

const ADD_MENU_ENTRIES = [
  { key: "mesh", label: "Mesh" },
  { key: "light", label: "Light" },
  { key: "camera", label: "Camera" },
  { key: "audio-emitter", label: "Audio Emitter" },
  { key: "group", label: "Empty Group" }
] as const;

/**
 * specs/ux-scene-tree.md UX-200..206: real hierarchy from `document.json`
 * (names, type icons, twisties, show-indices), synced selection (UX-202).
 * The add-menu's five entries are a stable stub per UX-206 — structural
 * scene-edit commands (SceneEdit.*, ADR-0004) land at M8, so choosing an
 * entry just toasts rather than mutating the document.
 */
export function SceneTree(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);
  const selectNode = useAppStore((s) => s.selectNode);
  const collapsedNodes = useAppStore((s) => s.collapsedNodes);
  const toggleCollapsed = useAppStore((s) => s.toggleCollapsed);
  const showIndices = useAppStore((s) => s.showIndices);
  const toggleShowIndices = useAppStore((s) => s.toggleShowIndices);
  const pushToast = useAppStore((s) => s.pushToast);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // `scene-tree.row.N`'s `N` is this node's position in the FULL depth-first
  // flatten (stable regardless of collapse state) — a collapsed descendant
  // is hidden via CSS (`display:none`, like the approved mockup), not
  // removed from `rows`/re-indexed, so a row's testid never shifts out from
  // under an already-written test just because a sibling collapsed (UX-201).
  const { rows, hiddenNodes } = useMemo(() => {
    const flat = flattenSceneTree(document?.json as GltfJsonShape | undefined);
    const visible = new Set(visibleRows(flat, collapsedNodes).map((r) => r.nodeIndex));
    return { rows: flat, hiddenNodes: new Set(flat.filter((r) => !visible.has(r.nodeIndex)).map((r) => r.nodeIndex)) };
  }, [document, collapsedNodes]);

  return (
    <div id="scene-tree-section" className="panel-section">
      <div className="panel-header">
        <span>Scene</span>
        <button
          className={`btn icon-only small${showIndices ? " active" : ""}`}
          data-testid="scene-tree.toggle-indices"
          title="Show glTF indices"
          aria-pressed={showIndices}
          onClick={toggleShowIndices}
        >
          #
        </button>
      </div>
      <div className="panel-body" data-testid="scene-tree.list">
        {!document ? (
          <div className="empty-note" data-testid="scene-tree.empty">
            Import a .glb to see its scene hierarchy.
          </div>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.nodeIndex}
              className={`tree-row${row.nodeIndex === selectedNodeIndex ? " selected" : ""}`}
              style={{ paddingLeft: 6 + row.depth * 16, display: hiddenNodes.has(row.nodeIndex) ? "none" : undefined }}
              data-testid={`scene-tree.row.${i}`}
              onClick={() => selectNode(row.nodeIndex)}
              draggable
              onDragStart={(e) => {
                // specs/ux-scene-tree.md UX-209 / specs/ux-graph-canvas.md
                // UX-508: dragged onto the behavior-graph canvas, this opens
                // a drop-menu scoped to this node (pointer/get|set|
                // interpolate, event/onSelect).
                e.dataTransfer.setData(SCENE_NODE_DRAG_MIME, String(row.nodeIndex));
                e.dataTransfer.setData("text/plain", String(row.nodeIndex));
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              {row.hasChildren ? (
                <button
                  className="twisty"
                  data-testid={`scene-tree.row.${i}.twisty`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapsed(row.nodeIndex);
                  }}
                >
                  {collapsedNodes.has(row.nodeIndex) ? "▸" : "▾"}
                </button>
              ) : (
                <span className="twisty-spacer" />
              )}
              <NodeIcon type={row.icon} />
              <span className="tree-label">
                {row.name}
                {showIndices ? <span className="dim"> #{row.nodeIndex}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="add-row">
        <button className="btn small" data-testid="scene-tree.add" onClick={() => setAddMenuOpen((v) => !v)}>
          + Add
        </button>
        <ul className={`add-menu${addMenuOpen ? " open" : ""}`} data-testid="scene-tree.add-menu">
          {ADD_MENU_ENTRIES.map((entry) => (
            <li key={entry.key}>
              <button
                data-testid={`scene-tree.add-menu.${entry.key}`}
                onClick={() => {
                  setAddMenuOpen(false);
                  pushToast(`${entry.label}: structural scene edits arrive at M8.`);
                }}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
