import { useMemo, useRef, useState } from "react";
import { SCENE_NODE_DRAG_MIME } from "@gltf-studio/graph-canvas";
import { SceneEdit, type Command } from "@gltf-studio/editor-core";
import { useAppStore } from "../../store/app-store";
import { countSubtreeNodes, flattenSceneTree, visibleRows, type GltfJsonShape } from "../../lib/gltf-scene";
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
 * default name is immediately editable.
 *
 * UX-207/UX-208/UX-214/UX-216: right-clicking a row opens a Frame / Rename /
 * Duplicate / "✦ Ask Copilot about this…" / Reparent to root / Delete menu
 * at the cursor. Frame routes through the store's `frameRequest`
 * cross-component signal (Viewport.tsx owns the real RenderHost, this
 * component has no reach into it); Rename is a real inline edit ->
 * `SceneEdit.setName`; Duplicate (UX-216, DOC-053) and Reparent to root
 * (UX-215, DOC-052) call the store's `duplicateNode`/`reparentNode` actions,
 * both one undoable command each; Ask Copilot switches the right panel to
 * Copilot and attaches an explicit chip naming this node; Delete (UX-214,
 * DOC-048) calls the store's `deleteNode` — one undoable
 * `SceneEdit.removeNode` command deleting the row's ENTIRE subtree, its
 * label naming the subtree's node count (`countSubtreeNodes`) whenever
 * that's more than just the one row — then moves selection to the deleted
 * node's former parent (or clears it for a scene-root). The same
 * `deleteNode` action also backs the Delete/Backspace keyboard shortcut
 * (`App.tsx`'s app-level keydown handler) when a scene node is selected;
 * Duplicate's own Ctrl/Cmd+D shortcut is scoped to this component instead
 * (a row must have actual DOM focus, `tabIndex={0}` below) since it isn't
 * meant to fire from anywhere else in the app the way Delete/Backspace is.
 *
 * UX-215 (DOC-052): each row is also a drag-and-drop reparent TARGET (in
 * addition to already being a drag SOURCE for UX-209's drop-onto-the-
 * behavior-graph flow, unchanged below) — dropping one row onto another
 * calls `reparentNode(source, target)`; dropping onto the tree's own empty
 * background (below every row) calls `reparentNode(source, null)`,
 * "Reparent to root". Into-only v1: a drop always lands as the target's
 * LAST child (no between-siblings drop indicator yet — see this file's own
 * `app.css` `.tree-row.drag-over` comment). A cycle attempt (dropping a row
 * onto itself or one of its own descendants) is rejected by the store's
 * `reparentNode` action with a toast, not a thrown exception reaching here.
 */
export function SceneTree(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const history = useAppStore((s) => s.history);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);
  const selectNode = useAppStore((s) => s.selectNode);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const reparentNode = useAppStore((s) => s.reparentNode);
  const duplicateNode = useAppStore((s) => s.duplicateNode);
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
  // UX-215 (DOC-052): which row a scene-node drag is currently over (into-only
  // v1's one drop indicator) — cleared on drop/dragleave/drag end.
  const [dragOverNodeIndex, setDragOverNodeIndex] = useState<number | null>(null);

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
      <div
        className="panel-body"
        data-testid="scene-tree.list"
        onDragOver={(e) => {
          // UX-215: dropping onto the tree's own empty background (i.e. NOT
          // onto any row -- a row's own onDrop below stops propagation, so
          // this only ever fires for a genuine background drop) is
          // "Reparent to root". Accept the same drag type a row accepts.
          if (!e.dataTransfer.types.includes(SCENE_NODE_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(SCENE_NODE_DRAG_MIME)) return;
          e.preventDefault();
          const raw = e.dataTransfer.getData(SCENE_NODE_DRAG_MIME);
          if (!raw) return;
          reparentNode(Number(raw), null);
          setDragOverNodeIndex(null);
        }}
      >
        {!document ? (
          <div className="empty-note" data-testid="scene-tree.empty">
            Import a .glb to see its scene hierarchy.
          </div>
        ) : rows.length === 0 ? (
          // specs/ux-shell.md UX-120: a real document with zero root nodes
          // (e.g. the empty-scene starter card) is not the "no document"
          // case above -- distinct testid, distinct copy pointing at the
          // control that actually does something next.
          <div className="empty-note" data-testid="scene-tree.empty-scene">
            No objects yet — use + Add below to create one.
          </div>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.nodeIndex}
              className={`tree-row${row.nodeIndex === selectedNodeIndex ? " selected" : ""}${row.nodeIndex === referenceHighlightNodeIndex ? " ref-highlighted" : ""}${row.nodeIndex === dragOverNodeIndex ? " drag-over" : ""}`}
              style={{ paddingLeft: 6 + row.depth * 16, display: hiddenNodes.has(row.nodeIndex) ? "none" : undefined }}
              data-testid={`scene-tree.row.${i}`}
              tabIndex={0}
              onClick={() => selectNode(row.nodeIndex)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, nodeIndex: row.nodeIndex });
              }}
              onKeyDown={(e) => {
                // UX-216: Ctrl/Cmd+D duplicates the ROW's own node — scoped
                // to a focused row (this component only), unlike Delete/
                // Backspace's app-level shortcut (App.tsx) which fires
                // regardless of which panel has focus.
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
                  e.preventDefault();
                  duplicateNode(row.nodeIndex);
                }
              }}
              draggable
              onDragStart={(e) => {
                // specs/ux-scene-tree.md UX-209 / specs/ux-graph-canvas.md
                // UX-508: dragged onto the behavior-graph canvas, this opens
                // a drop-menu scoped to this node (pointer/get|set|
                // interpolate, event/onSelect). "copyMove" (not just "copy")
                // so THIS row can also act as a valid "move" drop target
                // below (UX-215) without the browser silently refusing the
                // "move" dropEffect a reparent drop sets.
                e.dataTransfer.setData(SCENE_NODE_DRAG_MIME, String(row.nodeIndex));
                e.dataTransfer.setData("text/plain", String(row.nodeIndex));
                e.dataTransfer.effectAllowed = "copyMove";
              }}
              onDragEnd={() => setDragOverNodeIndex(null)}
              onDragOver={(e) => {
                // UX-215/DOC-052: "into" drop target — dropping HERE
                // reparents the dragged node as this row's LAST child
                // (into-only v1, no between-siblings indicator yet).
                if (!e.dataTransfer.types.includes(SCENE_NODE_DRAG_MIME)) return;
                e.preventDefault();
                e.stopPropagation(); // don't ALSO trigger the panel-body's "drop to root" handler
                e.dataTransfer.dropEffect = "move";
                if (dragOverNodeIndex !== row.nodeIndex) setDragOverNodeIndex(row.nodeIndex);
              }}
              onDragLeave={() => setDragOverNodeIndex((current) => (current === row.nodeIndex ? null : current))}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes(SCENE_NODE_DRAG_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                setDragOverNodeIndex(null);
                const raw = e.dataTransfer.getData(SCENE_NODE_DRAG_MIME);
                if (!raw) return;
                const sourceIndex = Number(raw);
                if (sourceIndex === row.nodeIndex) return; // dropping a row onto itself is a no-op, not a cycle-error round-trip
                reparentNode(sourceIndex, row.nodeIndex);
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
              // UX-216 (DOC-053): duplicates this row's ENTIRE subtree as
              // one undoable command, sharing every non-node resource
              // reference; the new copy is auto-selected.
              key: "duplicate",
              label: "Duplicate",
              onSelect: () => duplicateNode(contextMenu.nodeIndex)
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
            },
            {
              // UX-215 (DOC-052): moves this row (and its subtree) to the
              // current default scene's root, out from under any parent —
              // a no-op-with-a-toast (not an error) when it's already a
              // scene-root node with no `insertIndex` semantics to change,
              // via the same `reparentNode(nodeIndex, null)` the tree's own
              // drop-onto-empty-background gesture uses.
              key: "reparent-root",
              label: "Reparent to root",
              onSelect: () => reparentNode(contextMenu.nodeIndex, null)
            },
            {
              key: "delete",
              // UX-214: subtree count only shown when deleting takes more
              // than just this one row (DOC-048's whole-subtree policy).
              label: (() => {
                const count = countSubtreeNodes(document?.json as GltfJsonShape | undefined, contextMenu.nodeIndex);
                return count > 1 ? `Delete (${count} nodes)` : "Delete";
              })(),
              onSelect: () => deleteNode(contextMenu.nodeIndex)
            }
          ]}
        />
      )}
    </div>
  );
}
