import { randomBytes, timingSafeEqual } from "node:crypto";
import { encryptTripleseatTokenState } from "./tripleseat";
import {
  createSupabaseKitchenStorage,
  type KitchenStorage,
} from "./storage";

const AUTHORIZE_URL = "https://login.tripleseat.com/oauth2/authorize";
const TOKEN_URL = "https://api.tripleseat.com/oauth2/token";

export const TRIPLESEAT_OAUTH_STATE_COOKIE =
  "__Host-ope-ts-oauth-state";

type OAuthEnvironment = {
  NODE_ENV?: NodeJS.ProcessEnv["NODE_ENV"];
  TRIPLESEAT_CLIENT_ID?: string;
  TRIPLESEAT_CLIENT_SECRET?: string;
  TRIPLESEAT_REDIRECT_URI?: string;
  TRIPLESEAT_TOKEN_ENCRYPTION_KEY?: string;
};

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
};

function requireEnvironmentValue(
  env: OAuthEnvironment,
  name:
    | "TRIPLESEAT_CLIENT_ID"
    | "TRIPLESEAT_CLIENT_SECRET"
    | "TRIPLESEAT_REDIRECT_URI"
    | "TRIPLESEAT_TOKEN_ENCRYPTION_KEY",
) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function getTripleseatOAuthRedirectUri(
  env: OAuthEnvironment = process.env,
) {
  const configured = requireEnvironmentValue(
    env,
    "TRIPLESEAT_REDIRECT_URI",
  );
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("TRIPLESEAT_REDIRECT_URI must be a valid URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/kitchen/oauth/callback"
  ) {
    throw new Error(
      "TRIPLESEAT_REDIRECT_URI must be an exact HTTPS kitchen OAuth callback URL.",
    );
  }
  return url.toString();
}

export function createTripleseatOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function isValidTripleseatOAuthState(
  expected: string | undefined,
  actual: string | null,
) {
  if (!expected || !actual) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function buildTripleseatAuthorizationUrl(
  state: string,
  env: OAuthEnvironment = process.env,
) {
  const clientId = requireEnvironmentValue(env, "TRIPLESEAT_CLIENT_ID");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set(
    "redirect_uri",
    getTripleseatOAuthRedirectUri(env),
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeTripleseatAuthorizationCode(
  code: string,
  options: {
    env?: OAuthEnvironment;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<TokenResponse> {
  const env = options.env ?? process.env;
  const response = await (options.fetchImpl ?? fetch)(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: requireEnvironmentValue(env, "TRIPLESEAT_CLIENT_ID"),
      client_secret: requireEnvironmentValue(
        env,
        "TRIPLESEAT_CLIENT_SECRET",
      ),
      redirect_uri: getTripleseatOAuthRedirectUri(env),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Tripleseat OAuth token exchange failed (${response.status}).`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken =
    typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  const tokenType =
    typeof payload.token_type === "string" ? payload.token_type : "Bearer";
  const scope = typeof payload.scope === "string" ? payload.scope : "";
  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : null;
  if (
    !accessToken ||
    !refreshToken ||
    expiresIn === null ||
    tokenType.toLowerCase() !== "bearer" ||
    /(^|\s)write(\s|$)/i.test(scope)
  ) {
    throw new Error("Tripleseat OAuth token response was incomplete.");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: (options.now ?? Date.now)() + expiresIn * 1000,
  };
}

export async function persistTripleseatOAuthTokens(
  tokens: TokenResponse,
  options: {
    env?: OAuthEnvironment;
    storage?: KitchenStorage;
  } = {},
) {
  const env = options.env ?? process.env;
  const encryptedTokens = encryptTripleseatTokenState(
    tokens,
    requireEnvironmentValue(env, "TRIPLESEAT_TOKEN_ENCRYPTION_KEY"),
  );
  await (
    options.storage ?? createSupabaseKitchenStorage()
  ).saveEncryptedTokenState({
    encryptedTokens,
    expiresAt:
      tokens.expiresAt === null
        ? null
        : new Date(tokens.expiresAt).toISOString(),
  });
}
