import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, createAdminSessionValue, isValidAdminPin } from "@/lib/admin-auth";

type AccessRequest = {
  pin?: string;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
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

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: createAdminSessionValue(),
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
