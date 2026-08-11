import { useMemo, useRef, useState } from "react";
import { SCENE_NODE_DRAG_MIME } from "@gltf-studio/graph-canvas";
import { SceneEdit, type Command } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import { flattenSceneTree, visibleRows, type GltfJsonShape } from "../../lib/gltf-scene";
import { NodeIcon } from "./NodeIcon";
import { ContextMenu } from "../ContextMenu";

const MESH_SUBMENU_ENTRIES = [
  { kind: "cube", label: "Cube" },
  { kind: "sphere", label: "Sphere" },
  { kind: "plane", label: "Plane" }
] as const;

/**
 * specs/ux-scene-tree.md UX-200..206: real hierarchy from `document.json`
 * (names, type icons, twisties, show-indices), synced selection (UX-202).
 *
 * UX-205/UX-206 (M8-lite): the add-menu's five entries create REAL content
 * via the `SceneEdit.add*Node` composite factories (`packages/editor-core/
 * src/scene-edit.ts`, DOC-047) — each a single undoable command. "Mesh"
 * expands a submenu (Cube/Sphere/Plane, `primitives.ts`) rather than
 * creating directly, since a submenu still counts as ONE top-level entry
 * for UX-205's "exactly five entries" count. Every entry lands the new
 * node under the currently-selected node (`opts.parentNodeIndex`) when one
 * is selected, else the scene root, then auto-selects the new node and
 * opens its inline rename (reusing the same `renamingNode`/`renameValue`
 * state UX-207's context-menu "Rename" action already drives) so the
 * default name is immediately editable. Full structural editing
 * (reparent/delete existing nodes) remains M8.
 *
 * UX-207/UX-208: right-clicking a row opens a Frame / Rename / "✦ Ask
 * Copilot about this…" menu at the cursor. Frame routes through the store's
 * `frameRequest` cross-component signal (Viewport.tsx owns the real
 * RenderHost, this component has no reach into it); Rename is a real inline
 * edit -> `SceneEdit.setName`; Ask Copilot switches the right panel to
 * Copilot and attaches an explicit chip naming this node.
 */
