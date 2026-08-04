const LEGACY_EVENT_HOST_ORIGIN = "https://eventhost-legacy-jul29.vercel.app";
const LEGACY_NEXT_PREFIX = "/legacy-next-assets/";

const TEXT_CONTENT_TYPES = [
  "text/",
  "application/javascript",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/react-server-components",
];

function isTextResponse(contentType: string) {
  return TEXT_CONTENT_TYPES.some((candidate) => contentType.includes(candidate));
}

function rewriteLegacyText(body: string) {
  return body
    .replaceAll(`${LEGACY_EVENT_HOST_ORIGIN}/_next/`, LEGACY_NEXT_PREFIX)
    .replaceAll("/_next/", LEGACY_NEXT_PREFIX)
    .replaceAll(LEGACY_EVENT_HOST_ORIGIN, "");
}

function responseHeaders(upstream: Response, requestOrigin: string) {
  const headers = new Headers(upstream.headers);

  for (const name of [
    "connection",
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "x-vercel-cache",
    "x-vercel-id",
  ]) {
    headers.delete(name);
  }

  const location = headers.get("location");
  if (location) {
    headers.set(
      "location",
      rewriteLegacyText(location).replace(
        /^https?:\/\/[^/]+/,
        requestOrigin,
      ),
    );
  }

  return headers;
}

export async function proxyLegacyRequest(
  request: Request,
  targetPath?: string,
) {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!bypassSecret) {
    return Response.json(
      { error: "The preserved Event Host route is temporarily unavailable." },
      { status: 503 },
    );
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${targetPath ?? incomingUrl.pathname}${incomingUrl.search}`,
    LEGACY_EVENT_HOST_ORIGIN,
  );
  const headers = new Headers(request.headers);

  for (const name of [
    "accept-encoding",
    "connection",
    "content-length",
    "host",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]) {
    headers.delete(name);
  }

  headers.set("x-vercel-protection-bypass", bypassSecret);
  headers.set("x-event-host-legacy-proxy", "1");

  const requestHasBody = !["GET", "HEAD"].includes(request.method);
  const body = requestHasBody ? await request.arrayBuffer() : undefined;
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const location = upstream.headers.get("location") ?? "";
  if (location.includes("vercel.com/sso-api")) {
    return Response.json(
      { error: "The preserved Event Host route could not be authorized." },
      { status: 502 },
    );
  }

  const outgoingHeaders = responseHeaders(upstream, incomingUrl.origin);
  const contentType = upstream.headers.get("content-type") ?? "";

  if (request.method === "HEAD" || !upstream.body) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outgoingHeaders,
    });
  }

  if (isTextResponse(contentType)) {
    return new Response(rewriteLegacyText(await upstream.text()), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outgoingHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outgoingHeaders,
  });
}
