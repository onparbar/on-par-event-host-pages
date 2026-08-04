import { describe, expect, it } from "vitest";
import {
  buildTripleseatAuthorizationUrl,
  exchangeTripleseatAuthorizationCode,
  getTripleseatOAuthRedirectUri,
  isValidTripleseatOAuthState,
} from "../oauth";

const env = {
  NODE_ENV: "production",
  TRIPLESEAT_CLIENT_ID: "test-client-id",
  TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
  TRIPLESEAT_REDIRECT_URI:
    "https://eventhost-kitchen-preview.vercel.app/api/kitchen/oauth/callback",
  TRIPLESEAT_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
} as const;

describe("Tripleseat OAuth callback helpers", () => {
  it("builds a read-only authorization request for the deployment callback", () => {
    const url = buildTripleseatAuthorizationUrl(
      "state-value",
      env,
    );

    expect(url.origin + url.pathname).toBe(
      "https://login.tripleseat.com/oauth2/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "test-client-id",
      redirect_uri:
        "https://eventhost-kitchen-preview.vercel.app/api/kitchen/oauth/callback",
      response_type: "code",
      scope: "read",
      state: "state-value",
    });
  });

  it("validates the callback state without accepting missing or different values", () => {
    expect(isValidTripleseatOAuthState("same-state", "same-state")).toBe(true);
    expect(isValidTripleseatOAuthState("same-state", "other-state")).toBe(
      false,
    );
    expect(isValidTripleseatOAuthState(undefined, "same-state")).toBe(false);
    expect(isValidTripleseatOAuthState("same-state", null)).toBe(false);
  });

  it("exchanges the authorization code without exposing credentials in the URL", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 7200,
      });
    };

    const tokens = await exchangeTripleseatAuthorizationCode(
      "authorization-code",
      {
        env,
        fetchImpl,
        now: () => 1_000,
      },
    );

    expect(tokens).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: 7_201_000,
    });
    expect(requestedUrl).toBe("https://api.tripleseat.com/oauth2/token");
    expect(requestedInit?.method).toBe("POST");
    expect(String(requestedInit?.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(String(requestedInit?.body)).toContain(
      "client_secret=test-client-secret",
    );
    expect(requestedUrl).not.toContain("test-client-secret");
  });

  it("uses the exact configured callback URL", () => {
    expect(getTripleseatOAuthRedirectUri(env)).toBe(
      "https://eventhost-kitchen-preview.vercel.app/api/kitchen/oauth/callback",
    );
  });

  it("rejects callback URLs with a different path or query string", () => {
    expect(() =>
      getTripleseatOAuthRedirectUri({
        ...env,
        TRIPLESEAT_REDIRECT_URI:
          "https://eventhost-kitchen-preview.vercel.app/other",
      }),
    ).toThrow();
    expect(() =>
      getTripleseatOAuthRedirectUri({
        ...env,
        TRIPLESEAT_REDIRECT_URI:
          "https://eventhost-kitchen-preview.vercel.app/api/kitchen/oauth/callback?next=/",
      }),
    ).toThrow();
  });

  it("rejects a token response that includes write access", async () => {
    await expect(
      exchangeTripleseatAuthorizationCode("authorization-code", {
        env,
        fetchImpl: async () =>
          Response.json({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 7200,
            scope: "read write",
          }),
      }),
    ).rejects.toThrow("token response was incomplete");
  });
});
