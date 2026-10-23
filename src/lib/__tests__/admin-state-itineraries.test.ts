import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAdminStateRequest, loadAdminStateSnapshot } from "../admin-state";
import { emptyAdminState } from "../admin-types";
import { resetLocalChecklistStorageForTests, saveChecklist } from "../checklist-storage";

afterEach(() => { resetLocalChecklistStorageForTests(); vi.unstubAllEnvs(); });

describe("itinerary edits in existing revision-checked Admin storage", () => {
  it("round-trips saved edits and reset while preserving unrelated Admin settings", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SUPABASE_SECRET_KEY", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_SECRET_KEYS", "");
    const state = { ...emptyAdminState(), archivedEventIds: [456], itineraryEditsByEvent: { "123": { updatedAt: "2026-10-21T15:00:00Z", sourceUpdatedAt: null, fields: { food: ["Dessert Platter: 1"] } } } };
    await saveChecklist({ ...buildAdminStateRequest(state), expectedUpdatedAt: null });
    const loaded = await loadAdminStateSnapshot();
    expect(loaded.state).toEqual(state);
    expect(loaded.updatedAt).toBeTruthy();
    await saveChecklist({ ...buildAdminStateRequest({ ...loaded.state, itineraryEditsByEvent: {} }), expectedUpdatedAt: loaded.updatedAt });
    expect((await loadAdminStateSnapshot()).state).toEqual({ ...state, itineraryEditsByEvent: {} });
  });
});
