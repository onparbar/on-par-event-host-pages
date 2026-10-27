import { describe, expect, it } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipPrepEntertainmentEvents } from "@/lib/vip-prep/client";
import { buildEntertainmentSchedule } from "../domain";
import { findEntertainmentEventByIdentity } from "../identity";

describe("canonical entertainment event selection", () => {
  it("selects full VIP IDs independently despite a legacy numeric hash collision", () => {
    const events = buildEntertainmentSchedule({ sourceEvents: vipPrepEntertainmentEvents([
      { ...vipPrepPayload.reservations[0], id: "test-h4l720-hfbtsa" },
      { ...vipPrepPayload.reservations[0], id: "test-1k212gj-1rfricb" },
    ]), localEvents: [] }).events;
    expect(findEntertainmentEventByIdentity(events, "vip-test-h4l720-hfbtsa")).toBe(events[0]);
    expect(findEntertainmentEventByIdentity(events, "vip-test-1k212gj-1rfricb")).toBe(events[1]);
    expect(findEntertainmentEventByIdentity(events, "527983760")).toBeNull();
    expect(findEntertainmentEventByIdentity(events.slice(0, 1), "527983760")).toBe(events[0]);
  });
});
