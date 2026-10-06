import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginOperationalRequest } from "../operational-access";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("operational request access", () => {
  it("allows a same-origin production request", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("https://eventhost.example/api/checklists", {
      method: "PUT",
      headers: { origin: "https://eventhost.example" },
    });

    expect(isSameOriginOperationalRequest(request)).toBe(true);
  });

  it("rejects cross-origin and originless production requests", () => {
    vi.stubEnv("NODE_ENV", "production");
    const crossOrigin = new Request(
      "https://eventhost.example/api/checklists",
      {
        method: "PUT",
        headers: { origin: "https://malicious.example" },
      },
    );
    const originless = new Request(
      "https://eventhost.example/api/checklists",
      { method: "PUT" },
    );

    expect(isSameOriginOperationalRequest(crossOrigin)).toBe(false);
    expect(isSameOriginOperationalRequest(originless)).toBe(false);
  });

  it("uses Vercel forwarded host and protocol headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new Request("http://internal-host/api/checklists", {
      method: "PUT",
      headers: {
        origin: "https://eventhost-opal.vercel.app",
        "x-forwarded-host": "eventhost-opal.vercel.app",
        "x-forwarded-proto": "https",
      },
    });

    expect(isSameOriginOperationalRequest(request)).toBe(true);
  });
});
