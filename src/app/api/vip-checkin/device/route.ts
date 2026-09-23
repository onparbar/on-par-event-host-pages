import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, hasAdminSession } from "@/lib/admin-auth";
import { isSameOriginOperationalRequest, operationalAccessDenied } from "@/lib/operational-access";
import { createVipDeviceSession, VIP_DEVICE_COOKIE_NAME, VIP_DEVICE_MAX_AGE } from "@/lib/vip-checkin/device-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) return operationalAccessDenied();
  if (!hasAdminSession(await cookies())) {
    return NextResponse.json({ error: "An admin must authorize this tablet." }, { status: 403 });
  }
  const session = createVipDeviceSession();
  if (!session) {
    return NextResponse.json({ error: "Staff tablet access is not configured." }, { status: 503 });
  }
  const response = NextResponse.json({ authorized: true });
  response.cookies.set({
    name: VIP_DEVICE_COOKIE_NAME,
    value: session,
    httpOnly: true,
    maxAge: VIP_DEVICE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.cookies.set({ name: ADMIN_COOKIE_NAME, value: "", maxAge: 0, path: "/" });
  return response;
}
