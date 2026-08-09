import { useEffect } from "react";
import { useAppStore } from "../store/app-store";

/** UX-109: transient, non-modal, bottom-right, auto-dismisses after ~1.8s, never blocks input. */
export function ToastLayer(): JSX.Element {
  const toasts = useAppStore((s) => s.toasts);

  return (
    <div id="toast-layer">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} text={t.text} />
      ))}
    </div>
  );
}

function Toast({ id, text }: { id: number; text: string }): JSX.Element {
  const dismissToast = useAppStore((s) => s.dismissToast);

  // Each toast owns its own timer (keyed only on its stable `id`) so a
  // later toast arriving doesn't reset an earlier one's countdown.
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(id), 1800);
    return () => clearTimeout(timer);
  }, [id, dismissToast]);

  return (
    <div className="toast show" data-testid="toast">
      {text}
    </div>
  );
}
