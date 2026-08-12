import { create } from "zustand";
import { TOUR_STEPS } from "./steps";
import { markBannerDismissed, markTourCompleted, readTourStorage } from "./tour-storage";

/**
 * A small, dedicated store for the tour's own open/step state — deliberately
 * separate from the main `useAppStore` (`../store/app-store.ts`): the tour
 * is a UI-only overlay concern with no interaction with the document,
 * history, or any other app-store slice, and keeping it in its own store
 * under `packages/app/src/tour/**` is what lets that directory's
 * `specs/ownership.json` glob cleanly own every file this feature touches
 * (see `specs/ux-tour.md`'s "Owns" note) without also touching
 * `app-store.ts` itself.
 */
interface TourState {
  isOpen: boolean;
  stepIndex: number;
  bannerDismissed: boolean;
  /** specs/ux-tour.md UX-1200: starts (or restarts) at step 1 regardless of prior completion/skip state. */
  start(): void;
  /** Advances one step, or completes the tour (UX-1204) from the last step. */
  next(): void;
  back(): void;
  /** specs/ux-tour.md UX-1204/UX-1211: Skip or Esc — an early exit, never marks `completed`. */
  exit(): void;
  dismissBanner(): void;
}

export const useTourState = create<TourState>((set, get) => ({
  isOpen: false,
  stepIndex: 0,
  bannerDismissed: readTourStorage().bannerDismissed,

  start() {
    set({ isOpen: true, stepIndex: 0 });
  },

  next() {
    const { stepIndex } = get();
    if (stepIndex >= TOUR_STEPS.length - 1) {
      markTourCompleted();
      set({ isOpen: false, bannerDismissed: true });
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },

  back() {
    set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) }));
  },

  exit() {
    markBannerDismissed();
    set({ isOpen: false, bannerDismissed: true });
  },

  dismissBanner() {
    markBannerDismissed();
    set({ bannerDismissed: true });
  }
}));
