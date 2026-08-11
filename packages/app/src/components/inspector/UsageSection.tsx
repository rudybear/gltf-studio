import { useMemo, useState } from "react";
import { buildUsageIndex, findEnclosingHandlerRoot, NO_USAGE_REFS, type UsageDocJson, type UsageRef } from "@gltf-studio/usage-index";
import { useAppStore } from "../../store/app-store";
import type { GltfJsonShape } from "../../lib/gltf-scene";

/** UX-1109's Phase-2 "Attach behavior…" menu entries — not yet real (no structural graph-scaffolding command exists for them here), shown anyway so the menu's eventual shape is visible rather than hidden until it is (same "stable stub, honest toast" convention specs/ux-scene-tree.md's UX-206 add-menu already established). */
const ATTACH_STUB_ENTRIES = [
  { key: "add-pointer-set", label: "Add pointer/set to graph" },
  { key: "add-onselect", label: "Add event/onSelect (this node)" }
] as const;

/**
 * specs/ux-usage-mapping.md UX-1106..1109: "Used in behavior" — every
 * `@gltf-studio/usage-index` reference to the selected node, across every
 * graph in the document. Memoized on `json`'s own identity (UX-1113) —
 * exactly the convention `@gltf-studio/graph-canvas`'s `mapGraph` and
 * `buildPointerContentTree` already use, since `editor-core`'s patches
 * always produce a fresh top-level `json` object on a real edit, never on
 * an unrelated selection change.
 */
export function UsageSection({ nodeIndex, json }: { nodeIndex: number; json: GltfJsonShape }): JSX.Element {
  const jumpUsageRefToGraph = useAppStore((s) => s.jumpUsageRefToGraph);
  const jumpUsageRefToScript = useAppStore((s) => s.jumpUsageRefToScript);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);
  const addCopilotContextChip = useAppStore((s) => s.addCopilotContextChip);
  const requestCopilotComposerFocus = useAppStore((s) => s.requestCopilotComposerFocus);
  const pushToast = useAppStore((s) => s.pushToast);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  const usageIndex = useMemo(() => buildUsageIndex(json as UsageDocJson), [json]);
  const refs: UsageRef[] = usageIndex.get(nodeIndex) ?? NO_USAGE_REFS;

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

  return (
    <div className="inspector-section" data-testid="inspector.usage.section">
      <h4>Used in behavior{refs.length > 0 ? ` (${refs.length})` : ""}</h4>
      <div className="content">
        {refs.length === 0 ? (
          <div className="empty-note usage-empty" style={{ position: "relative" }}>
            Not referenced in behavior —{" "}
            <button type="button" className="btn small" data-testid="inspector.usage.attach" onClick={() => setAttachMenuOpen((v) => !v)}>
              Attach behavior…
            </button>
            <ul className={`add-menu${attachMenuOpen ? " open" : ""}`} data-testid="inspector.usage.attach-menu">
              <li>
                <button type="button" data-testid="inspector.usage.attach-menu.ask-copilot" onClick={askCopilotAboutThisNode}>
                  ✦ Ask Copilot about this node
                </button>
              </li>
              {ATTACH_STUB_ENTRIES.map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    className="menu-item-stub"
                    data-testid={`inspector.usage.attach-menu.${entry.key}`}
                    onClick={() => {
                      setAttachMenuOpen(false);
                      pushToast(`${entry.label}: coming in a later phase.`);
                    }}
                  >
                    {entry.label} <span className="dim">(soon)</span>
                  </button>
                </li>
              ))}
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
