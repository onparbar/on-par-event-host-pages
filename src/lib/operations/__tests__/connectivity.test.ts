import { describe, expect, it } from "vitest";
import { nextPortalConnectivityState, portalConnectivityNotice } from "../connectivity";

describe("read-only portal connectivity notices", () => {
  it("makes no online or saved-data claim before hydration", () => {
    expect(portalConnectivityNotice("unknown")).toBeNull();
    expect(portalConnectivityNotice(nextPortalConnectivityState("unknown", true))).toBeNull();
  });
  it("clearly warns about outdated information and uncertain food orders when offline", () => {
    const state = nextPortalConnectivityState("online", false);
    expect(state).toBe("offline");
    expect(portalConnectivityNotice(state)).toEqual({ role: "alert", message: "Offline—displayed information may be outdated; changes are not confirmed. Do not resubmit an uncertain food order." });
  });
  it("also warns if the browser starts offline", () => {
    expect(nextPortalConnectivityState("unknown", false)).toBe("offline");
  });
  it("requires saved-data verification after reconnect rather than claiming everything synchronized", () => {
    const state = nextPortalConnectivityState("offline", true);
    expect(state).toBe("restored");
    expect(portalConnectivityNotice(state)).toEqual({ role: "status", message: "Connection restored—refresh to verify latest saved data." });
    expect(nextPortalConnectivityState(state, true)).toBe("restored");
    expect(nextPortalConnectivityState(state, false)).toBe("offline");
  });
});
