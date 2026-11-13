import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasAdminSession = vi.fn();
const loadAdminStateSnapshot = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/admin-state", () => ({ loadAdminStateSnapshot }));
vi.mock("@/lib/event-plans/sync", () => ({ findEventPlanById: vi.fn(), loadEventPlanWindow: vi.fn(), loadHistoricalEventPlans: vi.fn() }));
vi.mock("@/lib/entertainment/sync", () => ({ getEntertainmentDay: vi.fn() }));
vi.mock("@/lib/floor-plans/storage", () => ({ getFloorPlanStorage: vi.fn() }));
vi.mock("../../AdminAccessGate", () => ({ default: () => createElement("p", null, "Admin session required") }));

describe("Admin itinerary editor access", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires Admin authentication before loading itinerary or saved edits", async () => {
    hasAdminSession.mockReturnValue(false);
    const { default: Page } = await import("../page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ eventId: "123" }) }));
    expect(html).toContain("Admin session required");
    expect(loadAdminStateSnapshot).not.toHaveBeenCalled();
  });
});
