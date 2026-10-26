import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ construct: vi.fn(), claim: vi.fn().mockResolvedValue([]) }));
vi.mock("server-only", () => ({}));
vi.mock("../storage", () => ({ GoTabIntegrationStorage: class {
  constructor() { calls.construct(); }
  claimDueDispatches = calls.claim;
} }));
const { processGoTabDispatches } = await import("../worker");
const review = { VERCEL_ENV: "preview", EVENT_HOST_REVIEW_ONLY: "true" };

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("read-only Preview stops workers before live persistence", () => {
  it("does not construct storage, claim requests or call any network from a Preview worker", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    const result = await processGoTabDispatches();
    expect(result).toMatchObject({ claimed: 0, sent: 0, failed: 0, dryRunCompleted: 0,
      lastError: expect.stringContaining("No requests were claimed or modified") });
    expect(calls.construct).not.toHaveBeenCalled(); expect(calls.claim).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("also stops an explicitly scoped worker in the deployment's review environment", async () => {
    const storage = { claimDueDispatches: vi.fn() };
    await processGoTabDispatches({ storage: storage as never, requestIds: ["request-test"], env: review });
    expect(storage.claimDueDispatches).not.toHaveBeenCalled();
  });

  it("leaves Production and ordinary Preview processing unchanged", async () => {
    for (const env of [{ ...review, VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }]) {
      const result = await processGoTabDispatches({ env });
      expect(result.lastError).toBeNull();
    }
    expect(calls.construct).toHaveBeenCalledTimes(2); expect(calls.claim).toHaveBeenCalledTimes(2);
  });
});
