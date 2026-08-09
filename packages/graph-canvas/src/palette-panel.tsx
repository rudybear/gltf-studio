// Node palette sidebar (specs/ux-graph-canvas.md UX-500..502): the nine
// @gltfi/kernel registry categories, each independently collapsible and
// populated with that category's real op ids; a live substring/category
// search; and a toolbar control that collapses the whole palette to a
// narrow icon rail.
import { useMemo, useState } from "react";
import { opsByCategory, type OpCategory, type OpSpec } from "@gltfi/kernel";
import { categoryColor } from "./palette.js";

// UX-500: exactly these nine categories, in this order.
const CATEGORIES: OpCategory[] = ["event", "flow", "variable", "pointer", "math", "type", "ref", "animation", "debug"];

export const OP_DRAG_MIME = "application/x-gltfi-op";

export type PalettePanelProps = {
  onAddNode: (op: string) => void;
  onAskCopilot?: () => void;
};

function matches(spec: OpSpec, categoryName: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return spec.op.toLowerCase().includes(q) || categoryName.toLowerCase().includes(q);
}

export function PalettePanel({ onAddNode, onAskCopilot }: PalettePanelProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<ReadonlySet<OpCategory>>(new Set());
  const [railCollapsed, setRailCollapsed] = useState(false);

  const byCategory = useMemo(() => {
    const query = search.trim();
    return CATEGORIES.map((category) => {
      const ops = opsByCategory(category).filter((spec) => matches(spec, category, query));
      return { category, ops };
    }).filter((entry) => entry.ops.length > 0 || search.trim() === "");
  }, [search]);

  function toggleCategory(category: OpCategory) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function isExpanded(category: OpCategory, matchCount: number): boolean {
    if (search.trim().length > 0) return matchCount > 0; // UX-501: auto-expands with an active query.
    return !collapsedCategories.has(category);
  }

  if (railCollapsed) {
    return (
      <div className="gcanvas-palette gcanvas-palette-rail" data-testid="gcanvas.palette">
        <button
          type="button"
          className="gcanvas-palette-rail-toggle"
          onClick={() => setRailCollapsed(false)}
          title="Expand palette"
          aria-label="Expand palette"
          data-testid="gcanvas.palette.toggle"
        >
          {"»"}
        </button>
        {CATEGORIES.map((category) => (
          <span
            key={category}
            className="gcanvas-palette-rail-dot"
            style={{ background: categoryColor(category) }}
            title={category}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="gcanvas-palette" data-testid="gcanvas.palette">
      <div className="gcanvas-palette-header">
        <input
          type="search"
          className="gcanvas-palette-search"
          placeholder="Search ops…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="gcanvas.palette.search"
        />
        {onAskCopilot ? (
          <button
            type="button"
            className="gcanvas-palette-copilot"
            title="Ask Copilot about this graph"
            aria-label="Ask Copilot about this graph"
            onClick={onAskCopilot}
            data-testid="gcanvas.palette.copilot"
          >
            ✦
          </button>
        ) : null}
        <button
          type="button"
          className="gcanvas-palette-rail-toggle"
          onClick={() => setRailCollapsed(true)}
          title="Collapse palette"
          aria-label="Collapse palette"
          data-testid="gcanvas.palette.toggle"
        >
          {"«"}
        </button>
      </div>
      <div className="gcanvas-palette-body">
        {byCategory.map(({ category, ops }) => {
          const expanded = isExpanded(category, ops.length);
          return (
            <div key={category} className="gcanvas-palette-category" data-testid={`gcanvas.palette.category.${category}`}>
              <button
                type="button"
                className="gcanvas-palette-category-header"
                style={{ borderLeftColor: categoryColor(category) }}
                onClick={() => toggleCategory(category)}
                data-testid={`gcanvas.palette.category.${category}.toggle`}
              >
                <span className="gcanvas-palette-twisty">{expanded ? "▾" : "▸"}</span>
                <span className="gcanvas-palette-category-name">{category}</span>
                <span className="gcanvas-palette-category-count">{ops.length}</span>
              </button>
              {expanded ? (
                <ul className="gcanvas-palette-op-list">
                  {ops.map((spec) => (
                    <li key={spec.op}>
                      <button
                        type="button"
                        className="gcanvas-palette-op"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(OP_DRAG_MIME, spec.op);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => onAddNode(spec.op)}
                        data-testid={`gcanvas.palette.op.${spec.op}`}
                        title={`Add ${spec.op}`}
                      >
                        {spec.op}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
