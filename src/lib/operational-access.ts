import { NextResponse } from "next/server";

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? "";
}

export function isSameOriginOperationalRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return process.env.NODE_ENV !== "production";
  }

  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const forwardedHost = firstForwardedValue(
      request.headers.get("x-forwarded-host"),
    );
    const forwardedProtocol = firstForwardedValue(
      request.headers.get("x-forwarded-proto"),
    );
    const expectedHost = forwardedHost || requestUrl.host;
    const expectedProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;

    return (
      originUrl.host === expectedHost &&
      originUrl.protocol === expectedProtocol
    );
  } catch {
    return false;
  }
}

export function operationalAccessDenied() {
  return NextResponse.json(
    { error: "This operational change must come from Event Host." },
    { status: 403 },
  );
}
