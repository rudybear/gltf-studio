import { useMemo, useState } from "react";
import { buildUsageIndex, NO_USAGE_REFS, type UsageDocJson, type UsageRef } from "@gltf-studio/usage-index";
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
          refs.map((ref, i) => (
            <div className="usage-row" data-testid={`inspector.usage.row.${i}`} key={`${ref.graphIndex}:${ref.graphNodeIndex}`}>
              <span className="usage-op-badge mono">{ref.op}</span>
              <span className="usage-path mono">{ref.pathText}</span>
              <span className="dim usage-graph-name">Graph {ref.graphIndex}</span>
              <div className="usage-row-actions">
                <button
                  type="button"
                  className="btn small"
                  data-testid={`inspector.usage.row.${i}.to-graph`}
                  onClick={() => jumpUsageRefToGraph({ graphIndex: ref.graphIndex, graphNodeIndex: ref.graphNodeIndex })}
                >
                  → Graph
                </button>
                <button
                  type="button"
                  className="btn small"
                  data-testid={`inspector.usage.row.${i}.to-script`}
                  onClick={() => jumpUsageRefToScript({ graphIndex: ref.graphIndex, graphNodeIndex: ref.graphNodeIndex })}
                >
                  → Script
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
