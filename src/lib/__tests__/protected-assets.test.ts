import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "../../proxy";

describe("operational asset access", () => {
  it.each([
    "/floor-plans/customer-event.png",
    "/entertainment-schedules/customer-event.png",
    "/itinerary-pdfs/customer-event.pdf",
    "/_next/image?url=%2Ffloor-plans%2Fcustomer-event.png&w=1200&q=75",
  ])("allows anonymous operational asset requests from %s", (path) => {
    const response = proxy(new NextRequest(`https://eventhost.example${path}`));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("only runs the proxy for the private fallback event JSON", () => {
    expect(config.matcher).toEqual(["/data/event-plan-data.json"]);
  });

  it("never serves the build-time fallback event JSON directly", () => {
    const response = proxy(
      new NextRequest("https://eventhost.example/data/event-plan-data.json"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
