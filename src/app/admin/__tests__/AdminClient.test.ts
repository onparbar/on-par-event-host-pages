import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AdminContractEvidence,
  AdminOperationsPayload,
} from "@/lib/admin-operations";
import {
  AdminOperationsReview,
  completedChecklistEventName,
  ContractEvidenceDrawer,
} from "../AdminClient";

const operations: AdminOperationsPayload = {
  generatedAt: "2026-08-04T14:00:00Z",
  windowStart: "2026-08-04",
  windowEnd: "2026-08-11",
  warnings: [],
  completeness: [
    {
      eventId: 123,
      eventName: "Example Event",
      date: "2026-08-06",
      time: "1:00 PM - 3:00 PM",
      color: "#297025",
      issueCount: 1,
      checks: [
        {
          key: "end-time",
          label: "End time",
          status: "missing",
          detail: "No valid event end time is available.",
        },
      ],
    },
  ],
  conflicts: [
    {
      id: "conflict-1",
      date: "2026-08-06",
      kind: "combined",
      resourceId: "vip-1",
      resourceName: "VIP 1",
      eventIds: ["123", "456"],
      eventNames: ["Example Event", "Second Event"],
      eventColors: ["#297025", "#526D52"],
      startAt: "2026-08-06T14:00:00-04:00",
      endAt: "2026-08-06T15:00:00-04:00",
      blocking: true,
    },
  ],
};

describe("admin event readiness UI", () => {
  it("uses the saved event name for completed checklists", () => {
    expect(
      completedChecklistEventName(
        { eventId: 7002, eventName: "Correct Event Name" },
        "Wrong Static Name",
      ),
    ).toBe("Correct Event Name");
  });

  it("renders completeness, source access, and combined conflicts", () => {
    const html = renderToStaticMarkup(
      createElement(AdminOperationsReview, {
        onViewSource: () => {},
        operations,
      }),
    );

    expect(html).toContain("Upcoming event readiness");
    expect(html).toContain("View Source");
    expect(html).toContain("End time");
    expect(html).toContain("Missing");
    expect(html).toContain("Entertainment &amp; floor-plan conflicts");
    expect(html).toContain("VIP 1");
    expect(html).toContain("Blocking overlap");
  });

  it("renders source evidence next to the imported value", () => {
    const evidence: AdminContractEvidence = {
      eventId: 123,
      eventName: "Example Event",
      eventDate: "2026-08-06",
      sourceEventId: "123",
      sourceBookingId: "booking-1",
      sourceUpdatedAt: "2026-08-03T14:00:00Z",
      rows: [
        {
          key: "bowling",
          field: "Bowling lanes",
          importedValue: "4",
          sourceKind: "Contract line item",
          sourceText: "Four lanes for two hours",
          sourceReference: "line-10",
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(ContractEvidenceDrawer, {
        evidence,
        onClose: () => {},
        state: "ready",
      }),
    );

    expect(html).toContain("Event Host field");
    expect(html).toContain("Imported value");
    expect(html).toContain("Contract source");
    expect(html).toContain("Four lanes for two hours");
  });
});
