import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAdminSessionSecret } from "@/lib/admin-auth";

export const VIP_DEVICE_COOKIE_NAME = "event-host-vip-device";
export const VIP_DEVICE_MAX_AGE = 60 * 60 * 24 * 30;

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(`vip-device:${value}`).digest("base64url");
}

export function createVipDeviceSession(now = Date.now()) {
  const secret = getAdminSessionSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({
    expiresAt: now + VIP_DEVICE_MAX_AGE * 1000,
    nonce: randomBytes(16).toString("hex"),
  })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function hasVipDeviceSession(
  cookieStore: { get(name: string): { value: string } | undefined },
  now = Date.now(),
) {
  const token = cookieStore.get(VIP_DEVICE_COOKIE_NAME)?.value;
  const secret = getAdminSessionSecret();
  if (!token || !secret) return false;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return false;
  const expected = Buffer.from(signature(payload, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      expiresAt?: unknown; nonce?: unknown;
    };
    return typeof decoded.expiresAt === "number" &&
      decoded.expiresAt > now &&
      decoded.expiresAt <= now + VIP_DEVICE_MAX_AGE * 1000 &&
      typeof decoded.nonce === "string" && /^[a-f0-9]{32}$/.test(decoded.nonce);
  } catch {
    return false;
  }
}
