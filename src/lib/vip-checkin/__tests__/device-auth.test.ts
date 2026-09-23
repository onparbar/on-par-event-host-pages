import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createVipDeviceSession, hasVipDeviceSession, VIP_DEVICE_COOKIE_NAME, VIP_DEVICE_MAX_AGE } =
  await import("../device-auth");

afterEach(() => vi.unstubAllEnvs());

describe("VIP staff tablet authorization", () => {
  it("accepts an admin-issued tablet session without an employee code", () => {
    vi.stubEnv("EVENT_HOST_SESSION_SECRET", "test-session-secret-that-is-long-enough-12345");
    const now = Date.parse("2026-09-23T12:00:00Z");
    const token = createVipDeviceSession(now)!;
    const cookies = { get: (name: string) => name === VIP_DEVICE_COOKIE_NAME ? { value: token } : undefined };
    expect(hasVipDeviceSession(cookies, now + 1000)).toBe(true);
    expect(hasVipDeviceSession(cookies, now + VIP_DEVICE_MAX_AGE * 1000 + 1)).toBe(false);
  });

  it("rejects missing and altered tablet sessions", () => {
    vi.stubEnv("EVENT_HOST_SESSION_SECRET", "test-session-secret-that-is-long-enough-12345");
    const now = Date.parse("2026-09-23T12:00:00Z");
    const token = createVipDeviceSession(now)!;
    expect(hasVipDeviceSession({ get: () => undefined }, now)).toBe(false);
    expect(hasVipDeviceSession({ get: () => ({ value: `${token}tampered` }) }, now)).toBe(false);
  });
});
