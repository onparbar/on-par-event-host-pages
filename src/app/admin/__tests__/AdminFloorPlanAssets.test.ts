import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DateAsset } from "@/lib/events";
import AdminFloorPlanAssets from "../AdminFloorPlanAssets";

const plan: DateAsset = {
  date: "2026-08-06",
  label: "Thursday, August 6, 2026",
  image: "/floor-plans/august-06.png",
  events: ["Next Event"],
};

describe("admin floor-plan assets", () => {
  it("keeps highlight editing and Tripleseat sync access in Admin", () => {
    const html = renderToStaticMarkup(
      createElement(AdminFloorPlanAssets, {
        archivedAssetKeys: [],
        assets: [plan],
        onOverlaysChange: () => {},
        overlaysByAsset: {},
        today: "2026-08-04",
      }),
    );

    expect(html).toContain("Published Floor Plan Highlights");
    expect(html).toContain("Live Tripleseat Floor Plan Sync");
    expect(html).toContain('href="/admin/floor-plans"');
    expect(html).toContain("Add Highlight");
    expect(html).toContain("Add Cover");
  });
});
