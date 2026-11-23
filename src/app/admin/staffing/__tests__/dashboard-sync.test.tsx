import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StaffingDashboard from "../StaffingDashboard";
import type { StaffingState } from "@/lib/staffing/storage";

vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial, vi.fn()] }));

const currentWindow = { startDate: "2026-11-10", endDate: "2026-11-16", shiftStartDate: "2026-11-09" };
const state: StaffingState = { version: 4, events: [], shifts: [], reconciliation: null, keepClearEventIds: [], policy: {}, failure: null, lastAttemptAt: null };
type Props = Parameters<typeof StaffingDashboard>[0];
type ElementProps = { children?: unknown; onClick?: () => void };

function syncButton(node: unknown): ReactElement<ElementProps> | undefined {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) { const found = syncButton(child); if (found) return found; }
    return;
  }
  const element = node as ReactElement<ElementProps>;
  if (element.type === "button" && element.props.children === "Sync published shifts") return element;
  return syncButton(element.props?.children);
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ state, fresh: false }))));
afterEach(() => vi.unstubAllGlobals());

describe("explicit selected-week staffing verification", () => {
  it.each([
    ["2026-11-17", { startDate: "2026-11-17", endDate: "2026-11-23" }, { date: "2026-11-17" }],
    [undefined, currentWindow, {}],
    ["2026-11-09", currentWindow, {}],
  ] as const)("does not sync automatically and submits only the selected eligible date %s", async (requestedDate, window, datePayload) => {
    const props: Props = { rolloutEnabled: true, initialFresh: false, initialEventId: "", initialState: state, requestedDate, window };
    const button = syncButton(StaffingDashboard(props));
    expect(button).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    button!.props.onClick!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/admin/staffing", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sync", ...datePayload, expectedVersion: 4 }),
    });
  });
});
