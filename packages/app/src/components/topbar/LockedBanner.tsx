import { useAppStore } from "../../store/app-store";

/**
 * specs/ux-shell.md UX-100/UX-106/UX-107/UX-113: the play-state locked
 * banner, rendered in `App.tsx` between `<TopBar/>` and `<div id="workspace">`.
 * Renders nothing while `playState === "stopped"` (UX-107: shown for exactly
 * the states in which `DOC-031` forbids `Command` application, hidden
 * otherwise).
 */
export function LockedBanner(): JSX.Element | null {
  const playState = useAppStore((s) => s.playState);

  if (playState === "stopped") return null;

  const text = playState === "paused" ? "Playback paused — Stop to edit." : "Document locked while playing — Stop to edit.";

  return (
    <div className="locked-banner" data-testid="locked-banner" data-play-state={playState}>
      {text}
    </div>
  );
}
