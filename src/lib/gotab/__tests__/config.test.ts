import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let getGoTabConfigurationStatus: typeof import("../config").getGoTabConfigurationStatus;
let requireGoTabConfiguration: typeof import("../config").requireGoTabConfiguration;

beforeAll(async () => {
  ({ getGoTabConfigurationStatus, requireGoTabConfiguration } = await import("../config"));
});

const configured = {
  GOTAB_API_ACCESS_ID: "id",
  GOTAB_API_ACCESS_SECRET: "secret",
  GOTAB_LOCATION_UUID: "location",
  GOTAB_EVENT_SPOT_UUID: "spot",
  GOTAB_EVENT_CUSTOMER_PHONE: "+19377056024",
  GOTAB_WEBHOOK_SECRET: "webhook",
  EVENT_KDS_ENABLED: "false",
  EVENT_KDS_DRY_RUN: "true",
  EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES: "60",
};

describe("GoTab server configuration", () => {
  it("defaults to blocked dry-run behavior when configuration is absent", () => {
    const status = getGoTabConfigurationStatus({});
    expect(status.configured).toBe(false);
    expect(status.dispatchAllowed).toBe(false);
    expect(status.dryRun).toBe(true);
    expect(status.missingEnvironmentVariables).toContain("GOTAB_API_ACCESS_SECRET");
  });

  it("accepts a complete dry-run configuration without allowing dispatch", () => {
    const status = getGoTabConfigurationStatus(configured);
    expect(status).toMatchObject({ configured: true, enabled: false, dryRun: true, dispatchAllowed: false });
    expect(requireGoTabConfiguration(configured)).toMatchObject({
      apiAccessId: "id",
      apiAccessSecret: "secret",
      defaultPrepLeadMinutes: 60,
    });
  });

  it("allows live dispatch only when explicitly enabled and dry-run is off", () => {
    expect(getGoTabConfigurationStatus({
      ...configured,
      EVENT_KDS_ENABLED: "true",
      EVENT_KDS_DRY_RUN: "false",
    }).dispatchAllowed).toBe(true);
  });
});
