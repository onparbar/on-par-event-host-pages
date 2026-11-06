import { afterEach, describe, expect, it, vi } from "vitest";
import { getEntertainmentDay } from "@/lib/entertainment/sync";
import { MemoryEntertainmentStorage } from "@/lib/entertainment/storage";
import { getKitchenDay } from "@/lib/kitchen/sync";
import { createMemoryKitchenStorage } from "@/lib/kitchen/storage";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

const adapter: TripleseatAdapter = { sourceMode: "live", fetchEventsForDate: async () => [],
  fetchEntertainmentEventsForDate: async () => [], fetchEventDateById: async () => null,
  getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }) };

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("read-only review Preview GET projections", () => {
  it.each(["preview", "production"])("%s respects deployment-only read-model persistence policy", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    const kitchen = createMemoryKitchenStorage();
    const kitchenSave = vi.spyOn(kitchen, "saveEvent");
    const day = await getKitchenDay("2026-08-15", { storage: kitchen, adapter, now: new Date("2026-08-15T15:00:00Z"),
      floorPlanStorage: { get: async () => null }, persistSourceChanges: true,
      vipPrepClient: { configured: true, fetchRange: async () => vipPrepPayload } });
    expect(day.events).toHaveLength(1);
    const entertainment = new MemoryEntertainmentStorage();
    const evidenceSave = vi.spyOn(entertainment, "saveContractEvidence");
    const schedule = await getEntertainmentDay("2026-08-21", { storage: entertainment, adapter, localEvents: [], readOnly: false,
      vipPrepClient: { configured: false, fetchRange: async () => vipPrepPayload } });
    expect(schedule.reservations.length).toBeGreaterThan(0);
    if (environment === "preview") {
      expect(kitchenSave).not.toHaveBeenCalled();
      expect(evidenceSave).not.toHaveBeenCalled();
    } else {
      expect(kitchenSave).toHaveBeenCalled();
      expect(evidenceSave).toHaveBeenCalled();
    }
  });
});
