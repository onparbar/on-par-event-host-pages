import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { getSupabaseSecret } from "./kitchen/storage";

export const ADMIN_COOKIE_NAME = "event-host-admin-session";
export const STRONG_ADMIN_SESSION_SECONDS = 2 * 60 * 60;

/** Standalone staffing never enables staff sign-in. */
export function requiresStrongAdminSession() {
  return process.env.EVENT_HOST_STAFFING_ADMIN_ENABLED === "true";
}

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
  if (requiresStrongAdminSession()) return null;

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

export function getAdminPassphrase() {
  const value = process.env.EVENT_HOST_STAFFING_ADMIN_PASSPHRASE;
  return value && value.length >= 16 && value.length <= 256 ? value : null;
}

function signTimedAdminSession(payload: string, secret: string, passphrase: string) {
  return createHmac("sha256", secret).update(`on-par-staffing-admin-v1:${passphrase}:${payload}`).digest("hex");
}

export function createAdminSessionValue(now = Date.now()) {
  const sessionSecret = getAdminSessionSecret();
  if (requiresStrongAdminSession()) {
    const passphrase = getAdminPassphrase();
    if (!passphrase || !sessionSecret) return null;
    const payload = `${Math.floor(now / 1000) + STRONG_ADMIN_SESSION_SECONDS}.${randomBytes(16).toString("hex")}`;
    return `${payload}.${signTimedAdminSession(payload, sessionSecret, passphrase)}`;
  }
  const pin = getAdminPin();
  return pin && sessionSecret
    ? createHmac("sha256", sessionSecret)
        .update(`on-par-admin:${pin}`)
        .digest("hex")
    : null;
}

export function isValidAdminPin(value: string) {
  if (requiresStrongAdminSession()) return false;
  const pin = getAdminPin();
  return pin !== null && safeEqual(value, pin);
}

export function isValidAdminPassphrase(value: string) {
  const passphrase = getAdminPassphrase();
  return passphrase !== null && safeEqual(value, passphrase);
}

export function hasAdminSession(cookieStore: Pick<ReadonlyRequestCookies, "get">, now = Date.now()) {
  const cookieValue = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (requiresStrongAdminSession()) {
    const passphrase = getAdminPassphrase();
    const secret = getAdminSessionSecret();
    if (!passphrase || !secret || !cookieValue || !/^\d{1,12}\.[0-9a-f]{32}\.[0-9a-f]{64}$/.test(cookieValue)) return false;
    const [expiry, nonce, signature] = cookieValue.split(".");
    const clock = Math.floor(now / 1000);
    return Number(expiry) > clock && Number(expiry) <= clock + STRONG_ADMIN_SESSION_SECONDS &&
      safeEqual(signature, signTimedAdminSession(`${expiry}.${nonce}`, secret, passphrase));
  }
  const sessionValue = createAdminSessionValue();
  return (
    sessionValue !== null &&
    typeof cookieValue === "string" &&
    safeEqual(cookieValue, sessionValue)
  );
}
