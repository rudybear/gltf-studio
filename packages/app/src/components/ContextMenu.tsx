import { useEffect } from "react";

export interface ContextMenuAction {
  key: string;
  label: string;
  onSelect: () => void;
}

/**
 * A generic cursor-positioned right-click menu (specs/ux-scene-tree.md
 * UX-207/UX-208's "Frame / Rename / ✦ Ask Copilot about this…" context menu
 * is its first caller, on both the scene-tree row and the viewport object
 * right-click). Mirrors `packages/graph-canvas/src/drop-menu.tsx`'s own
 * backdrop-click-to-dismiss convention exactly (a full-viewport transparent
 * backdrop behind a `position: fixed` menu at the cursor), plus an Escape
 * listener that convention doesn't need (a graph-canvas drop only fires from
 * a drag gesture, which has no keyboard focus to intercept mid-drag).
 */
export function ContextMenu({
  x,
  y,
  actions,
  onDismiss,
  testId
}: {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onDismiss: () => void;
  testId: string;
}): JSX.Element {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <>
      <div className="context-menu-backdrop" onClick={onDismiss} onContextMenu={(e) => e.preventDefault()} />
      <div className="context-menu" style={{ left: x, top: y }} data-testid={testId} role="menu">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            data-testid={`${testId}.${action.key}`}
            role="menuitem"
            onClick={() => {
              onDismiss();
              action.onSelect();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}
