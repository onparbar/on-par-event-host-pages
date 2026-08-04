import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  exchangeTripleseatAuthorizationCode,
  isValidTripleseatOAuthState,
  persistTripleseatOAuthTokens,
  TRIPLESEAT_OAUTH_STATE_COOKIE,
} from "@/lib/kitchen/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secureResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function clearOAuthState(response: NextResponse) {
  response.cookies.set({
    name: TRIPLESEAT_OAUTH_STATE_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
  });
  return secureResponse(response);
}

function kitchenRedirect(requestUrl: string, status: "connected" | "error") {
  return new URL(`/kitchen?oauth=${status}`, requestUrl);
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

  const url = new URL(request.url);
  const expectedState = cookieStore.get(
    TRIPLESEAT_OAUTH_STATE_COOKIE,
  )?.value;
  if (
    url.searchParams.has("error") ||
    !isValidTripleseatOAuthState(
      expectedState,
      url.searchParams.get("state"),
    )
  ) {
    return clearOAuthState(
      NextResponse.redirect(kitchenRedirect(request.url, "error")),
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return clearOAuthState(
      NextResponse.redirect(kitchenRedirect(request.url, "error")),
    );
  }

  try {
    const tokens = await exchangeTripleseatAuthorizationCode(code);
    await persistTripleseatOAuthTokens(tokens);
    return clearOAuthState(
      NextResponse.redirect(kitchenRedirect(request.url, "connected")),
    );
  } catch {
    return clearOAuthState(
      NextResponse.redirect(kitchenRedirect(request.url, "error")),
    );
  }
}
