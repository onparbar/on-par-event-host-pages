import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { getSupabaseSecret } from "./kitchen/storage";

export const ADMIN_COOKIE_NAME = "event-host-admin-session";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function getAdminPin() {
  const value = process.env.EVENT_HOST_ADMIN_PIN?.trim();
  if (/^\d{4}$/.test(value ?? "")) {
    return value!;
  }

  return process.env.NODE_ENV === "production" ? null : "4464";
}

export function getAdminSessionSecret() {
  const explicit = process.env.EVENT_HOST_SESSION_SECRET?.trim();
  if (explicit && explicit.length >= 32) {
    return explicit;
  }

  const existingServerSecret =
    getSupabaseSecret() ||
    process.env.TRIPLESEAT_CLIENT_SECRET?.trim() ||
    process.env.CLIENT_SECRET?.trim();
  if (existingServerSecret) {
    return existingServerSecret;
  }

  return process.env.NODE_ENV === "production"
    ? null
    : "local-development-session-secret";
}

export function createAdminSessionValue() {
  const pin = getAdminPin();
  const sessionSecret = getAdminSessionSecret();
  return pin && sessionSecret
    ? createHmac("sha256", sessionSecret)
        .update(`on-par-admin:${pin}`)
        .digest("hex")
    : null;
}

export function isValidAdminPin(value: string) {
  const pin = getAdminPin();
  return pin !== null && safeEqual(value, pin);
}

export function hasAdminSession(cookieStore: Pick<ReadonlyRequestCookies, "get">) {
  const sessionValue = createAdminSessionValue();
  const cookieValue = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return (
    sessionValue !== null &&
    typeof cookieValue === "string" &&
    safeEqual(cookieValue, sessionValue)
  );
}
