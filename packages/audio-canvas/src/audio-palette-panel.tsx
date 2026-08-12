// Node-creation palette for the audio-graph canvas (specs/ux-audio-graph.md
// UX-608), resolving OPEN(UX-audiograph-palette-tbd) in favor of "its own
// palette" — audio nodes come from `audio-node-registry.ts`'s static
// catalog (the ratified `KHR_audio_graph.node.schema.json` kind list), not
// `@gltfi/kernel`'s `OpCategory`/`opsByCategory` registry the behavior
// graph's `palette-panel.tsx` reads, so that component's `PalettePanel`
// can't be reused as-is (nor is it exported from `@gltf-studio/graph-
// canvas`'s public API). Mirrors its UX closely on purpose (same collapse/
// search/category-list shape) so switching between the two dock tabs feels
// like the same tool, per specs/ux-audio-graph.md UX-600's "identical
// engine and contract" spirit extended to the palette.
import { useMemo, useState } from "react";
import { AUDIO_NODE_CATEGORIES, AUDIO_NODE_REGISTRY, type AudioNodeCategory, type AudioNodeSpec } from "./audio-node-registry.js";

export interface AudioPalettePanelProps {
  onAddNode: (kind: string) => void;
}

function matches(kind: string, label: string, category: string, query: string): boolean {
  const q = query.toLowerCase();
  return kind.toLowerCase().includes(q) || label.toLowerCase().includes(q) || category.toLowerCase().includes(q);
}

export function AudioPalettePanel({ onAddNode }: AudioPalettePanelProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<AudioNodeCategory>>(new Set());

  function toggleCategory(category: AudioNodeCategory) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const query = search.trim();

  // Recomputed only when the (trimmed) search text actually changes, not on
  // every render (e.g. the unrelated `collapsedCategories` toggle below) —
  // one pass over the static registry per category instead of one per
  // render regardless of whether `query` moved.
  const specsByCategory = useMemo(() => {
    const grouped = new Map<AudioNodeCategory, AudioNodeSpec[]>();
    for (const category of AUDIO_NODE_CATEGORIES) {
      grouped.set(
        category,
        AUDIO_NODE_REGISTRY.filter((spec) => spec.category === category && matches(spec.kind, spec.label, category, query))
      );
    }
    return grouped;
  }, [query]);

  return (
    <div className="acanvas-palette" data-testid="acanvas.palette">
      <div className="acanvas-palette-header">
        <input
          className="acanvas-palette-search"
          data-testid="acanvas.palette.search"
          type="search"
          placeholder="Search audio nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="acanvas-palette-body">
        {AUDIO_NODE_CATEGORIES.map((category) => {
          const specs = specsByCategory.get(category) ?? [];
          if (query && specs.length === 0) return null;
          const isExpanded = query.length > 0 || !collapsedCategories.has(category);
          return (
            <div key={category} className="acanvas-palette-category">
              <button
                type="button"
                className="acanvas-palette-category-header"
                data-testid={`acanvas.palette.category.${category}.toggle`}
                onClick={() => toggleCategory(category)}
              >
                <span className="acanvas-palette-twisty">{isExpanded ? "▾" : "▸"}</span>
                <span>{category}</span>
                <span className="acanvas-palette-category-count">{specs.length}</span>
              </button>
              {isExpanded ? (
                <div className="acanvas-palette-op-list" data-testid={`acanvas.palette.category.${category}`}>
                  {specs.map((spec) => (
                    <button
                      key={spec.kind}
                      type="button"
                      className="acanvas-palette-op"
                      title={spec.description}
                      data-testid={`acanvas.palette.op.${spec.kind}`}
                      onClick={() => onAddNode(spec.kind)}
                    >
                      {spec.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
