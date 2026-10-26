/** Per-deployment review protection; never changes Production behavior. */
export function isPreviewReviewOnly(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.VERCEL_ENV === "preview" && env.EVENT_HOST_REVIEW_ONLY === "true";
}

export function previewReviewBlocksRequest(method: string, pathname: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!isPreviewReviewOnly(env)) return false;
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) ||
    pathname === "/api/gotab/reconcile" || pathname === "/api/event-plans/sync" || pathname === "/api/checklists/auto-submit" ||
    pathname.startsWith("/api/kitchen/oauth/");
}
