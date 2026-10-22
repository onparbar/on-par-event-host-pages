"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function kitchenSheetScale(width: number, height: number, sheetWidth: number, sheetHeight: number) {
  if (![width, height, sheetWidth, sheetHeight].every((value) => Number.isFinite(value) && value > 0)) return 1;
  return Math.min(1, width / sheetWidth, height / sheetHeight);
}

export function KitchenSheetViewport({ children, fit }: { children: ReactNode; fit: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    let frame = 0;
    function measure() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        // Small screens keep natural-size text and scrolling instead of tiny controls.
        const next = fit && window.innerWidth >= 721
          ? kitchenSheetScale(viewport!.clientWidth, Math.max(0, viewport!.clientHeight - 2), canvas!.offsetWidth, canvas!.offsetHeight)
          : 1;
        setScale(next);
      });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(canvas);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.cancelAnimationFrame(frame);
    };
  }, [fit]);

  return <div className="kitchen-sheet-viewport" data-fit={fit} ref={viewportRef}>
    <div className="kitchen-sheet-canvas" ref={canvasRef} style={{ "--kitchen-sheet-scale": scale } as CSSProperties}>
      {children}
    </div>
  </div>;
}
