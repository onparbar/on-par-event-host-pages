import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { entertainmentRuntimeConfiguration } from "@/lib/entertainment/runtime-configuration";
import { createTripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { SupabaseEntertainmentStorage } from "@/lib/entertainment/storage";

const ref = "abcdefghijklmnopqrst";
const commit = "a".repeat(40);
const liveEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  SUPABASE_URL: `https://${ref}.supabase.co/`,
  SUPABASE_SECRET_KEY: "private-database-secret",
  TRIPLESEAT_CLIENT_ID: "private-client",
  TRIPLESEAT_CLIENT_SECRET: "private-client-secret",
  TRIPLESEAT_TOKEN_ENCRYPTION_KEY: "private-encryption-key",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_SHA: commit,
};
const request = (token = "test-service-secret") => new Request(
  "https://example.test/api/entertainment-schedule/runtime",
  { headers: token ? { authorization: `Bearer ${token}` } : {} },
);

describe("service-authenticated runtime configuration", () => {
  beforeEach(() => {
    vi.stubEnv("ENTERTAINMENT_SCHEDULE_API_TOKEN", "test-service-secret");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("authenticates before returning any configuration", () => {
    for (const token of ["", "wrong", "test-service-secret-wrong"]) {
      const response = GET(request(token));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }
    vi.stubEnv("ENTERTAINMENT_SCHEDULE_API_TOKEN", "");
    expect(GET(request()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns only allowlisted configuration without a source call or receipt write", async () => {
    for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value!);
    vi.stubEnv("TRIPLESEAT_MOCK", "false");
    vi.stubEnv("TRIPLESEAT_MOCK_MODE", "");
    const response = GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({
      kind: "runtime-configuration", scope: "configuration-only",
      supabase: { projectRef: ref, source: "environment", credentialConfigured: true },
      tripleseat: { sourceMode: "live" }, deployment: { environment: "preview", commit },
      effects: { databaseRead: false, databaseWrite: false, upstreamRequest: false },
    });
    expect(JSON.stringify(payload)).not.toMatch(/private-|test-service-secret|SUPABASE_SECRET/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares the exact target resolution used by the interval storage client", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(new URL(String(url)).hostname).toBe(`${ref}.supabase.co`);
      return Response.json([], { headers: { "content-range": "*/0" } });
    });
    const storage = new SupabaseEntertainmentStorage({ env: liveEnv, fetchImpl });
    await storage.getDay("2026-10-20");
    expect(fetchImpl).toHaveBeenCalled();
    expect(entertainmentRuntimeConfiguration(liveEnv).supabase.projectRef).toBe(ref);
  });

  it("reports fallback and missing credentials honestly", () => {
    const report = entertainmentRuntimeConfiguration({ NODE_ENV: "test" });
    expect(report.supabase).toEqual({
      projectRef: "tmnstuthbllnoqgepotn", source: "default", credentialConfigured: false,
    });
    expect(report.tripleseat.sourceMode).toBe("mock");
    expect(report.deployment).toEqual({ environment: null, commit: null });
  });

  it.each([
    { ...liveEnv, TRIPLESEAT_MOCK: "yes" },
    { ...liveEnv, TRIPLESEAT_MOCK_MODE: "1" },
    { ...liveEnv, TRIPLESEAT_MOCK: "false", TRIPLESEAT_MOCK_MODE: "true" },
    { ...liveEnv, TRIPLESEAT_CLIENT_SECRET: "" },
    { ...liveEnv, TRIPLESEAT_TOKEN_ENCRYPTION_KEY: "" },
    liveEnv,
  ])("uses the same live/mock selection as the actual adapter", (env) => {
    expect(entertainmentRuntimeConfiguration(env).tripleseat.sourceMode)
      .toBe(createTripleseatAdapter({ env }).sourceMode);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-url-private", "https://private:secret@abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co/?private=secret",
    "https://abcdefghijklmnopqrst.supabase.co/private",
    "http://abcdefghijklmnopqrst.supabase.co", "https://private.example",
  ])("does not echo malformed or custom database URLs: %s", (url) => {
    const report = entertainmentRuntimeConfiguration({ ...liveEnv, SUPABASE_URL: url });
    expect(report.supabase.projectRef).toBeNull();
    expect(JSON.stringify(report)).not.toContain("private");
    expect(fetch).not.toHaveBeenCalled();
  });
});
