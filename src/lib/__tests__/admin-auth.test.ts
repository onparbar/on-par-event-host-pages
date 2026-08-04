import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionValue,
  hasAdminSession,
} from "../admin-auth";

function clearServerSecretFallbacks() {
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("SUPABASE_SECRET_KEYS", "");
  vi.stubEnv("TRIPLESEAT_CLIENT_SECRET", "");
  vi.stubEnv("CLIENT_SECRET", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin session security", () => {
  it("signs the session with a high-entropy server secret", () => {
    clearServerSecretFallbacks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVENT_HOST_ADMIN_PIN", "1234");
    vi.stubEnv(
      "EVENT_HOST_SESSION_SECRET",
      "first-production-session-secret-123456",
    );
    const first = createAdminSessionValue();

    vi.stubEnv(
      "EVENT_HOST_SESSION_SECRET",
      "second-production-session-secret-12345",
    );
    const second = createAdminSessionValue();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });

  it("fails closed in production without a server session secret", () => {
    clearServerSecretFallbacks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVENT_HOST_ADMIN_PIN", "1234");
    vi.stubEnv("EVENT_HOST_SESSION_SECRET", "");

    expect(createAdminSessionValue()).toBeNull();
    expect(
      hasAdminSession({
        get(name: string) {
          return name === ADMIN_COOKIE_NAME
            ? { name, value: "forged-cookie" }
            : undefined;
        },
      }),
    ).toBe(false);
  });
});
