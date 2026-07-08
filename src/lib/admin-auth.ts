import { createHash } from "node:crypto";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

export const ADMIN_COOKIE_NAME = "event-host-admin-session";

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getAdminPin() {
  const value = process.env.EVENT_HOST_ADMIN_PIN?.trim();
  return /^\d{4}$/.test(value ?? "") ? value! : "4464";
}

export function createAdminSessionValue() {
  return hashValue(`on-par-admin:${getAdminPin()}`);
}

export function isValidAdminPin(value: string) {
  return value === getAdminPin();
}

export function hasAdminSession(cookieStore: Pick<ReadonlyRequestCookies, "get">) {
  return cookieStore.get(ADMIN_COOKIE_NAME)?.value === createAdminSessionValue();
}
