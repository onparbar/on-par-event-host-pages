import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "../../proxy";

vi.mock("server-only", () => ({}));

describe("operational asset access", () => {
  it.each([
    "/floor-plans/customer-event.png",
    "/entertainment-schedules/customer-event.png",
    "/itinerary-pdfs/customer-event.pdf",
    "/_next/image?url=%2Ffloor-plans%2Fcustomer-event.png&w=1200&q=75",
  ])("preserves legacy asset access while staff login is not enabled: %s", async (path) => {
    const response = await proxy(new NextRequest(`https://eventhost.example${path}`));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("runs the proxy for protected pages, operational assets, and APIs", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|brand/|favicon.ico|robots.txt).*)"]);
  });

  it("never serves the build-time fallback event JSON directly", async () => {
    const response = await proxy(
      new NextRequest("https://eventhost.example/data/event-plan-data.json"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
