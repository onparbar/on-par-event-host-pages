import { getGoTabConfigurationStatus } from "@/lib/gotab/config";
import { getSupabaseSecret } from "@/lib/kitchen/storage";

const EVENT_HOST_DATABASE_HOST = "tmnstuthbllnoqgepotn.supabase.co";

function databaseTargetMatches(env: NodeJS.ProcessEnv) {
  const configured = env.SUPABASE_URL?.trim();
  if (!configured) return true;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" && url.host === EVENT_HOST_DATABASE_HOST;
  } catch {
    return null;
  }
}

function tripleseatMode(env: NodeJS.ProcessEnv) {
  const mock = /^(1|true|yes)$/i.test(env.TRIPLESEAT_MOCK?.trim() || env.TRIPLESEAT_MOCK_MODE?.trim() || "");
  const client = env.TRIPLESEAT_CLIENT_ID?.trim() || env.CLIENT_ID?.trim();
  const secret = env.TRIPLESEAT_CLIENT_SECRET?.trim() || env.CLIENT_SECRET?.trim();
  const tokenPersistence = env.TRIPLESEAT_REFRESH_TOKEN?.trim() || env.TRIPLESEAT_TOKEN_ENCRYPTION_KEY?.trim();
  // The existing adapter falls back to mock, not a live connection, when incomplete.
  return !mock && client && secret && tokenPersistence ? "live" : "mock";
}

/** Allowlisted runtime configuration only. No credentials, identities, or I/O. */
export function releaseStatus(env: NodeJS.ProcessEnv = process.env) {
  const gotab = getGoTabConfigurationStatus(env);
  const mode = tripleseatMode(env);
  const releaseSha = env.EVENT_HOST_RELEASE_SHA?.trim() ?? "";
  return {
    deploymentEnvironment: ["production", "preview", "development"].includes(env.VERCEL_ENV ?? "") ? env.VERCEL_ENV : "unknown",
    releaseSha: /^[a-f0-9]{40}$/i.test(releaseSha) ? releaseSha.toLowerCase() : null,
    database: { targetMatchesEventHost: databaseTargetMatches(env), credentialsConfigured: Boolean(getSupabaseSecret(env)) },
    tripleseat: { kitchenMode: mode, entertainmentMode: mode },
    gotab: {
      configured: gotab.configured,
      mode: !gotab.configured ? "unconfigured" : !gotab.enabled ? "disabled" : gotab.dryRun ? "dry-run" : "live",
      dispatchAllowed: gotab.dispatchAllowed,
    },
  };
}
