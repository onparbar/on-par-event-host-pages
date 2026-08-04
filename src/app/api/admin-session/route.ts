import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, createAdminSessionValue, getAdminPin, isValidAdminPin } from "@/lib/admin-auth";

type AccessRequest = {
  pin?: string;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  if (!getAdminPin() || !createAdminSessionValue()) {
    return NextResponse.json(
      { error: "Admin access is not configured for this deployment." },
      { status: 503 },
    );
  }

  let body: AccessRequest;

  try {
    body = (await request.json()) as AccessRequest;
  } catch {
    return badRequest("Invalid admin access payload.");
  }

  if (!/^\d{4}$/.test(body.pin ?? "")) {
    return badRequest("Enter a 4 digit admin PIN.");
  }

  if (!isValidAdminPin(body.pin!)) {
    return NextResponse.json({ error: "Incorrect admin PIN." }, { status: 401 });
  }

  const sessionValue = createAdminSessionValue();
  if (!sessionValue) {
    return NextResponse.json(
      { error: "Admin access is not configured for this deployment." },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: sessionValue,
    httpOnly: true,
    maxAge: 60 * 60 * 12,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/",
  });
  return response;
}
