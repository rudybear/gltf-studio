import { useAppStore } from "../../store/app-store.js";

/**
 * specs/ux-shell.md UX-125: a non-blocking recovery prompt (deliberately NOT
 * a `.modal-overlay` — it must not block interaction with whatever the
 * project's last-saved state already put on screen while the user decides)
 * shown whenever `openProjectById` finds the project's journal ahead of its
 * last save. Mounted once at `App.tsx`'s top level, driven entirely by the
 * store's `recoveryOffer` (`null` = not rendered).
 */
export function RecoveryPrompt(): JSX.Element | null {
  const recoveryOffer = useAppStore((s) => s.recoveryOffer);
  const applyRecovery = useAppStore((s) => s.applyRecovery);
  const discardRecovery = useAppStore((s) => s.discardRecovery);

  if (!recoveryOffer) return null;

  return (
    <div className="recovery-card" data-testid="recovery.dialog" role="alertdialog">
      <p className="recovery-message" data-testid="recovery.message">
        &ldquo;{recoveryOffer.projectName}&rdquo; has unsaved changes from a previous session. Recover them?
      </p>
      <div className="recovery-actions">
        <button
          className="btn small"
          data-testid="recovery.discard"
          onClick={() => {
            void discardRecovery();
          }}
        >
          Discard
        </button>
        <button className="btn small primary" data-testid="recovery.recover" onClick={applyRecovery}>
          Recover
        </button>
      </div>
    </div>
  );
}