export function SceneTree(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const history = useAppStore((s) => s.history);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);
  const selectNode = useAppStore((s) => s.selectNode);
  const collapsedNodes = useAppStore((s) => s.collapsedNodes);
  const toggleCollapsed = useAppStore((s) => s.toggleCollapsed);
  const showIndices = useAppStore((s) => s.showIndices);
  const toggleShowIndices = useAppStore((s) => s.toggleShowIndices);
  const dispatchCommand = useAppStore((s) => s.dispatchCommand);
  const requestFrame = useAppStore((s) => s.requestFrame);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);
  const addCopilotContextChip = useAppStore((s) => s.addCopilotContextChip);
  const requestCopilotComposerFocus = useAppStore((s) => s.requestCopilotComposerFocus);
  const selectedGraphNodeIndex = useAppStore((s) => s.selectedGraphNodeIndex);
  const selectedGraphIndex = useAppStore((s) => s.selectedGraphIndex);
  // UX-1110 (specs/ux-usage-mapping.md): same derived amber reference-
  // highlight the viewport shows, mirrored here for the scene tree row —
  // see Viewport.tsx's own use of this getter for the full doc comment.
  const referenceHighlightNodeIndex = useMemo(
    () => useAppStore.getState().referenceHighlightSceneNodeIndex(),
    [document, selectedGraphNodeIndex, selectedGraphIndex]
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [meshSubmenuOpen, setMeshSubmenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeIndex: number } | null>(null);
  const [renamingNode, setRenamingNode] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

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

  function commitRename(): void {
    if (renamingNode === null || !history) {
      setRenamingNode(null);
      return;
    }
    const name = renameValue.trim();
    if (name) dispatchCommand(SceneEdit.setName(history.document, renamingNode, name));
    setRenamingNode(null);
  }

  // UX-206: every add-menu entry dispatches its `SceneEdit.add*Node` command
  // as one undo step, then auto-selects the new node and opens the SAME
  // inline-rename affordance UX-207's context-menu "Rename" action uses, so
  // the default name is immediately editable without a second click.
  function afterCreate(command: Command, newNodeIndex: number, defaultName: string): void {
    dispatchCommand(command);
    selectNode(newNodeIndex);
    setRenamingNode(newNodeIndex);
    setRenameValue(defaultName);
    setAddMenuOpen(false);
    setMeshSubmenuOpen(false);
  }

  // UX-206: lands under the currently-selected node (append-only: last
  // child) when one is selected, else the current default scene's root.
  const newNodeParent = selectedNodeIndex ?? undefined;

  function createMesh(kind: "cube" | "sphere" | "plane"): void {
    if (!history) return;
    const label = kind === "cube" ? "Cube" : kind === "sphere" ? "Sphere" : "Plane";
    const { command, index } = SceneEdit.addPrimitiveMeshNode(history.document, kind, label, { parentNodeIndex: newNodeParent });
    afterCreate(command, index, label);
  }

  function createLight(): void {
    if (!history) return;
    const { command, index } = SceneEdit.addLightNode(history.document, "Point Light", { parentNodeIndex: newNodeParent });
    afterCreate(command, index, "Point Light");
  }

  function createCamera(): void {
    if (!history) return;
    const { command, index } = SceneEdit.addCameraNode(history.document, "Camera", { parentNodeIndex: newNodeParent });
    afterCreate(command, index, "Camera");
  }

  function createAudioEmitter(): void {
    if (!history) return;
    const { command, index } = SceneEdit.addAudioEmitterNode(history.document, "Audio Emitter", { parentNodeIndex: newNodeParent });
    afterCreate(command, index, "Audio Emitter");
  }

  function createGroup(): void {
    if (!history) return;
    const { command, index } = SceneEdit.addNode(history.document, { name: "Empty Group" }, { parentNodeIndex: newNodeParent });
    afterCreate(command, index, "Empty Group");
  }

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
              className={`tree-row${row.nodeIndex === selectedNodeIndex ? " selected" : ""}${row.nodeIndex === referenceHighlightNodeIndex ? " ref-highlighted" : ""}`}
              style={{ paddingLeft: 6 + row.depth * 16, display: hiddenNodes.has(row.nodeIndex) ? "none" : undefined }}
              data-testid={`scene-tree.row.${i}`}
              onClick={() => selectNode(row.nodeIndex)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, nodeIndex: row.nodeIndex });
              }}
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
              {renamingNode === row.nodeIndex ? (
                <input
                  ref={renameInputRef}
                  className="tree-rename-input"
                  data-testid={`scene-tree.row.${i}.rename-input`}
                  value={renameValue}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setRenamingNode(null);
                  }}
                />
              ) : (
                <span className="tree-label">
                  {row.name}
                  {showIndices ? <span className="dim"> #{row.nodeIndex}</span> : null}
                </span>
              )}
            </div>
          ))
        )}
      </div>
      <div className="add-row">
        <button
          className="btn small"
          data-testid="scene-tree.add"
          onClick={() =>
            setAddMenuOpen((v) => {
              if (v) setMeshSubmenuOpen(false); // closing the top menu also collapses any open submenu
              return !v;
            })
          }
        >
          + Add
        </button>
        <ul className={`add-menu${addMenuOpen ? " open" : ""}`} data-testid="scene-tree.add-menu">
          <li>
            <button data-testid="scene-tree.add-menu.mesh" onClick={() => setMeshSubmenuOpen((v) => !v)}>
              Mesh ▸
            </button>
            <ul className={`add-menu add-submenu${meshSubmenuOpen ? " open" : ""}`} data-testid="scene-tree.add-menu.mesh-submenu">
              {MESH_SUBMENU_ENTRIES.map((entry) => (
                <li key={entry.kind}>
                  <button data-testid={`scene-tree.add-menu.mesh.${entry.kind}`} onClick={() => createMesh(entry.kind)}>
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </li>
          <li>
            <button data-testid="scene-tree.add-menu.light" onClick={createLight}>
              Light
            </button>
          </li>
          <li>
            <button data-testid="scene-tree.add-menu.camera" onClick={createCamera}>
              Camera
            </button>
          </li>
          <li>
            <button data-testid="scene-tree.add-menu.audio-emitter" onClick={createAudioEmitter}>
              Audio Emitter
            </button>
          </li>
          <li>
            <button data-testid="scene-tree.add-menu.group" onClick={createGroup}>
              Empty Group
            </button>
          </li>
        </ul>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          testId="scene-tree.context-menu"
          onDismiss={() => setContextMenu(null)}
          actions={[
            {
              key: "frame",
              label: "Frame",
              onSelect: () => requestFrame(contextMenu.nodeIndex)
            },
            {
              key: "rename",
              label: "Rename",
              onSelect: () => {
                const row = rows.find((r) => r.nodeIndex === contextMenu.nodeIndex);
                setRenamingNode(contextMenu.nodeIndex);
                setRenameValue(row?.name ?? "");
              }
            },
            {
              key: "ask-copilot",
              label: "✦ Ask Copilot about this…",
              onSelect: () => {
                const row = rows.find((r) => r.nodeIndex === contextMenu.nodeIndex);
                const label = row?.name ?? `Node ${contextMenu.nodeIndex}`;
                setActiveRightTab("copilot");
                addCopilotContextChip({ kind: "explicit", label, pointer: `/nodes/${contextMenu.nodeIndex}` }, label);
                requestCopilotComposerFocus();
              }
            }
          ]}
        />
      )}
    </div>
  );
}
