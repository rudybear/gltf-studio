// specs/ux-graph-canvas.md UX-508: the drop-menu a scene-tree-row/animation-
// clip drag-drop onto the canvas opens, scoped to what was dragged (docs/ux/
// mockups/mockup-v5.html's `#graph-drop-menu` — same option set/order/
// testids). Purely presentational: graph-view.tsx owns the pending-drop
// state and drop-position math; this component only renders the menu and
// reports which option was chosen.
export type DropKind = "node" | "anim";

export type DropOption = { key: string; label: string };

const NODE_OPTIONS: DropOption[] = [
  { key: "pointer-get", label: "pointer/get" },
  { key: "pointer-set", label: "pointer/set" },
  { key: "pointer-interpolate", label: "pointer/interpolate" },
  { key: "event-onselect", label: "event/onSelect (this node)" }
];

const ANIM_OPTIONS: DropOption[] = [
  { key: "animation-start", label: "animation/start" },
  { key: "animation-stop", label: "animation/stop" }
];

export function optionsForDropKind(kind: DropKind): DropOption[] {
  return kind === "node" ? NODE_OPTIONS : ANIM_OPTIONS;
}

export function DropMenu({
  kind,
  screenPosition,
  onChoose,
  onDismiss
}: {
  kind: DropKind;
  screenPosition: { x: number; y: number };
  onChoose: (optionKey: string) => void;
  onDismiss: () => void;
}) {
  const options = optionsForDropKind(kind);
  return (
    <>
      {/* Full-viewport transparent backdrop closes the menu on an outside click, mirroring PalettePanel/context-menu conventions elsewhere in the app. */}
      <div className="gcanvas-drop-menu-backdrop" onClick={onDismiss} />
      <div
        className="gcanvas-drop-menu open"
        style={{ left: screenPosition.x, top: screenPosition.y }}
        data-testid="gcanvas.drop-menu"
        role="menu"
      >
        {options.map((o) => (
          <button key={o.key} type="button" data-testid={`gcanvas.drop-menu.${o.key}`} onClick={() => onChoose(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}
