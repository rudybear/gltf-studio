import { useEffect, useState } from "react";
import { useAppStore } from "../store/app-store";

interface Label {
  id: string;
  top: number;
  left: number;
}

/**
 * UX-111: the `?` toggle's debug overlay — draws every `[data-testid]`
 * element's id as a floating label positioned over it, recomputed on
 * window resize and on any layout-affecting DOM change while on. Purely a
 * debugging aid (no effect on any other requirement's behavior).
 */
export function TestIdOverlay(): JSX.Element | null {
  const on = useAppStore((s) => s.testIdOverlay);
  const [labels, setLabels] = useState<Label[]>([]);

  useEffect(() => {
    document.body.classList.toggle("testid-mode", on);
    if (!on) {
      setLabels([]);
      return;
    }

    function recompute(): void {
      const overlayLayer = document.getElementById("testid-overlay-layer");
      const next: Label[] = [];
      document.querySelectorAll("[data-testid]").forEach((el) => {
        if (overlayLayer && (el === overlayLayer || overlayLayer.contains(el))) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return;
        next.push({ id: el.getAttribute("data-testid") ?? "", top: Math.max(0, r.top), left: Math.max(0, r.left) });
      });
      setLabels(next);
    }

    recompute();
    const observer = new MutationObserver(recompute);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [on]);

  if (!on) return null;

  return (
    <div id="testid-overlay-layer" data-testid="testid-overlay.layer">
      {labels.map((label, i) => (
        <div key={i} className="testid-label" style={{ top: label.top, left: label.left }}>
          {label.id}
        </div>
      ))}
    </div>
  );
}
