import { useMemo } from "react";
import { useAppStore } from "../../store/app-store";

/**
 * UX-108 (DOC-039): lists every history entry in order, most-recently-
 * pushed/redone marked current — real as of M2's viewport integration
 * (gizmo commits push `SceneEdit.setTransform` commands; the scene-tree
 * add-menu remains a UX-206 stub deferred to M8). Entries are read-only:
 * per `specs/ux-shell.md`'s OPEN(UX-history-jump-tbd), `UX-108` does not
 * specify click-to-jump semantics, so none are implemented here.
 */
export function HistoryDropdown(): JSX.Element {
  // `historyEntries()` builds a fresh array every call — used here via
  // `useMemo` over two REFERENCE-STABLE selectors (`history` only changes on
  // a new project import; `document` only changes when a command actually
  // applies, per DOC-003's rev bump) rather than directly as a zustand
  // selector, which would hand zustand a new array on every single render
  // and never stop re-rendering (React error #185 — this was a latent bug no
  // prior test exercised, since nothing opened the dropdown before M2).
  const history = useAppStore((s) => s.history);
  const document = useAppStore((s) => s.document);
  const entries = useMemo(() => useAppStore.getState().historyEntries(), [history, document]);

  return (
    <div className="history-dropdown open" data-testid="topbar.history-dropdown">
      <ul>
        {entries.length === 0 ? (
          <li data-testid="topbar.history-dropdown.empty">No history yet.</li>
        ) : (
          entries.map((entry) => (
            <li key={entry.index} className={entry.isCurrent ? "current" : ""} data-testid={`topbar.history-dropdown.entry.${entry.index}`}>
              {entry.label}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
