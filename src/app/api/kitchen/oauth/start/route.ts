import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  buildTripleseatAuthorizationUrl,
  createTripleseatOAuthState,
  TRIPLESEAT_OAUTH_STATE_COOKIE,
} from "@/lib/kitchen/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secureResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return secureResponse(
      NextResponse.json(
        { error: "Admin session required." },
        { status: 401 },
      ),
    );
  }

  try {
    const state = createTripleseatOAuthState();
    const response = NextResponse.redirect(
      buildTripleseatAuthorizationUrl(state),
    );
    response.cookies.set({
      name: TRIPLESEAT_OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return secureResponse(response);
  } catch {
    return secureResponse(
      NextResponse.json(
        { error: "Tripleseat OAuth is not configured." },
        { status: 503 },
      ),
    );
  }
}
