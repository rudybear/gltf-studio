import { useCallback, useRef, useState } from "react";

export interface ResizeHandleProps {
  orientation: "vertical" | "horizontal";
  testId: string;
  /** Called with the raw pointer delta (px) since drag start on every move. */
  onDrag: (delta: number) => void;
}

/** UX-101/UX-102: a drag handle that live-resizes its adjacent region, clamped by the caller. */
export function ResizeHandle({ orientation, testId, onDrag }: ResizeHandleProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(true);
      startRef.current = orientation === "vertical" ? e.clientX : e.clientY;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      function onMove(ev: PointerEvent): void {
        const pos = orientation === "vertical" ? ev.clientX : ev.clientY;
        const delta = pos - startRef.current;
        startRef.current = pos;
        onDrag(delta);
      }
      function onUp(): void {
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [orientation, onDrag]
  );

  return (
    <div
      className={`resize-handle${orientation === "horizontal" ? " horizontal" : ""}${dragging ? " dragging" : ""}`}
      data-testid={testId}
      onPointerDown={onPointerDown}
    />
  );
}
