import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AdminContractEvidence,
  AdminOperationsPayload,
} from "@/lib/admin-operations";
import { checklistSections, type ChecklistRecord } from "@/lib/checklist-model";
import { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY } from "@/lib/checklist-readiness";
import { AUTO_SUBMISSION_KEY, type AutomaticChecklistSubmission as SubmissionReceipt } from "@/lib/operations/checklist-auto-submission";
import {
  AdminOperationsReview,
  AutomaticChecklistSubmission,
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

describe("automatically submitted checklist review", () => {
  const receipt: SubmissionReceipt = {
    version: 1, actor: "SYSTEM", sourceEventId: "77", sourceFingerprint: "a".repeat(64),
    eventEndedAt: "2026-10-25T01:00:00.000Z", scheduledFor: "2026-10-25T02:00:00.000Z", submittedAt: "2026-10-25T02:05:00.000Z",
    missingTaskKeys: ["shift-lead-checkout", "food-ready"], missingBwa: true, missingPoc: true,
    contractWarnings: ["Contract quantity is unresolved."],
  };
  const record = (changes: Partial<SubmissionReceipt> = {}): Pick<ChecklistRecord, "status" | "tasks" | "taskEvidence"> => ({
    status: "submitted", tasks: { [AUTO_SUBMISSION_KEY]: true },
    taskEvidence: { [AUTO_SUBMISSION_KEY]: { employeeName: "SYSTEM", completedAt: receipt.submittedAt, automaticSubmission: { ...receipt, ...changes } } },
  });

  it("identifies system submission separately from verified work and retains missing staff, task labels and warnings", () => {
    const html = renderToStaticMarkup(createElement(AutomaticChecklistSubmission, { record: record() }));
    expect(html).toContain("Automatically submitted");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Filed by the system after the one-hour event closeout deadline.");
    expect(html).toContain("does not mark unfinished work complete or confirm it was performed");
    expect(html).toContain("BWA name was not entered.");
    expect(html).toContain("POC name was not entered.");
    for (const key of receipt.missingTaskKeys) {
      const label = checklistSections.flatMap((section) => section.items).find((item) => item.key === key)!.label;
      expect(html).toContain(label);
    }
    expect(html).toContain("Contract quantity is unresolved.");
    expect(html).not.toContain("Confirmed by SYSTEM");
    expect(html).toContain("Use Un-submit checklist if saved information needs correction.");
  });

  it("shows every automatic timestamp in New York time across UTC midnight", () => {
    const html = renderToStaticMarkup(createElement(AutomaticChecklistSubmission, { record: record() }));
    expect(html).toContain('dateTime="2026-10-25T01:00:00.000Z"');
    expect(html).toContain('dateTime="2026-10-25T02:00:00.000Z"');
    expect(html).toContain('dateTime="2026-10-25T02:05:00.000Z"');
    expect(html).toContain("Oct 24, 9:00 PM");
    expect(html).toContain("Oct 24, 10:00 PM");
    expect(html).toContain("Oct 24, 10:05 PM");
    expect(html).toContain("Eastern");
  });

  it("does not add an attention warning when the automatic snapshot contains no outstanding issues", () => {
    const html = renderToStaticMarkup(createElement(AutomaticChecklistSubmission, { record: record({ missingTaskKeys: [], missingBwa: false, missingPoc: false, contractWarnings: [] }) }));
    expect(html).toContain("Automatically submitted");
    expect(html).not.toContain("Needs attention");
    expect(html).not.toContain("name was not entered");
    expect(html).not.toContain("Unfinished or unverified tasks at submission");
  });

  it.each([
    { missingBwa: true },
    { missingPoc: true },
    { missingTaskKeys: ["shift-lead-checkout"] },
    { contractWarnings: ["Retained source warning"] },
  ])("flags each independently outstanding issue for Admin attention: %j", (issue) => {
    const html = renderToStaticMarkup(createElement(AutomaticChecklistSubmission, { record: record({ missingTaskKeys: [], missingBwa: false, missingPoc: false, contractWarnings: [], ...issue }) }));
    expect(html).toContain("Needs attention");
  });

  it("does not label a reopened, manually resubmitted, legacy or malformed record automatically submitted", () => {
    const active = record();
    const cases: Array<Pick<ChecklistRecord, "status" | "tasks" | "taskEvidence">> = [
      { ...active, status: "draft" },
      { ...active, tasks: { [AUTO_SUBMISSION_KEY]: false } },
      { ...active, tasks: {} },
      { ...active, taskEvidence: {} },
      record({ actor: "STAFF" as "SYSTEM" }),
      record({ scheduledFor: "2026-10-25T01:30:00.000Z" }),
      record({ submittedAt: "invalid" }),
      record({ sourceFingerprint: "invalid" }),
    ];
    for (const item of cases) expect(renderToStaticMarkup(createElement(AutomaticChecklistSubmission, { record: item }))).toBe("");
  });

  it("renders retained source warning text and unknown task keys as text, never markup", () => {
    const html = renderToStaticMarkup(createElement(AutomaticChecklistSubmission, { record: record({ missingTaskKeys: ["<script>task</script>"], contractWarnings: ["<script>warning</script>"] }) }));
    expect(html).toContain("&lt;script&gt;task&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;warning&lt;/script&gt;");
    expect(html).not.toContain("<script>");
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
