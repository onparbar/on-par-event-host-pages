import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "../route";
import { releaseStatus } from "@/lib/operations/release-status";

const liveTripleseat = { NODE_ENV: "production", TRIPLESEAT_CLIENT_ID: "test-client", TRIPLESEAT_CLIENT_SECRET: "test-secret", TRIPLESEAT_REFRESH_TOKEN: "test-refresh" };
const configuredGoTab = {
  GOTAB_API_ACCESS_ID: "test-access", GOTAB_API_ACCESS_SECRET: "test-secret", GOTAB_LOCATION_UUID: "test-location",
  GOTAB_EVENT_SPOT_UUID: "test-spot", GOTAB_EVENT_CUSTOMER_PHONE: "test-phone", GOTAB_WEBHOOK_SECRET: "test-webhook",
  EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false", EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES: "60",
};
const env = (values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "production", ...values });

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("safe release runtime proof", () => {
  it("reports only an allowlisted summary and performs no requests", async () => {
    const fetch = vi.fn(() => { throw new Error("Unexpected upstream request"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("EVENT_HOST_RELEASE_SHA", "a".repeat(40));
    vi.stubEnv("SUPABASE_URL", "https://tmnstuthbllnoqgepotn.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sensitive-database-key");
    vi.stubEnv("PRIVATE_GUEST_NAME", "private-guest");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const value = await response.json();
    expect(Object.keys(value).sort()).toEqual(["checklists", "database", "deploymentEnvironment", "gotab", "releaseSha", "reviewOnly", "tripleseat"]);
    expect(value).toMatchObject({ deploymentEnvironment: "preview", releaseSha: "a".repeat(40), database: { targetMatchesEventHost: true, credentialsConfigured: true } });
    expect(JSON.stringify(value)).not.toMatch(/supabase\.co|sensitive-database-key|private-guest|test-phone/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, true], ["", true], ["https://tmnstuthbllnoqgepotn.supabase.co/", true],
    ["https://different.supabase.co", false], ["http://tmnstuthbllnoqgepotn.supabase.co", false], ["invalid-url", null],
  ])("resolves the database target without exposing its URL: %s", (url, matches) => {
    expect(releaseStatus(env({ SUPABASE_URL: url })).database.targetMatchesEventHost).toBe(matches);
  });

  it.each([
    [{}, false], [{ SUPABASE_SECRET_KEY: "key" }, true], [{ SUPABASE_SERVICE_ROLE_KEY: "key" }, true],
    [{ SUPABASE_SECRET_KEYS: '{"primary":"key"}' }, true], [{ SUPABASE_SECRET_KEYS: "invalid" }, false],
  ])("uses existing database credential resolution: %j", (values, configured) => {
    expect(releaseStatus(env(values)).database.credentialsConfigured).toBe(configured);
  });

  it.each([
    [{}, "mock"], [liveTripleseat, "live"], [{ ...liveTripleseat, TRIPLESEAT_MOCK: "yes" }, "mock"],
    [{ ...liveTripleseat, TRIPLESEAT_MOCK_MODE: "TRUE" }, "mock"],
    [{ ...liveTripleseat, TRIPLESEAT_MOCK: "false", TRIPLESEAT_MOCK_MODE: "true" }, "live"],
    [{ CLIENT_ID: "legacy", CLIENT_SECRET: "legacy", TRIPLESEAT_ACCESS_TOKEN: "token", TRIPLESEAT_REFRESH_TOKEN: "refresh" }, "live"],
    [{ TRIPLESEAT_CLIENT_ID: "client", TRIPLESEAT_CLIENT_SECRET: "secret", TRIPLESEAT_ACCESS_TOKEN: "token" }, "mock"],
    [{ TRIPLESEAT_CLIENT_ID: "client", TRIPLESEAT_CLIENT_SECRET: "secret", TRIPLESEAT_TOKEN_ENCRYPTION_KEY: "configured" }, "live"],
  ])("matches shared kitchen and entertainment adapter mode: %j", (values, mode) => {
    expect(releaseStatus(env(values)).tripleseat).toEqual({ kitchenMode: mode, entertainmentMode: mode });
  });

  it.each([
    [{}, "unconfigured", false], [configuredGoTab, "live", true],
    [{ ...configuredGoTab, EVENT_KDS_ENABLED: "false" }, "disabled", false],
    [{ ...configuredGoTab, EVENT_KDS_DRY_RUN: "true" }, "dry-run", false],
    [{ ...configuredGoTab, EVENT_KDS_ENABLED: "yes" }, "unconfigured", false],
  ])("reports GoTab send mode without exposing any configuration values: %j", (values, mode, allowed) => {
    const status = releaseStatus(env(values));
    expect(status.gotab).toMatchObject({ mode, dispatchAllowed: allowed });
    expect(JSON.stringify(status)).not.toMatch(/test-access|test-secret|test-location|test-spot|test-phone|test-webhook/);
  });

  it("rejects arbitrary environment and release strings from the response", () => {
    const status = releaseStatus(env({ VERCEL_ENV: "private-team-name", EVENT_HOST_RELEASE_SHA: "sensitive-not-a-commit" }));
    expect(status.deploymentEnvironment).toBe("unknown");
    expect(status.releaseSha).toBeNull();
  });

  it("verifies automatic closeout configuration without invoking it or exposing the cron credential", () => {
    const values = { CHECKLIST_AUTO_SUBMIT_ENABLED: "true", CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: "2026-10-26T16:30:00-04:00", CRON_SECRET: "private-cron-credential" };
    expect(releaseStatus(env(values)).checklists).toEqual({ automaticSubmissionEnabled: true, activatedAt: "2026-10-26T20:30:00.000Z", cronConfigured: true });
    expect(JSON.stringify(releaseStatus(env(values)))).not.toContain(values.CRON_SECRET);
    for (const override of [{ CHECKLIST_AUTO_SUBMIT_ENABLED: "false" }, { CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: "private-invalid-value" }, { CRON_SECRET: "" }, { VERCEL_ENV: "preview", EVENT_HOST_REVIEW_ONLY: "true" }]) {
      expect(releaseStatus(env({ ...values, ...override })).checklists.automaticSubmissionEnabled).toBe(false);
    }
    expect(releaseStatus(env({ ...values, CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: "private-invalid-value" })).checklists.activatedAt).toBeNull();
  });
});
