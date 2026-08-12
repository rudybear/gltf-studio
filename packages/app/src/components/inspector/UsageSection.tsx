import { useState } from "react";
import { findEnclosingHandlerRoot, NO_USAGE_REFS, type UsageDocJson, type UsageRef } from "@gltf-studio/usage-index";
import { useAppStore } from "../../store/app-store";
import { useUsageIndexes } from "../../hooks/use-usage-indexes";
import type { GltfJsonShape } from "../../lib/gltf-scene";

/**
 * specs/ux-usage-mapping.md UX-1106..1109/UX-1118: "Used in behavior" —
 * every `@gltf-studio/usage-index` reference to the selected node, across
 * every graph in the document. Memoized on `json`'s own identity (UX-1113),
 * shared via `useUsageIndexes` with the scene tree's/asset browser's own ⚡
 * badge derivation (`SceneTree.tsx`/`AssetBrowser.tsx`) — one derivation,
 * not three independently-computed copies of the same index.
 *
 * UX-1118 (Phase 2): the zero-ref "Attach behavior…" menu's `event/onSelect`-
 * prefixed entries are now REAL — each creates an `event/onSelect` node
 * wired by one flow edge into a freshly-added effect node (a `pointer/set`/
 * `pointer/interpolate`, a `pointer/set` audio trigger, or an
 * `animation/start`), as ONE undoable command (`app-store.ts`'s
 * `attachOnSelectPointerNode`/`attachOnSelectPlaySound`/
 * `attachOnSelectPlayAnimation`), landing in and focusing the Behavior
 * graph. "Play sound" is only offered when this node's own
 * `extensions.KHR_audio_emitter.emitter` is set; "Play animation…" expands
 * a submenu of the document's own animation clips (same submenu-as-one-
 * entry convention `SceneTree.tsx`'s "Mesh ▸" add-menu item already uses).
 */
