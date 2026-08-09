import { useAppStore } from "../../store/app-store";

/** Real (per the task's dock-tab scope): shows the app's own log lines (app-store.ts's `log`). */
export function ConsolePanel(): JSX.Element {
  const lines = useAppStore((s) => s.consoleLines);

  return (
    <div className="console-panel" data-testid="console.panel">
      {lines.length === 0 ? (
        <div className="empty-note" data-testid="console.empty">
          No log lines yet.
        </div>
      ) : (
        lines.map((line, i) => (
          <div key={i} className={`console-line ${line.level}`} data-testid={`console.line.${i}`}>
            <span className="ts">{line.ts}</span>
            <span className="lvl">{line.level.toUpperCase()}</span>
            <span>{line.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
