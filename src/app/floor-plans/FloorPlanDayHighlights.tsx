import type { CSSProperties } from "react";
import type { AdminAssetOverlay } from "@/lib/admin-types";

export const FLOOR_PLAN_DAY_HIGHLIGHT_NOTICE = "Date-wide notes — not party reservations or approved seating.";

export function FloorPlanDayHighlightNotice() {
  return <p className="floor-plan-day-highlight-notice">{FLOOR_PLAN_DAY_HIGHLIGHT_NOTICE}</p>;
}

export default function FloorPlanDayHighlights({ highlights, selectedId, onSelect }: {
  highlights: readonly AdminAssetOverlay[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  return highlights.filter((highlight) => highlight.kind === "highlight").map((highlight) => {
    const fill = /^#[0-9a-f]{6}$/i.test(highlight.fill) ? highlight.fill : "#297025";
    const alpha = Math.round(Math.max(0, Math.min(1, highlight.opacity)) * 255).toString(16).padStart(2, "0");
    const style: CSSProperties = {
      position: "absolute",
      left: `${highlight.x}%`, top: `${highlight.y}%`,
      width: `${highlight.width}%`, height: `${highlight.height}%`,
      backgroundColor: `${fill}${alpha}`, borderColor: fill,
      color: highlight.textColor, fontSize: `${highlight.fontSize}px`,
      pointerEvents: onSelect ? "auto" : "none",
    };
    const className = `floor-plan-day-highlight${highlight.id === selectedId ? " is-selected" : ""}`;
    const label = <span className="floor-plan-day-highlight-label">{highlight.text}</span>;
    return onSelect ? (
      <button aria-label={`Special event highlight: ${highlight.text}`} aria-pressed={highlight.id === selectedId} className={className} key={highlight.id} onClick={() => onSelect(highlight.id)} style={style} type="button">{label}</button>
    ) : (
      <span aria-label={`Special event highlight: ${highlight.text}`} className={className} key={highlight.id} role="img" style={style}>{label}</span>
    );
  });
}
