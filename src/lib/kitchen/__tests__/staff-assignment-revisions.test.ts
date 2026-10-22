import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_KITCHEN_EVENTS } from "../fixtures";
import { generateKitchenChecklist } from "../rules";
import {
  createMemoryKitchenStorage,
  KITCHEN_ROLE_METADATA_PREFIX,
  KITCHEN_STAFF_ROSTER,
  KitchenStaffAssignmentConflictError,
  SupabaseKitchenStorage,
} from "../storage";
import { updateKitchenManualAssignments } from "../sync";

afterEach(() => vi.useRealTimers());

const NOW = "2026-10-21T17:00:00.000Z";
type AssignmentRow = { event_id: string; food_runners: string[]; pocs: string[]; bwa: string; updated_at: string };

function database() {
  const rows = new Map<string, AssignmentRow>();
  const requests: Array<{ url: URL; method: string; headers: Headers }> = [];
  const storage = new SupabaseKitchenStorage({
    env: { NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test-value" },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({ url, method, headers });
      const row = init?.body ? JSON.parse(String(init.body)) as AssignmentRow : null;
      if (method === "POST" && row) {
        if (rows.has(row.event_id)) return Response.json([]);
        rows.set(row.event_id, row);
        return Response.json([{ updated_at: row.updated_at }]);
      }
      if (method === "PATCH" && row) {
        const previous = rows.get(row.event_id);
        if (!previous || url.searchParams.get("event_id") !== `eq.${row.event_id}` ||
          url.searchParams.get("updated_at") !== `eq.${previous.updated_at}`) return Response.json([]);
        rows.set(row.event_id, row);
        return Response.json([{ updated_at: row.updated_at }]);
      }
      return Response.json(url.pathname.endsWith("/kitchen_manual_assignments") ? [...rows.values()] : []);
    },
  });
  return { storage, rows, requests };
}

