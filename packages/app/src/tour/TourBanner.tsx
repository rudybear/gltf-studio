import { useTourState } from "./tour-state";

/**
 * specs/ux-tour.md UX-1201/UX-1202: a small, dismissible, non-auto-starting
 * banner offering the tour on first visit (no tour record in `localStorage`
 * at all yet, `tour-storage.ts`). Rendered directly in the shell flow (not
 * a portal, unlike `TourOverlay`) — it's an ordinary piece of chrome, not
 * an overlay that needs to sit above everything else.
 */
export function TourBanner(): JSX.Element | null {
  const bannerDismissed = useTourState((s) => s.bannerDismissed);
  const isOpen = useTourState((s) => s.isOpen);
  const start = useTourState((s) => s.start);
  const dismissBanner = useTourState((s) => s.dismissBanner);

  if (bannerDismissed || isOpen) return null;

  return (
    <div className="tour-banner" data-testid="tour.banner">
      <span className="tour-banner-text">New here? Take a quick tour of gltf-studio.</span>
      <button
        className="btn small primary"
        data-testid="tour.banner.start"
        onClick={() => {
          dismissBanner();
          start();
        }}
      >
        Take the tour
      </button>
      <button className="btn small icon-only" data-testid="tour.banner.dismiss" title="Dismiss" onClick={dismissBanner}>
        ✕
      </button>
    </div>
  );
}
