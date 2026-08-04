import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DateAsset } from "@/lib/events";
import {
  FloorPlanCard,
  organizeFloorPlanAssets,
  syncFloorPlanFromTripleseat,
} from "../FloorPlansClient";

const pastPlan: DateAsset = {
  date: "2026-08-03",
  label: "Monday, August 3, 2026",
  image: "/floor-plans/past.png",
  events: ["Past Event"],
};

const nextPlan: DateAsset = {
  date: "2026-08-06",
  label: "Thursday, August 6, 2026",
  image: "/floor-plans/next.png",
  events: ["Next Event"],
};

const laterPlan: DateAsset = {
  date: "2026-08-08",
  label: "Saturday, August 8, 2026",
  image: "/floor-plans/later.png",
  events: ["Later Event"],
};

describe("floor-plan dashboard organization", () => {
  it("opens the nearest upcoming plan and archives past plans", () => {
    const result = organizeFloorPlanAssets(
      [laterPlan, pastPlan, nextPlan],
      [],
      "2026-08-04",
    );

    expect(result.upcoming.map((plan) => plan.image)).toEqual([
      nextPlan.image,
      laterPlan.image,
    ]);
    expect(result.archived.map((plan) => plan.image)).toEqual([
      pastPlan.image,
    ]);
    expect(result.defaultAssetKey).toBe(nextPlan.image);
  });

  it("keeps manually archived future plans in the archive", () => {
    const result = organizeFloorPlanAssets(
      [nextPlan, laterPlan],
      [],
      "2026-08-04",
      [nextPlan.image],
    );

    expect(result.upcoming.map((plan) => plan.image)).toEqual([
      laterPlan.image,
    ]);
    expect(result.archived.map((plan) => plan.image)).toEqual([
      nextPlan.image,
    ]);
  });

  it("renders each plan as a read-only dropdown without editing controls", () => {
    const plan = organizeFloorPlanAssets(
      [nextPlan],
      [],
      "2026-08-04",
    ).upcoming[0];
    const html = renderToStaticMarkup(
      createElement(FloorPlanCard, {
        asset: plan,
        isOpen: true,
        onOpenChange: () => {},
        onSync: () => {},
        overlays: [],
      }),
    );

    expect(html).toContain("<details open=\"\"");
    expect(html).toContain("Next Event");
    expect(html).toContain("Sync live from Tripleseat");
    for (const editorCopy of [
      "Add Highlight",
      "Add Cover",
      "Reset Edits",
      "Editor controls",
      "Highlight editing",
      "Tripleseat synchronization",
      "how to edit",
    ]) {
      expect(html).not.toContain(editorCopy);
    }
  });

  it("runs the real Tripleseat floor-plan refresh action for the selected date", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          date: nextPlan.date,
          plan: {
            eventDate: nextPlan.date,
            events: [],
            lastTripleseatSyncAt: "2026-08-04T16:00:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await syncFloorPlanFromTripleseat(
      nextPlan.date,
      fetchImpl as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledWith("/api/floor-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: nextPlan.date, action: "refresh" }),
    });
    expect(result.plan.lastTripleseatSyncAt).toBe(
      "2026-08-04T16:00:00.000Z",
    );
  });
});
