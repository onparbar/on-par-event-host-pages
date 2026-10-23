import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AdminContractEvidence,
  AdminOperationsPayload,
} from "@/lib/admin-operations";
import type { ChecklistRecord } from "@/lib/checklist-model";
import { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY } from "@/lib/checklist-readiness";
import {
  AdminOperationsReview,
  ChecklistCloseoutWarnings,
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

describe("submitted checklist contract warnings", () => {
  const receipt = {
    employeeName: "Preview Staff",
    completedAt: "2026-10-23T18:14:00.000Z",
    sourceFingerprint: "reviewed-source-snapshot",
    contractWarnings: ["Contract platter quantity is unresolved.", "Entertainment requires source review."],
  };
  const record: Pick<ChecklistRecord, "status" | "tasks" | "taskEvidence"> = {
    status: "submitted",
    tasks: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: true },
    taskEvidence: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: receipt },
  };

  it("retains the original warnings with the confirming staff name and Eastern timestamp", () => {
    const html = renderToStaticMarkup(createElement(ChecklistCloseoutWarnings, { record }));

    expect(html).toContain("Submitted with contract warnings — Needs Review");
    expect(html).toContain("portal-status-badge is-warning");
    expect(html).toContain("Confirmed by Preview Staff");
    expect(html).toContain('dateTime="2026-10-23T18:14:00.000Z"');
    expect(html).toContain("Oct 23, 2:14 PM");
    expect(html).toContain("Eastern");
    expect(html).toContain("Staff confirmation does not resolve these contract warnings.");
    for (const warning of receipt.contractWarnings) expect(html).toContain(warning);
  });

  it("does not invent a warning confirmation for legacy or unsubmitted records", () => {
    const unconfirmedRecords: Array<Pick<ChecklistRecord, "status" | "tasks" | "taskEvidence">> = [
      { status: "submitted" as const, tasks: {} },
      { ...record, status: "draft" as const },
      { ...record, tasks: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: false } },
      { ...record, taskEvidence: {} },
    ];
    for (const unconfirmed of unconfirmedRecords) {
      expect(renderToStaticMarkup(createElement(ChecklistCloseoutWarnings, { record: unconfirmed }))).toBe("");
    }
  });

  it.each([
    null,
    { ...receipt, employeeName: " " },
    { ...receipt, completedAt: "not a date" },
    { ...receipt, completedAt: 12 },
    { ...receipt, sourceFingerprint: undefined },
    { ...receipt, contractWarnings: [] },
    { ...receipt, contractWarnings: [" "] },
    { ...receipt, contractWarnings: ["Original warning", 3] },
    { ...receipt, contractWarnings: "Original warning" },
  ])("does not display malformed confirmation metadata as a confirmed submission: %j", (malformed) => {
    const invalid = {
      ...record,
      taskEvidence: { [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: malformed },
    } as unknown as typeof record;

    expect(renderToStaticMarkup(createElement(ChecklistCloseoutWarnings, { record: invalid }))).toBe("");
  });

  it("renders contract text as text rather than markup", () => {
    const html = renderToStaticMarkup(createElement(ChecklistCloseoutWarnings, {
      record: {
        ...record,
        taskEvidence: {
          [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: { ...receipt, contractWarnings: ["<script>untrusted warning</script>"] },
        },
      },
    }));

    expect(html).toContain("&lt;script&gt;untrusted warning&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});
