import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";

export interface PointerButtonProps {
  /** Distinguishes this button's testid from its siblings (e.g. "metallic", "gain") — UX-411. */
  propKey: string;
  /** The row's own pointer path, e.g. "/nodes/1/translation" or "/materials/0/pbrMetallicRoughness/metallicFactor". */
  path: string;
  /** KHR_interactivity `graph.types` signature for this value (e.g. "float3", "float4", "float") — used when creating a pointer/set|interpolate node (UX-412, DOC-042). */
  signature: string;
}

/**
 * specs/ux-inspector.md UX-411/UX-412: the `◈` pointer-shortcut affordance —
 * opens a 3-action menu (copy path / add pointer-set node / add
 * pointer-interpolate node). Each instance owns its own open/closed state
 * and renders its own menu directly beneath itself (rather than one menu
 * shared+repositioned across every row) — at most one is ever open at a
 * time in practice (opening one doesn't close a sibling automatically, but
 * clicking outside/Escape closes whichever is open), which keeps exactly
 * one `inspector.pointer-menu` node mounted whenever any menu is visible.
 */
export function PointerButton({ propKey, path, signature }: PointerButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const copyPointerPath = useAppStore((s) => s.copyPointerPath);
  const addPointerGraphNode = useAppStore((s) => s.addPointerGraphNode);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="pointer-affordance-wrap" ref={rootRef}>
      <button
        type="button"
        className="pointer-affordance-btn"
        data-testid={`inspector.pointer-btn.${propKey}`}
        title="Pointer actions…"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ◈
      </button>
      {open && (
        <div className="pointer-mini-menu open" data-testid="inspector.pointer-menu">
          <button
            type="button"
            data-testid="inspector.pointer-menu.copy"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              copyPointerPath(path);
            }}
          >
            Copy pointer path
          </button>
          <button
            type="button"
            data-testid="inspector.pointer-menu.add-set"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              addPointerGraphNode("set", path, signature);
            }}
          >
            Add pointer/set to graph
          </button>
          <button
            type="button"
            data-testid="inspector.pointer-menu.add-interpolate"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              addPointerGraphNode("interpolate", path, signature);
            }}
          >
            Add pointer/interpolate to graph
          </button>
        </div>
      )}
    </div>
  );
}
