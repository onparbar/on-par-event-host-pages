import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-state", () => ({ loadAdminState: vi.fn(async () => ({ archivedAssetKeys: [], overlaysByAsset: {}, itineraryEditsByEvent: { "1": { private: "ADMIN_ONLY other Admin state" } } })) }));
vi.mock("@/lib/floor-plans/storage", () => ({ getFloorPlanStorage: () => ({}) }));
vi.mock("@/lib/floor-plans/service", () => ({
  ensureConfirmedContractFloorPlanWindow: vi.fn(async () => null),
  loadLiveFloorPlanPublicationWindow: vi.fn(async () => []),
}));

import FloorPlansPage from "../page";
import { loadAdminState } from "@/lib/admin-state";
import { ensureConfirmedContractFloorPlanWindow, loadLiveFloorPlanPublicationWindow } from "@/lib/floor-plans/service";
import type { FloorPlanDayPayload, FloorPlanDocument } from "@/lib/floor-plans/types";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import type { AdminState } from "@/lib/admin-types";

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

it("serializes only assignments and an incomplete indicator to the staff browser", async () => {
  const privateDetail = "ADMIN_ONLY room change from private test detail";
  const plan = {
    id: "floor-plan", eventDate: "2026-11-14", status: "Conflict", version: 3,
    approvedBy: privateDetail, lastTripleseatSyncAt: "2026-11-14T14:00:00Z", sourceWarnings: [privateDetail],
    events: [{ id: "event-1", name: "Redacted event", tripleseatEventId: "1", source: { rooms: ["VIP 1"], operationalNotes: [{ text: privateDetail }], reviewReasons: [privateDetail], seatingGenerationIssues: [{ message: privateDetail }], floorPlanChanges: [{ message: privateDetail }], onParBooking: { confirmationCode: privateDetail } } }],
    reservations: [{ id: "seat-1", floorPlanEventId: "event-1", areaId: "vip-1", changeDetails: { reason: privateDetail } }],
  } as unknown as FloorPlanDocument;
  const payload = {
    date: plan.eventDate, plan, warnings: [privateDetail], floorPlanConflicts: [{ id: privateDetail }],
    entertainmentConflicts: [], validation: [{ status: "Failed", message: privateDetail }],
    revisions: [{ description: privateDetail, newValue: plan }], sourceChanges: [{ message: privateDetail }],
    entertainmentReservations: [{ id: "lane-1", resourceId: "bowling-1", active: true, notes: privateDetail, reviewIssues: [{ message: privateDetail }] } as unknown as EntertainmentReservation],
  } as unknown as FloorPlanDayPayload;
  vi.mocked(loadLiveFloorPlanPublicationWindow).mockResolvedValueOnce([{ plan, payload }, { plan, payload: null }]);
  const result = await FloorPlansPage({ searchParams: Promise.resolve({ date: plan.eventDate }) });
  const serialized = JSON.stringify(result.props);
  expect(serialized).not.toContain(privateDetail);
  expect(serialized).not.toContain("ADMIN_ONLY other Admin state");
  expect(serialized).not.toContain("floorPlanConflicts");
  expect(serialized).not.toContain("itineraryEditsByEvent");
  expect(result.props.publications[0].payload).toMatchObject({
    incomplete: true,
    plan: { events: [{ name: "Redacted event" }], reservations: [{ areaId: "vip-1" }] },
    entertainmentReservations: [{ resourceId: "bowling-1" }],
  });
  expect(result.props.publications[1].plan.status).toBe("Draft");
});

it("projects only sanitized date-wide highlights within displayed dates, including an explicitly requested note-only date", async () => {
  const note = { id: "trivia", kind: "highlight", x: 10, y: 20, width: 30, height: 15, fill: "#297025", opacity: 0.5, text: "Public Trivia", textColor: "#FFFFFF", fontSize: 18 };
  vi.mocked(loadAdminState).mockResolvedValueOnce({ archivedAssetKeys: [], archivedEventIds: [], overlaysByAsset: {
    "floor-plan-day:2026-12-03": [note],
    "floor-plan-day:2030-02-02": [{ ...note, text: "Public requested date" }],
    "floor-plan-day:2030-02-03": [{ ...note, text: "OTHER_DATE_DO_NOT_EXPOSE" }],
    "floor-plan-day:2026-12-04": [{ ...note, kind: "cover", text: "INVALID_COVER_DO_NOT_EXPOSE" }],
    "unrelated-admin-asset": [{ ...note, text: "ADMIN_ASSET_DO_NOT_EXPOSE" }],
  }, itineraryEditsByEvent: {} } as AdminState);
  const result = await FloorPlansPage({ searchParams: Promise.resolve({ date: "2030-02-02" }) });
  const serialized = JSON.stringify(result.props);
  expect(result.props.highlightsByDate["2026-12-03"]).toMatchObject([{ text: "Public Trivia" }]);
  expect(result.props.highlightsByDate["2030-02-02"]).toMatchObject([{ text: "Public requested date" }]);
  expect(result.props.highlightsByDate["2030-02-03"]).toBeUndefined();
  expect(serialized).not.toContain("OTHER_DATE_DO_NOT_EXPOSE");
  expect(serialized).not.toContain("INVALID_COVER_DO_NOT_EXPOSE");
  expect(serialized).not.toContain("ADMIN_ASSET_DO_NOT_EXPOSE");
  expect(result.props.initialState.overlaysByAsset["floor-plan-day:2030-02-02"]).toBeUndefined();
});
