const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";

/** Shared by the interval storage client and the no-I/O configuration diagnostic. */
export function entertainmentSupabaseBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return (env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

/** Never echo a URL: a malformed/custom value can contain private credentials. */
export function entertainmentSupabaseProjectRef(env: NodeJS.ProcessEnv = process.env) {
  try {
    const url = new URL(entertainmentSupabaseBaseUrl(env));
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash) return null;
    return url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? null;
  } catch {
    return null;
  }
}
