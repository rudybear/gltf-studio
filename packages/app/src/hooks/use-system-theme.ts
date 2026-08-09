import { useEffect, useState } from "react";

/** UX-104: live-tracks `prefers-color-scheme` (used only while no explicit theme override is set). */
export function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return prefersDark;
}
