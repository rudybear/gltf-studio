import { useAppStore } from "../../store/app-store";

/**
 * UX-108: lists every history entry in order, most-recently-pushed/redone
 * marked current. `historyEntries()` is honestly empty in v1 — no UI path
 * pushes a `Command` yet (the scene-tree add-menu is a stub per UX-206), so
 * there is nothing real to enumerate until an editing surface lands (M3+).
 * The dropdown itself, the undo/redo buttons, and the store wiring are real
 * — see app-store.ts's `dispatchCommand`/`undo`/`redo`.
 */
export function HistoryDropdown(): JSX.Element {
  const entries = useAppStore((s) => s.historyEntries());

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
