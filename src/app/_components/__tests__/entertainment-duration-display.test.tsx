import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildWorkspacePayload } from "@/lib/operations/workspace";
import { workspaceEvent, workspaceReservation } from "@/lib/operations/__tests__/workspace-fixtures";

const context = vi.hoisted(() => ({ workspace: null as unknown }));
vi.mock("react", async (importOriginal) => ({ ...await importOriginal<typeof import("react")>(), useContext: () => context.workspace }));
vi.mock("next/navigation", () => ({ usePathname: () => "/itineraries" }));
vi.mock("../EventContext", () => ({ useEventContext: () => ({ staffName: "Redacted employee" }) }));

import { EventWorkspaceReminders, EventWorkspaceTimeline } from "../EventWorkspace";

describe("staff entertainment duration display", () => {
  it("keeps reminder and timeline hours synchronized with the exact saved interval", () => {
    const payload = buildWorkspacePayload({ event: workspaceEvent, record: null, reservations: [workspaceReservation({ endAt: "2026-10-24T00:00:00.000Z" })], scheduleAvailable: true });
    context.workspace = { payload, now: new Date("2026-10-23T22:26:00Z"), state: "saved", error: "", refresh: vi.fn(), act: vi.fn() };
    const reminder = renderToStaticMarkup(createElement(EventWorkspaceReminders));
    const timeline = renderToStaticMarkup(createElement(EventWorkspaceTimeline));
    expect(reminder).toContain("Duration: 1.5 hours");
    expect(reminder).toContain("6:30 PM");
    expect(timeline).toContain("Duration: 1.5 hours");
    expect(timeline).toContain("6:30 PM");
    expect(timeline).toContain("Mini Golf: 20");
    expect(timeline).toContain("Untimed contract activity.");
    expect(reminder).not.toContain("90 minutes");
    expect(timeline).not.toContain("90 minutes");
  });
});
