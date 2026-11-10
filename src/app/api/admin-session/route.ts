import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, createAdminSessionValue, getAdminPin, getAdminPassphrase, getAdminSessionSecret, isValidAdminPassphrase, isValidAdminPin, STRONG_ADMIN_SESSION_SECONDS } from "@/lib/admin-auth";
import { eventHostOrigin, staffLoginRequired } from "@/lib/staff-auth/protocol";
import { recordAuthAttempt } from "@/lib/staff-auth/storage";

type AccessRequest = {
  pin?: string;
  passphrase?: string;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  const strong = staffLoginRequired();
  const origin = eventHostOrigin();
  const secret = getAdminSessionSecret();
  if ((strong ? !getAdminPassphrase() || !origin : !getAdminPin()) || !secret) {
    return NextResponse.json(
      { error: "Admin access is not configured for this deployment." },
      { status: 503 },
    );
  }
  if (strong && request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "This sign-in must come from Event Host." }, { status: 403 });
  }

  let body: AccessRequest;

  try {
    body = (await request.json()) as AccessRequest;
  } catch {
    return badRequest("Invalid admin access payload.");
  }

  if (strong) {
    const client = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
    const key = createHmac("sha256", secret).update(`event-host-admin-attempt:${client || "unknown"}`).digest("hex");
    try {
      if (!await recordAuthAttempt(`admin:${key}`)) {
        return NextResponse.json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." }, { status: 429, headers: { "retry-after": "900" } });
      }
    } catch {
      return NextResponse.json({ error: "Admin sign-in is temporarily unavailable." }, { status: 503 });
    }
    if (typeof body?.passphrase !== "string" || body.passphrase.length > 256 || !isValidAdminPassphrase(body.passphrase)) {
      return NextResponse.json({ error: "Incorrect admin passphrase." }, { status: 401 });
    }
  } else if (!/^\d{4}$/.test(body?.pin ?? "")) {
    return badRequest("Enter a 4 digit admin PIN.");
  } else if (!isValidAdminPin(body.pin!)) {
    return NextResponse.json({ error: "Incorrect admin PIN." }, { status: 401 });
  }

  const sessionValue = createAdminSessionValue();
  if (!sessionValue) {
    return NextResponse.json(
      { error: "Admin access is not configured for this deployment." },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: sessionValue,
    httpOnly: true,
    maxAge: strong ? STRONG_ADMIN_SESSION_SECONDS : 60 * 60 * 12,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function DELETE(request: Request) {
  const origin = eventHostOrigin();
  if (staffLoginRequired() && (!origin || request.headers.get("origin") !== origin)) {
    return NextResponse.json({ error: "This sign-out must come from Event Host." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/",
  });
  return response;
}
