import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-state", () => ({ loadAdminState: async () => ({}) }));
vi.mock("@/lib/floor-plans/storage", () => ({ getFloorPlanStorage: () => ({}) }));
vi.mock("@/lib/floor-plans/service", () => ({
  ensureConfirmedContractFloorPlanWindow: vi.fn(async () => null),
  loadLiveFloorPlanPublicationWindow: vi.fn(async () => []),
}));

import FloorPlansPage from "../page";
import { ensureConfirmedContractFloorPlanWindow, loadLiveFloorPlanPublicationWindow } from "@/lib/floor-plans/service";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("floor-plan page review Preview safety", () => {
  it.each(["preview", "production"])("%s reads the exact date without initializing plans during review Preview", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    await FloorPlansPage({ searchParams: Promise.resolve({ date: "2026-11-14" }) });
    expect(loadLiveFloorPlanPublicationWindow).toHaveBeenCalledWith(expect.any(String), {}, "2026-11-14", undefined, "2026-12");
    if (environment === "preview") expect(ensureConfirmedContractFloorPlanWindow).not.toHaveBeenCalled();
    else expect(ensureConfirmedContractFloorPlanWindow).toHaveBeenCalledTimes(1);
  });
});
