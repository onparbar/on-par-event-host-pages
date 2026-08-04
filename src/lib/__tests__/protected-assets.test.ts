import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createAdminSessionValue, ADMIN_COOKIE_NAME } from "../admin-auth";
import { proxy } from "../../proxy";

const originalPin = process.env.EVENT_HOST_ADMIN_PIN;
const originalSessionSecret = process.env.EVENT_HOST_SESSION_SECRET;

beforeEach(() => {
  process.env.EVENT_HOST_ADMIN_PIN = "2468";
  process.env.EVENT_HOST_SESSION_SECRET =
    "protected-asset-test-session-secret-123456";
});

afterEach(() => {
  if (originalPin === undefined) {
    delete process.env.EVENT_HOST_ADMIN_PIN;
  } else {
    process.env.EVENT_HOST_ADMIN_PIN = originalPin;
  }
  if (originalSessionSecret === undefined) {
    delete process.env.EVENT_HOST_SESSION_SECRET;
  } else {
    process.env.EVENT_HOST_SESSION_SECRET = originalSessionSecret;
  }
});

function authenticatedRequest(path: string) {
  const session = createAdminSessionValue();
  const request = new NextRequest(`https://eventhost.example${path}`);
  request.cookies.set(ADMIN_COOKIE_NAME, session!);
  return request;
}

describe("customer asset protection", () => {
  it.each([
    ["/floor-plans/customer-event.png", "/floor-plans"],
    [
      "/entertainment-schedules/customer-event.png",
      "/entertainment-schedules",
    ],
    ["/itinerary-pdfs/customer-event.pdf", "/itineraries"],
  ])("redirects anonymous asset requests from %s", (path, loginPath) => {
    const response = proxy(new NextRequest(`https://eventhost.example${path}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://eventhost.example${loginPath}`,
    );
  });

  it("allows protected asset requests with a valid Event Host session", () => {
    const response = proxy(
      authenticatedRequest("/itinerary-pdfs/customer-event.pdf"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("also protects customer assets requested through the image optimizer", () => {
    const request = new NextRequest(
      "https://eventhost.example/_next/image?url=%2Ffloor-plans%2Fcustomer-event.png&w=1200&q=75",
    );

    const response = proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://eventhost.example/floor-plans",
    );
  });

  it("never serves the build-time fallback event JSON directly", () => {
    const response = proxy(
      authenticatedRequest("/data/event-plan-data.json"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
