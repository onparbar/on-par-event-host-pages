const STAFF_AUTH_REHEARSAL_POSTS = new Set([
  "/api/staff-auth/start",
  "/api/staff-auth/exchange",
  "/api/staff-auth/logout",
  "/api/staff-auth/revoke",
]);

/** Per-deployment review protection; never changes Production behavior. */
export function isPreviewReviewOnly(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.VERCEL_ENV === "preview" && env.EVENT_HOST_REVIEW_ONLY === "true";
}

export function isPreviewStaffAuthRehearsal(env: Readonly<Record<string, string | undefined>> = process.env) {
  return isPreviewReviewOnly(env) && env.EVENT_HOST_STAFF_LOGIN_REQUIRED === "true" &&
    env.EVENT_HOST_STAFF_AUTH_REHEARSAL === "true";
}

export function previewReviewBlocksRequest(method: string, pathname: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!isPreviewReviewOnly(env)) return false;
  const verb = method.toUpperCase();
  // Rehearse only the protected session lifecycle; each endpoint still checks its own authorization.
  if (verb === "POST" && STAFF_AUTH_REHEARSAL_POSTS.has(pathname) && isPreviewStaffAuthRehearsal(env)) return false;
  return !["GET", "HEAD", "OPTIONS"].includes(verb) ||
    pathname === "/api/gotab/reconcile" || pathname === "/api/event-plans/sync" || pathname === "/api/event-plans/pre-event-refresh" || pathname === "/api/checklists/auto-submit" || pathname === "/api/staffing/sync" ||
    pathname.startsWith("/api/kitchen/oauth/");
}