describe("kitchen staff-assignment compare-and-swap revisions", () => {
  it.each(["memory", "database"] as const)("%s rejects simultaneous first saves and preserves the winner", async (mode) => {
    vi.useFakeTimers().setSystemTime(NOW);
    const db = database();
    const storage = mode === "memory" ? createMemoryKitchenStorage() : db.storage;
    const results = await Promise.allSettled([
      storage.saveManualAssignments("event-a", ["Lex"], ["Tina"], "Carlos", "Daniel", ["Brooke"], null),
      storage.saveManualAssignments("event-a", ["Derek"], [], "", "", [], null),
    ]);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: NOW });
    expect(results[1].status).toBe("rejected");
    if (results[1].status === "rejected") expect(results[1].reason).toBeInstanceOf(KitchenStaffAssignmentConflictError);
    await expect(storage.saveManualAssignments("event-a", ["Derek"], [], "", "", [], null)).rejects.toBeInstanceOf(KitchenStaffAssignmentConflictError);
    if (mode === "database") {
      expect(db.rows.get("event-a")).toMatchObject({ food_runners: ["Lex"], pocs: ["Tina"], updated_at: NOW });
      expect(db.requests[0]).toMatchObject({ method: "POST" });
      expect(db.requests[0].url.searchParams.get("on_conflict")).toBe("event_id");
      expect(db.requests[0].headers.get("Prefer")).toBe("resolution=ignore-duplicates,return=representation");
    }
  });

  it.each(["memory", "database"] as const)("%s rejects stale updates and increments revisions with a frozen or backwards clock", async (mode) => {
    vi.useFakeTimers().setSystemTime(NOW);
    const db = database();
    const storage = mode === "memory" ? createMemoryKitchenStorage() : db.storage;
    const first = await storage.saveManualAssignments("event-a", ["Lex"], ["Tina"], "", "", [], null);
    const second = await storage.saveManualAssignments("event-a", ["Carlos"], ["Brooke"], "", "", [], first!);
    expect(second).toBe("2026-10-21T17:00:00.001Z");
    vi.setSystemTime("2026-10-21T16:00:00.000Z");
    const third = await storage.saveManualAssignments("event-a", ["Daniel"], ["Geldi"], "", "", [], second!);
    expect(third).toBe("2026-10-21T17:00:00.002Z");
    await expect(storage.saveManualAssignments("event-a", ["Derek"], [], "", "", [], first!)).rejects.toBeInstanceOf(KitchenStaffAssignmentConflictError);
    if (mode === "database") {
      expect(db.rows.get("event-a")).toMatchObject({ food_runners: ["Daniel"], pocs: ["Geldi"], updated_at: third });
      expect(db.requests[1].method).toBe("PATCH");
      expect(db.requests[1].url.searchParams.get("event_id")).toBe("eq.event-a");
      expect(db.requests[1].url.searchParams.get("updated_at")).toBe(`eq.${first}`);
      expect(db.requests[1].headers.get("Prefer")).toBe("return=representation");
    }
  });

  it("uses the full returned PostgreSQL revision and advances beyond microseconds", async () => {
    vi.useFakeTimers().setSystemTime("2026-10-21T16:00:00.000Z");
    const db = database();
    const previous = "2026-10-21T17:00:00.123456+00:00";
    db.rows.set("event-a", { event_id: "event-a", food_runners: [], pocs: [], bwa: "", updated_at: previous });
    const next = await db.storage.saveManualAssignments("event-a", ["Lex"], ["Tina"], "", "", [], previous);
    expect(next).toBe("2026-10-21T17:00:00.124Z");
    expect(db.requests[0].url.searchParams.get("updated_at")).toBe(`eq.${previous}`);
  });

  it.each(["invalid", "2026-10-21T17:00:00", "eq.unsafe"])('rejects malformed expected revision "%s" before a database request', async (revision) => {
    const db = database();
    await expect(db.storage.saveManualAssignments("event-a", [], [], "", "", [], revision)).rejects.toThrow("Invalid staff-assignment revision");
    expect(db.requests).toEqual([]);
  });

  it("sync returns its saved revision, preserves normalized names and forwards the stale-save guard", async () => {
    vi.useFakeTimers().setSystemTime(NOW);
    const storage = createMemoryKitchenStorage();
    const source = { ...MOCK_KITCHEN_EVENTS[0], eventId: "event-a", localDate: "2026-10-21" };
    await storage.saveEvent({ sourceEvent: source, checklist: generateKitchenChecklist(source) });
    const first = await updateKitchenManualAssignments(" event-a ", [" Lex ", "Lex"], ["Tina"], { storage }, " Carlos ", " Daniel ", ["Brooke"], null);
    expect(first).toEqual({ eventId: "event-a", foodRunners: ["Lex"], pocs: ["Tina"], preppedBy: "Carlos", verifiedBy: "Daniel", setup: ["Brooke"], updatedAt: NOW });
    await expect(updateKitchenManualAssignments("event-a", ["Derek"], [], { storage }, "", "", [], null)).rejects.toBeInstanceOf(KitchenStaffAssignmentConflictError);
    const saved = (await storage.getDay("2026-10-21")).events[0];
    expect(saved).toMatchObject({ foodRunners: ["Lex"], pocs: ["Tina"], preppedBy: "Carlos", verifiedBy: "Daniel", setup: ["Brooke"], assignmentUpdatedAt: NOW });
  });

  it("includes the assignment revision when reading database rows", async () => {
    const db = database();
    await db.storage.getDay("2026-10-21");
    const manualRead = db.requests.find((request) => request.url.pathname.endsWith("/kitchen_manual_assignments"));
    expect(manualRead?.url.searchParams.get("select")).toContain("updated_at");
  });

  it.each([6, 24])("preserves all %i approved setup employees instead of truncating the role JSON", async (count) => {
    const db = database();
    const setup = count === 6
      ? ["Brooke", "Samantha", "Veronica", "Estuardo", "Lindsey", "Jasmonica"]
      : KITCHEN_STAFF_ROSTER.slice(0, 24);
    await updateKitchenManualAssignments("event-a", ["Lex"], ["Tina"], { storage: db.storage }, "Carlos", "Daniel", setup, null);
    const metadata = db.rows.get("event-a")!.bwa;
    expect(metadata.length).toBeGreaterThan(120);
    expect(metadata.length).toBeLessThanOrEqual(4096);
    expect(JSON.parse(metadata.slice(KITCHEN_ROLE_METADATA_PREFIX.length))).toEqual({ preppedBy: "Carlos", verifiedBy: "Daniel", setup });
  });
});
