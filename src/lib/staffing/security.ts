import "server-only";
import { getSupabaseSecret } from "@/lib/kitchen/storage";

function exactOrigin(value: string | undefined, allowLoopback: boolean) {
  try {
    const url = new URL(value ?? "");
    if (url.hostname.endsWith(".") || url.origin !== value ||
        (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" &&
          (url.hostname === "localhost" || url.hostname === "127.0.0.1")))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function staffingOrigin(env = process.env) {
  return exactOrigin(env.EVENT_HOST_STAFFING_ORIGIN, env.NODE_ENV !== "production");
}

export async function staffingPrivateRequest(path: string, init: RequestInit = {}) {
  const secret = getSupabaseSecret();
  const origin = exactOrigin(process.env.SUPABASE_URL?.trim().replace(/\/+$/, ""), process.env.NODE_ENV !== "production");
  if (!secret || !origin || !/^(?:event_host_standalone_staffing_state(?:\?|$)|rpc\/record_event_host_staffing_admin_attempt$)/.test(path)) {
    throw new Error("Staffing data storage is not configured.");
  }
  const headers = new Headers(init.headers);
  headers.set("apikey", secret);
  headers.set("content-type", "application/json");
  if (/^eyJ[^.]*\.[^.]+\.[^.]+$/.test(secret)) headers.set("authorization", `Bearer ${secret}`);
  else headers.delete("authorization");
  return fetch(`${origin}/rest/v1/${path}`, {
    ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
  });
}

export async function recordStaffingAdminAttempt(key: string) {
  const response = await staffingPrivateRequest("rpc/record_event_host_staffing_admin_attempt", {
    method: "POST", body: JSON.stringify({ p_attempt_key: key }),
  });
  if (!response.ok) throw new Error("Admin sign-in attempt protection is unavailable.");
  const allowed: unknown = await response.json();
  if (typeof allowed !== "boolean") throw new Error("Admin sign-in attempt protection is unavailable.");
  return allowed;
}
