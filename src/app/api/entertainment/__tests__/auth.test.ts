import { afterEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionValue,
} from "../../../../lib/admin-auth";
import { requireEntertainmentSession } from "../_auth";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function configureProductionSession() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVENT_HOST_ADMIN_PIN", "1234");
  vi.stubEnv(
    "EVENT_HOST_SESSION_SECRET",
    "entertainment-test-session-secret-123456",
  );
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("TRIPLESEAT_CLIENT_SECRET", "");
  vi.stubEnv("CLIENT_SECRET", "");
}

describe("Entertainment Schedule edit permission", () => {
  it("rejects a missing or forged Event Host admin session", async () => {
    configureProductionSession();
    vi.mocked(cookies).mockResolvedValue({
      get() {
        return {
          name: ADMIN_COOKIE_NAME,
          value: "forged-entertainment-cookie",
        };
      },
    } as never);
    expect(await requireEntertainmentSession()).toBe(false);
  });

  it("accepts the existing signed Event Host admin session", async () => {
    configureProductionSession();
    const session = createAdminSessionValue();
    vi.mocked(cookies).mockResolvedValue({
      get() {
        return session
          ? { name: ADMIN_COOKIE_NAME, value: session }
          : undefined;
      },
    } as never);
    expect(await requireEntertainmentSession()).toBe(true);
  });
});
