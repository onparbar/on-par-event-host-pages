import { describe, expect, it, vi } from "vitest";
import { GoTabIntegrationStorage } from "../storage";
import { projectKitchenChecklist } from "../project-kitchen";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipInitialFoodSnapshot } from "@/lib/vip-checkin/release-snapshot";

vi.mock("server-only", () => ({}));

const reservation = vipPrepPayload.reservations[0];
const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
const wing = checklist.sections.flatMap((section) => section.rows).find((row) => row.key === "platter-wings")!;
const request = projectKitchenChecklist(checklist, [{ id: "test-mapping", canonicalProductKey: "platter-wings", displayName: "Wings", aliases: [],
  panSize: wing.panSize === "1/3" ? "THIRD_PAN" : "HALF_PAN", preparationStation: "FRYER", gotabProductUuid: "test-product", verifiedAt: "2026-08-11T12:00:00Z" }],
  { sourceType: "VIP_ADDON", sourceVersion: 1, bookedFoodQuantities: new Map([["platter-wings", 2]]) }).requests[0];
const snapshot = vipInitialFoodSnapshot(reservation, { employee_name: "Tina", checked_in_at: "2026-08-15T20:00:00Z" });
const preview = { vipReleaseSnapshot: snapshot };
const env = { NODE_ENV: "test" as const, SUPABASE_SECRET_KEY: "sanitized-test-secret" };

function database(requestOverride: Record<string, unknown> = {}, dispatchSnapshot: unknown = snapshot) {
  let body: { p_request: Record<string, unknown> };
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (init?.method === "POST") {
      body = JSON.parse(String(init.body));
      return Response.json({ code: "23505" }, { status: 409 });
    }
    if (new URL(String(url)).pathname.endsWith("/event_food_requests")) return Response.json([{ id: "request-existing", ...body.p_request, ...requestOverride }]);
    return Response.json([{ id: "dispatch-existing", sanitized_payload: { vipReleaseSnapshot: dispatchSnapshot } }]);
  });
  return { storage: new GoTabIntegrationStorage(env, fetchImpl), fetchImpl };
}

describe("VIP initial enqueue unique-conflict recovery", () => {
  it("recovers only the exact committed immutable request after a DB unique conflict without retrying any write", async () => {
    const test = database();
    const result = await test.storage.enqueueRequest(request, preview, "VIP_CHECK_IN:Tina");
    expect(result).toEqual({ request_id: "request-existing", dispatch_id: "dispatch-existing", duplicate: true });
    expect(test.fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET", "GET"]);
    const requestLookup = new URL(String(test.fetchImpl.mock.calls[1][0]));
    expect(requestLookup.searchParams.get("idempotency_key")).toBe(`eq.${request.idempotencyKey}`);
    const dispatchLookup = new URL(String(test.fetchImpl.mock.calls[2][0]));
    expect(dispatchLookup.searchParams.get("request_id")).toBe("eq.request-existing");
    expect(dispatchLookup.searchParams.get("action")).toBe("eq.DISPATCH");
  });

  it.each([
    { quantity: 3 }, { event_id: "vip-other-source" }, { source_record_id: "platter-fries" },
    { pan_size: "FULL_PAN" }, { event_area: "VIP 1" }, { food_service_time: "2026-08-15T23:30:00Z" },
    { gotab_product_uuid: "different-product" },
  ])("does not swallow a conflict whose immutable request differs: %j", async (override) => {
    const test = database(override);
    await expect(test.storage.enqueueRequest(request, preview, "VIP_CHECK_IN:Tina")).rejects.toThrow("(409)");
    expect(test.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each([
    { ...snapshot, sourceFingerprint: "a".repeat(64) },
    { ...snapshot, checkedInBy: "Lex" },
    { ...snapshot, checkedInAt: "2026-08-15T20:01:00Z" },
    null,
  ])("does not recover a different or missing release snapshot", async (savedSnapshot) => {
    const test = database({}, savedSnapshot);
    await expect(test.storage.enqueueRequest(request, preview, "VIP_CHECK_IN:Tina")).rejects.toThrow("(409)");
    expect(test.fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not change conflict behavior for corporate orders, add-ons or snapshotless legacy requests", async () => {
    for (const [input, payload] of [[{ ...request, eventId: "corporate-event" }, preview],
      [{ ...request, sourceRecordId: "addon:wings" }, preview], [request, {}]] as const) {
      const test = database();
      await expect(test.storage.enqueueRequest(input, payload, "SYSTEM")).rejects.toThrow("(409)");
      expect(test.fetchImpl).toHaveBeenCalledOnce();
    }
  });
});
