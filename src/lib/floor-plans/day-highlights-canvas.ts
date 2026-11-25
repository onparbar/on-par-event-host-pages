import type { AdminAssetOverlay } from "@/lib/admin-types";

/** Decorative date notes never participate in seating or Entertainment reservations. */
export function drawFloorPlanDayHighlights(
  context: CanvasRenderingContext2D,
  highlights: AdminAssetOverlay[],
) {
  if (!highlights.length) return;
  for (const highlight of highlights) {
    const x = highlight.x * 19.2;
    const y = highlight.y * 10.8;
    const width = highlight.width * 19.2;
    const height = highlight.height * 10.8;
    context.save();
    context.globalAlpha = highlight.opacity;
    context.fillStyle = highlight.fill;
    context.fillRect(x, y, width, height);
    context.globalAlpha = 1;
    context.strokeStyle = highlight.fill;
    context.lineWidth = 3;
    context.setLineDash([10, 5]);
    context.strokeRect(x, y, width, height);
    context.setLineDash([]);
    context.beginPath();
    context.rect(x + 2, y + 2, Math.max(0, width - 4), Math.max(0, height - 4));
    context.clip();
    context.font = `700 ${highlight.fontSize}px Arial`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#FFFFFF";
    const labelWidth = Math.max(0, Math.min(width - 4, context.measureText(highlight.text).width + 8));
    const labelHeight = Math.max(0, Math.min(height - 4, highlight.fontSize + 6));
    context.fillRect(x + (width - labelWidth) / 2, y + (height - labelHeight) / 2, labelWidth, labelHeight);
    context.fillStyle = "#000000";
    context.fillText(highlight.text, x + width / 2, y + height / 2, Math.max(1, width - 8));
    context.restore();
  }
  context.save();
  context.globalAlpha = 0.92;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 1080, 1920, 44);
  context.globalAlpha = 1;
  context.fillStyle = "#000000";
  context.font = "700 18px Arial";
  context.fillText("Special event highlights: date-wide notes, not party reservations or approved seating.", 34, 1109);
  context.restore();
}
