import { useAppStore } from "../../store/app-store";

/**
 * specs/ux-shell.md UX-132 (PC-012): the "Play blocked" diagnostics panel. Shown over the viewport
 * when the last Play attempt was refused because the KHR_interactivity graph is spec-invalid (load-time
 * validation, spec "Validation"); lists every error with its code/message and, for node-attributed
 * errors, a button that opens the Graph tab on that node.
 *
 * data-testid pattern:
 *   - "viewport.play-blocked" — the panel.
 *   - "viewport.play-blocked.count" — "N errors".
 *   - "viewport.play-blocked.diagnostic.${i}" — one row; ".code", ".message", ".node" (the jump button, only
 *     for node-attributed errors) hang off it.
 *   - "viewport.play-blocked.dismiss" — closes the panel.
 */
export function PlayBlockedPanel(): JSX.Element | null {
  const blocked = useAppStore((s) => s.playBlocked);
  const dismiss = useAppStore((s) => s.dismissPlayBlocked);
  const jump = useAppStore((s) => s.jumpPlayBlockedToGraphNode);
  if (!blocked) return null;
  const n = blocked.diagnostics.length;
  return (
    <div className="play-blocked" role="alert" data-testid="viewport.play-blocked">
      <div className="play-blocked-head">
        <strong>Play blocked</strong>
        <span data-testid="viewport.play-blocked.count">
          {n} error{n === 1 ? "" : "s"}
        </span>
        <button type="button" className="play-blocked-dismiss" data-testid="viewport.play-blocked.dismiss" aria-label="Dismiss" onClick={dismiss}>
          ×
        </button>
      </div>
      <div className="play-blocked-note">
        {blocked.scope === "extension" ? "The KHR_interactivity extension" : "The behavior graph"} is not valid per the spec&apos;s Validation rules, so it
        cannot run. Fix the errors below, then press Play again.
      </div>
      <ul className="play-blocked-list">
        {blocked.diagnostics.map((d, i) => (
          <li key={i} data-testid={`viewport.play-blocked.diagnostic.${i}`}>
            <span className="code" data-testid={`viewport.play-blocked.diagnostic.${i}.code`}>
              {d.code}
            </span>
            {d.nodeIndex !== undefined && (
              <button
                type="button"
                className="play-blocked-node"
                data-testid={`viewport.play-blocked.diagnostic.${i}.node`}
                onClick={() => jump(d.graphIndex, d.nodeIndex!)}
              >
                node {d.nodeIndex}
              </button>
            )}
            <span className="msg" data-testid={`viewport.play-blocked.diagnostic.${i}.message`}>
              {d.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
