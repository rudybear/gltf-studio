/**
 * Small stylized SVG preview icons for the empty-project starter gallery
 * (specs/ux-shell.md UX-120, supersedes UX-119, Viewport.tsx). Inline SVG
 * (not a captured screenshot PNG) on purpose — no headless-capture build
 * step, nothing to regenerate/go-stale when either sample asset changes, and
 * it costs the bundle a few hundred bytes of JSX instead of image bytes.
 * Each is a loose, schematic caricature of its card (not a faithful render)
 * purely to give the two cards a visually distinct identity at a glance.
 */

const VIEWBOX = "0 0 96 64";

/**
 * UX-120: a minimal ground-plane grid with no scene content on it at all —
 * deliberately empty, matching the card's real zero-node document, unlike
 * the retired Playground card's populated-scene caricature. A faint
 * dashed-outline "add something" cube hints at `+ Add` without depicting
 * actual scene content that doesn't exist yet.
 */
export function EmptyScenePreview(): JSX.Element {
  return (
    <svg viewBox={VIEWBOX} width="96" height="64" role="img" aria-label="Empty scene preview">
      <rect x="0" y="0" width="96" height="64" rx="6" fill="var(--bg-1)" />
      {/* Ground grid, in perspective */}
      <g stroke="var(--border)" strokeWidth="1" fill="none">
        <line x1="8" y1="50" x2="88" y2="50" />
        <line x1="16" y1="42" x2="80" y2="42" />
        <line x1="24" y1="34" x2="72" y2="34" />
        <line x1="48" y1="26" x2="18" y2="50" />
        <line x1="48" y1="26" x2="34" y2="50" />
        <line x1="48" y1="26" x2="48" y2="50" />
        <line x1="48" y1="26" x2="62" y2="50" />
        <line x1="48" y1="26" x2="78" y2="50" />
      </g>
      {/* A dashed, unfilled cube outline -- the "nothing here yet, use + Add" hint */}
      <rect x="40" y="30" width="16" height="14" rx="1" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  );
}

/**
 * UX-120's third card: a stylized bottle-and-cork caricature -- a dark
 * green body, a gold foil neck band, and a tan cork popped just clear of
 * the mouth with a couple of small "burst" flecks, hinting at the pop-the-
 * cork interaction without trying to be a faithful render of the real
 * (much more detailed) generated asset.
 */
export function ChampagnePreview(): JSX.Element {
  return (
    <svg viewBox={VIEWBOX} width="96" height="64" role="img" aria-label="Champagne preview">
      <rect x="0" y="0" width="96" height="64" rx="6" fill="var(--bg-1)" />
      {/* Bottle body */}
      <path d="M40 58 L40 30 Q40 22 44 20 L44 12 L52 12 L52 20 Q56 22 56 30 L56 58 Z" fill="#0b3d1e" />
      {/* Gold foil neck band */}
      <rect x="43" y="18" width="10" height="6" fill="#d4af37" />
      {/* Label */}
      <rect x="43" y="36" width="10" height="12" rx="1" fill="#f4f1e6" />
      {/* Popped cork, clear of the mouth */}
      <rect x="45" y="6" width="6" height="6" rx="1.5" fill="#c8a06a" />
      {/* Burst flecks */}
      <circle cx="38" cy="8" r="1.6" fill="#f4f1e6" />
      <circle cx="58" cy="6" r="1.4" fill="#f4f1e6" />
      <circle cx="50" cy="2" r="1.3" fill="#f4f1e6" />
    </svg>
  );
}

export function RacerPreview(): JSX.Element {
  return (
    <svg viewBox={VIEWBOX} width="96" height="64" role="img" aria-label="R4 Racer preview">
      <rect x="0" y="0" width="96" height="64" rx="6" fill="var(--bg-1)" />
      {/* Track ring */}
      <ellipse cx="48" cy="34" rx="38" ry="22" fill="none" stroke="var(--border)" strokeWidth="10" />
      <ellipse cx="48" cy="34" rx="38" ry="22" fill="none" stroke="#555" strokeWidth="4" strokeDasharray="3 4" />
      {/* Car */}
      <rect x="70" y="30" width="8" height="5" rx="1.5" fill="#c0453d" />
      {/* Rival */}
      <rect x="62" y="24" width="7" height="4" rx="1.5" fill="#7a7a7a" />
      {/* Steer pads */}
      <rect x="8" y="14" width="7" height="6" rx="1.5" fill="#d8a23a" />
      <rect x="8" y="44" width="7" height="6" rx="1.5" fill="#d8a23a" />
    </svg>
  );
}
