import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/app-store";
import { useTourState } from "./tour-state";
import { TOUR_STEPS } from "./steps";

/** specs/ux-tour.md UX-1207: how long to keep retrying an anchor lookup after a pre-action (a lazy-mounted panel, e.g. the Script tab, may take a beat to appear). */
const ANCHOR_RETRY_TIMEOUT_MS = 2000;
const ANCHOR_RETRY_INTERVAL_MS = 50;
const CARD_MARGIN = 16;
const CARD_WIDTH = 320;

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function toRect(domRect: DOMRect): AnchorRect {
  return { top: domRect.top, left: domRect.left, width: domRect.width, height: domRect.height };
}

function queryAnchor(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`);
}

function isFullyInViewport(r: DOMRect): boolean {
  return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
}

/**
 * specs/ux-tour.md UX-1206/UX-1207/UX-1208/UX-1209: resolves the current
 * step's anchor element to a live, viewport-relative rect. Runs the step's
 * pre-action first, then polls for the anchor (bounded retry window, for
 * panels that mount lazily on tab switch), scrolls it into view the first
 * time it's found if it isn't already fully visible, and keeps the rect
 * fresh across window resizes and ancestor scrolls for as long as the step
 * stays open. Returns `null` (never found within the retry window, or the
 * step has no anchor at all) so the caller can fall back to a centered,
 * spotlight-free card rather than getting stuck.
 */
function useAnchorRect(anchorTestId: string | null): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useEffect(() => {
    setRect(null);
    if (!anchorTestId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + ANCHOR_RETRY_TIMEOUT_MS;

    function attempt(): void {
      if (cancelled) return;
      const el = queryAnchor(anchorTestId as string);
      const r = el?.getBoundingClientRect();
      if (el && r && (r.width > 0 || r.height > 0)) {
        if (!isFullyInViewport(r)) {
          el.scrollIntoView({ block: "center", inline: "center" });
          // Scrolling is async (smooth or not); re-measure next frame rather
          // than trusting the pre-scroll rect.
          requestAnimationFrame(() => {
            if (cancelled) return;
            const after = queryAnchor(anchorTestId as string)?.getBoundingClientRect();
            if (after) setRect(toRect(after));
          });
          return;
        }
        setRect(toRect(r));
        return;
      }
      if (Date.now() < deadline) {
        timer = setTimeout(attempt, ANCHOR_RETRY_INTERVAL_MS);
      } else {
        setRect(null);
      }
    }

    attempt();

    function onWindowChange(): void {
      const el = queryAnchor(anchorTestId as string);
      if (el) setRect(toRect(el.getBoundingClientRect()));
    }
    // `scroll` in the capture phase so a scroll on any ancestor scrollable
    // (not only `window`) is observed (UX-1209).
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [anchorTestId]);

  return rect;
}

function computeCardPosition(rect: AnchorRect | null, cardHeight: number): { top: number; left: number } {
  if (!rect) {
    return {
      top: Math.max(CARD_MARGIN, window.innerHeight / 2 - cardHeight / 2),
      left: Math.max(CARD_MARGIN, window.innerWidth / 2 - CARD_WIDTH / 2)
    };
  }
  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const preferBelow = spaceBelow >= cardHeight + CARD_MARGIN || spaceBelow >= spaceAbove;
  const top = preferBelow
    ? Math.min(rect.top + rect.height + CARD_MARGIN, window.innerHeight - cardHeight - CARD_MARGIN)
    : Math.max(CARD_MARGIN, rect.top - cardHeight - CARD_MARGIN);
  const rawLeft = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  const left = Math.max(CARD_MARGIN, Math.min(rawLeft, window.innerWidth - CARD_WIDTH - CARD_MARGIN));
  return { top, left };
}

/**
 * specs/ux-tour.md UX-1205..UX-1211: the spotlight overlay + tooltip card,
 * portal-rendered to `document.body` so it always sits above the shell's
 * own stacking contexts (the play-state top-bar tint, panel resize
 * handles, etc.) regardless of where in the tree it's mounted from
 * (`App.tsx`, alongside `ToastLayer`/`TestIdOverlay`).
 */
export function TourOverlay(): JSX.Element | null {
  const isOpen = useTourState((s) => s.isOpen);
  const stepIndex = useTourState((s) => s.stepIndex);
  const next = useTourState((s) => s.next);
  const back = useTourState((s) => s.back);
  const exit = useTourState((s) => s.exit);

  const step = TOUR_STEPS[stepIndex];
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(140);

  // UX-1206: run the step's pre-action (dock/right-panel tab switch) before
  // the anchor-measuring hook below gets its first chance to look for the
  // element — declared first so its effect commits first.
  useEffect(() => {
    if (!isOpen || !step) return;
    const { preAction } = step;
    if (!preAction) return;
    const { setActiveDockTab, setActiveRightTab } = useAppStore.getState();
    if (preAction.dockTab) setActiveDockTab(preAction.dockTab);
    if (preAction.rightTab) setActiveRightTab(preAction.rightTab);
  }, [isOpen, step]);

  const rect = useAnchorRect(isOpen ? (step?.anchorTestId ?? null) : null);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [step, rect]);

  // UX-1211: Escape exits (same visible effect as Skip, does not mark completed).
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") exit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, exit]);

  if (!isOpen || !step) return null;

  const pad = 8;
  const spot = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;
  const cardPos = computeCardPosition(rect, cardHeight);
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return createPortal(
    <div className="tour-overlay" data-testid="tour.overlay">
      {spot ? (
        <>
          <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, spot.top) }} />
          <div
            className="tour-dim"
            style={{ top: spot.top + spot.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className="tour-dim"
            style={{ top: spot.top, left: 0, width: Math.max(0, spot.left), height: spot.height }}
          />
          <div
            className="tour-dim"
            style={{ top: spot.top, left: spot.left + spot.width, right: 0, height: spot.height }}
          />
          <div
            className="tour-spotlight"
            data-testid="tour.spotlight"
            style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          />
        </>
      ) : (
        <div className="tour-dim tour-dim-full" data-testid="tour.spotlight" />
      )}

      <div className="tour-card" data-testid="tour.card" ref={cardRef} style={{ top: cardPos.top, left: cardPos.left, width: CARD_WIDTH }}>
        <div className="tour-card-title" data-testid="tour.title">
          {step.title}
        </div>
        <div className="tour-card-body" data-testid="tour.body">
          {step.body}
        </div>
        <div className="tour-progress">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.id} className={`tour-dot${i === stepIndex ? " current" : ""}`} data-testid={`tour.progress-dot.${i}`} />
          ))}
        </div>
        <div className="tour-card-actions">
          <button className="btn small" data-testid="tour.skip" onClick={exit}>
            Skip
          </button>
          <div className="tour-card-actions-spacer" />
          <button className="btn small" data-testid="tour.back" onClick={back} disabled={stepIndex === 0}>
            Back
          </button>
          <button className="btn small primary" data-testid="tour.next" onClick={next}>
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