export function UsageSection({ nodeIndex, json }: { nodeIndex: number; json: GltfJsonShape }): JSX.Element {
  const jumpUsageRefToGraph = useAppStore((s) => s.jumpUsageRefToGraph);
  const jumpUsageRefToScript = useAppStore((s) => s.jumpUsageRefToScript);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);
  const addCopilotContextChip = useAppStore((s) => s.addCopilotContextChip);
  const requestCopilotComposerFocus = useAppStore((s) => s.requestCopilotComposerFocus);
  const attachOnSelectPointerNode = useAppStore((s) => s.attachOnSelectPointerNode);
  const attachOnSelectPlaySound = useAppStore((s) => s.attachOnSelectPlaySound);
  const attachOnSelectPlayAnimation = useAppStore((s) => s.attachOnSelectPlayAnimation);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [animSubmenuOpen, setAnimSubmenuOpen] = useState(false);

  const usageIndexes = useUsageIndexes(json);
  const refs: UsageRef[] = usageIndexes.nodes.get(nodeIndex) ?? NO_USAGE_REFS;

  const emitterIndex = json.nodes?.[nodeIndex]?.extensions?.KHR_audio_emitter?.emitter;
  const canPlaySound = emitterIndex !== undefined;
  const animations = json.animations ?? [];

  /**
   * UX-1108's disabled-state case: a `pointer/set`/`pointer/interpolate` ref
   * whose graph node isn't reachable (via `findEnclosingHandlerRoot`'s
   * backward flow walk) from ANY event/* handler is dead in the graph —
   * `@gltfi/ir`'s `importGraph` never visits/emits an unreachable node at
   * all, so → Script's pointer-path text-search fallback (app-store.ts's
   * `jumpUsageRefToScript`) is GUARANTEED to find nothing for it, not just
   * "might." Checked here with the same cheap, non-compiling JSON walk
   * `jumpUsageRefToScript` itself uses for its disambiguation hint — no
   * `@gltfi/emit-ts` invocation needed just to decide a button's enabled
   * state. `event-handler`/`animation`-kind refs are left enabled
   * unconditionally: `event/onSelect|onHoverIn|onHoverOut` handler roots
   * always get a `sourceNodeIds` entry (cross-highlight.ts always resolves
   * them), and `animation/*` refs are out of this pass's scope (tracked as
   * a known gap in specs/ux-usage-mapping.md rather than silently assumed
   * fine).
   */
  function hasScriptFootprint(ref: UsageRef): boolean {
    if (ref.kind !== "pointer") return true;
    const graph = (json as UsageDocJson).extensions?.KHR_interactivity?.graphs?.[ref.graphIndex];
    if (!graph) return true; // shouldn't happen (this ref was itself derived from this graph) — fail open rather than disabling on a shape surprise
    return findEnclosingHandlerRoot(graph, ref.graphNodeIndex) !== null;
  }

  function askCopilotAboutThisNode(): void {
    setAttachMenuOpen(false);
    const label = `Node #${nodeIndex}`;
    setActiveRightTab("copilot");
    addCopilotContextChip({ kind: "explicit", label, pointer: `/nodes/${nodeIndex}` }, label);
    requestCopilotComposerFocus();
  }

  function closeAttachMenu(): void {
    setAttachMenuOpen(false);
    setAnimSubmenuOpen(false);
  }

  return (
    <div className="inspector-section" data-testid="inspector.usage.section">
      <h4>Used in behavior{refs.length > 0 ? ` (${refs.length})` : ""}</h4>
      <div className="content">
        {refs.length === 0 ? (
          <div className="empty-note usage-empty" style={{ position: "relative" }}>
            Not referenced in behavior —{" "}
            <button
              type="button"
              className="btn small"
              data-testid="inspector.usage.attach"
              onClick={() =>
                setAttachMenuOpen((v) => {
                  if (v) setAnimSubmenuOpen(false);
                  return !v;
                })
              }
            >
              Attach behavior…
            </button>
            <ul className={`add-menu${attachMenuOpen ? " open" : ""}`} data-testid="inspector.usage.attach-menu">
              <li>
                <button type="button" data-testid="inspector.usage.attach-menu.ask-copilot" onClick={askCopilotAboutThisNode}>
                  ✦ Ask Copilot about this node
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="inspector.usage.attach-menu.set-property"
                  onClick={() => {
                    closeAttachMenu();
                    attachOnSelectPointerNode(nodeIndex, "set");
                  }}
                >
                  On select → Set property…
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="inspector.usage.attach-menu.interpolate"
                  onClick={() => {
                    closeAttachMenu();
                    attachOnSelectPointerNode(nodeIndex, "interpolate");
                  }}
                >
                  On select → Interpolate…
                </button>
              </li>
              {canPlaySound && (
                <li>
                  <button
                    type="button"
                    data-testid="inspector.usage.attach-menu.play-sound"
                    onClick={() => {
                      closeAttachMenu();
                      attachOnSelectPlaySound(nodeIndex);
                    }}
                  >
                    On select → Play sound
                  </button>
                </li>
              )}
              {animations.length > 0 && (
                <li>
                  <button
                    type="button"
                    data-testid="inspector.usage.attach-menu.play-animation"
                    onClick={() => setAnimSubmenuOpen((v) => !v)}
                  >
                    On select → Play animation ▸
                  </button>
                  <ul className={`add-menu add-submenu${animSubmenuOpen ? " open" : ""}`} data-testid="inspector.usage.attach-menu.play-animation-submenu">
                    {animations.map((anim, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          data-testid={`inspector.usage.attach-menu.play-animation.${i}`}
                          onClick={() => {
                            closeAttachMenu();
                            attachOnSelectPlayAnimation(nodeIndex, i);
                          }}
                        >
                          {anim.name ?? `Animation ${i}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </div>
        ) : (
          refs.map((ref, i) => {
            const scriptFootprint = hasScriptFootprint(ref);
            return (
              <div className="usage-row" data-testid={`inspector.usage.row.${i}`} key={`${ref.graphIndex}:${ref.graphNodeIndex}`}>
                <span className="usage-op-badge mono">{ref.op}</span>
                <span className="usage-path mono">{ref.pathText}</span>
                <span className="dim usage-graph-name">Graph {ref.graphIndex}</span>
                <div className="usage-row-actions">
                  <button type="button" className="btn small" data-testid={`inspector.usage.row.${i}.to-graph`} onClick={() => jumpUsageRefToGraph(ref)}>
                    → Graph
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    data-testid={`inspector.usage.row.${i}.to-script`}
                    disabled={!scriptFootprint}
                    title={scriptFootprint ? undefined : "This graph node isn't reachable from any event trigger, so it has no line in the generated script."}
                    onClick={() => jumpUsageRefToScript(ref)}
                  >
                    → Script
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
