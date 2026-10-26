import { getSupabaseSecret } from "../kitchen/storage";
import { tripleseatSourceMode } from "../kitchen/tripleseat";
import { entertainmentSupabaseProjectRef } from "./configuration";

/** Allowlisted configuration only: never query sources or construct storage clients. */
export function entertainmentRuntimeConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
) {
  const environment = env.VERCEL_ENV;
  const commit = env.VERCEL_GIT_COMMIT_SHA ?? "";
  return {
    version: 1,
    kind: "runtime-configuration",
    scope: "configuration-only",
    checkedAt: now.toISOString(),
    supabase: {
      projectRef: entertainmentSupabaseProjectRef(env),
      source: env.SUPABASE_URL?.trim() ? "environment" : "default",
      credentialConfigured: Boolean(getSupabaseSecret(env)),
    },
    tripleseat: { sourceMode: tripleseatSourceMode(env) },
    deployment: {
      environment: environment === "preview" || environment === "production" || environment === "development"
        ? environment : null,
      commit: /^[a-f0-9]{40}$/.test(commit) ? commit : null,
    },
    effects: { databaseRead: false, databaseWrite: false, upstreamRequest: false },
  };
}
