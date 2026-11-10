import "server-only";
import { getSupabaseSecret } from "@/lib/kitchen/storage";
import { isPreviewStaffAuthRehearsal } from "@/lib/operations/preview-review";
import { isEmployeeId, isStaffSessionProof, SESSION_SECONDS, tokenHash, type Handoff } from "./protocol";

export async function staffPrivateRequest(path: string, init: RequestInit = {}) {
  const env = process.env;
  const rehearsal = isPreviewStaffAuthRehearsal(env);
  if (env.VERCEL_ENV === "preview" && !rehearsal) throw new Error("Staff data storage is disabled outside the protected preview rehearsal.");
  const secret = rehearsal ? env.EVENT_HOST_STAFF_AUTH_STAGING_SUPABASE_KEY?.trim() : getSupabaseSecret(env);
  const base = (rehearsal ? env.EVENT_HOST_STAFF_AUTH_STAGING_SUPABASE_URL : env.SUPABASE_URL)?.trim().replace(/\/+$/, "");
  if (rehearsal && (!base || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(base) || base === "https://tmnstuthbllnoqgepotn.supabase.co")) {
    throw new Error("A separate hosted Supabase project or branch is required for the staff rehearsal.");
  }
  if (!secret || !base) throw new Error("Staff data storage is not configured.");
  if (rehearsal && getSupabaseSecret(env)) throw new Error("Remove operational Supabase credentials from the staff rehearsal.");
  const headers = new Headers(init.headers);
  headers.set("apikey", secret);
  headers.set("content-type", "application/json");
  if (/^eyJ[^.]*\.[^.]+\.[^.]+$/.test(secret)) headers.set("authorization", `Bearer ${secret}`);
  return fetch(`${base}/rest/v1/${path}`, { ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
}

export async function createStaffSession(token: string, handoff: Handoff, now = Date.now()) {
  const response = await staffPrivateRequest("rpc/create_event_host_staff_session", {
    method: "POST",
    // Consume the browser challenge, even if the issuer signs a second assertion for the same state.
    body: JSON.stringify({ p_token_hash: tokenHash(token), p_handoff_hash: tokenHash(handoff.state), p_employee_id: handoff.sub,
      p_staff_session: handoff.staffSession, p_expires_at: new Date(now + SESSION_SECONDS * 1000).toISOString() }),
  });
  if (!response.ok) throw new Error("Staff session storage is unavailable.");
  return (await response.json()) === true;
}

export async function findStaffSession(token: string, now = Date.now()) {
  const response = await staffPrivateRequest("rpc/find_event_host_staff_session", {
    method: "POST", body: JSON.stringify({ p_token_hash: tokenHash(token) }),
  });
  if (!response.ok) throw new Error("Staff session storage is unavailable.");
  const [row] = await response.json() as { employee_id?: string; staff_session?: string; expires_at?: string }[];
  return row && isEmployeeId(row.employee_id) && isStaffSessionProof(row.staff_session) && Date.parse(row.expires_at ?? "") > now
    ? { employeeId: row.employee_id, staffSession: row.staff_session } : null;
}

/** Insert a durable tombstone even when a handoff for this login has not been exchanged yet. */
export async function revokeStaffSessionGroup(staffSession: string) {
  const response = await staffPrivateRequest("event_host_staff_session_revocations?on_conflict=staff_session_hash", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ staff_session_hash: tokenHash(staffSession) }),
  });
  if (!response.ok) throw new Error("Staff login revocation could not be confirmed.");
}

export async function revokeStaffSession(token: string) {
  const response = await staffPrivateRequest(`event_host_staff_sessions?token_hash=eq.${tokenHash(token)}&revoked_at=is.null`, {
    method: "PATCH", body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("Staff session revocation could not be confirmed.");
}

export async function recordAuthAttempt(key: string) {
  const response = await staffPrivateRequest("rpc/record_event_host_auth_attempt", {
    method: "POST", body: JSON.stringify({ p_attempt_key: key }),
  });
  if (!response.ok) throw new Error("Login attempt protection is unavailable.");
  return (await response.json()) === true;
}
