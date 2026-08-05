import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MOCK_KITCHEN_EVENTS } from "../../../lib/kitchen/fixtures";
import { quantityAwareReadinessKey } from "../../../lib/kitchen/readiness";
import { generateKitchenChecklist } from "../../../lib/kitchen/rules";
import {
  clockParts,
  ensureAudioContextRunning,
  formatTime,
  KitchenChecklistSheet,
  shouldApplyKitchenDayResponse,
  soundAlertButtonLabel,
  timeSortValue,
} from "../KitchenDashboard";

describe("kitchen dashboard time display", () => {
  it("rejects invalid clock values instead of displaying plausible times", () => {
    expect(clockParts("25:00")).toBeNull();
    expect(clockParts("99:99")).toBeNull();
    expect(clockParts("13:00 PM")).toBeNull();
    expect(formatTime("25:00")).toBe("Needs review");
    expect(formatTime("99:99")).toBe("Needs review");
    expect(timeSortValue("25:00")).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps valid 12-hour and 24-hour values", () => {
    expect(clockParts("12:05 AM")).toEqual({
      hours: 0,
      minutes: 5,
    });
    expect(clockParts("23:59")).toEqual({
      hours: 23,
      minutes: 59,
    });
    expect(formatTime("17:00")).toBe("5:00 PM");
  });

  it("renders zoned ISO timestamps in America/New_York", () => {
    expect(clockParts("2026-07-29T16:05:00Z")).toBeNull();
    expect(formatTime("2026-07-29T16:05:00Z")).toBe("12:05 PM");
    expect(formatTime("2026-07-29T16:05:00-07:00")).toBe(
      "7:05 PM",
    );
    expect(formatTime("2026-07-29T16:05:00")).toBe("4:05 PM");
  });
});

describe("kitchen sound alerts", () => {
  it("requires WebAudio to reach the running state", async () => {
    let state: AudioContextState = "suspended";
    const resume = vi.fn(async () => {
      state = "running";
    });
    const context = {
      get state() {
        return state;
      },
      resume,
    };

    await expect(ensureAudioContextRunning(context)).resolves.toBeUndefined();
    expect(resume).toHaveBeenCalledOnce();
  });

  it("keeps failed audio retryable instead of labeling it on", async () => {
    const context = {
      state: "suspended" as AudioContextState,
      resume: vi.fn().mockRejectedValue(new Error("blocked")),
    };

    await expect(ensureAudioContextRunning(context)).rejects.toThrow(
      "blocked",
    );
    expect(soundAlertButtonLabel("error")).toBe("Retry sound alerts");
    expect(soundAlertButtonLabel("error")).not.toBe("Sound alerts on");
  });

  it("labels the armed and enabled states as automatic sound alerts", () => {
    expect(soundAlertButtonLabel("waiting")).toBe("Sound alerts armed");
    expect(soundAlertButtonLabel("on")).toBe(
      "Sound alerts always on",
    );
  });

  it("rejects a resume that resolves without starting audio", async () => {
    const context = {
      state: "suspended" as AudioContextState,
      resume: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureAudioContextRunning(context)).rejects.toThrow(
      "did not enter the running state",
    );
  });
});

describe("kitchen day response gating", () => {
  it("accepts only the newest request for the currently selected date", () => {
    expect(
      shouldApplyKitchenDayResponse(
        "2026-07-30",
        4,
        "2026-07-30",
        4,
      ),
    ).toBe(true);
    expect(
      shouldApplyKitchenDayResponse(
        "2026-07-29",
        3,
        "2026-07-30",
        4,
      ),
    ).toBe(false);
    expect(
      shouldApplyKitchenDayResponse(
        "2026-07-30",
        3,
        "2026-07-30",
        4,
      ),
    ).toBe(false);
  });
});

describe("kitchen checklist day layout", () => {
  const noop = () => {};

  function renderSheet(checklistIndex: number) {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[checklistIndex]);
    return renderToStaticMarkup(
      createElement(KitchenChecklistSheet, {
        bwaDraft: "",
        bwaSaveState: "idle",
        checklist,
        inline: true,
        onBwaChange: noop,
        onPrint: noop,
        onSaveBwa: noop,
      }),
    );
  }

  it("puts event identity and kitchen counts above the food table", () => {
    const html = renderSheet(0);
    const headerIndex = html.indexOf("data-kitchen-checklist-header");
    const tableIndex = html.indexOf("<table");
    const reviewIndex = html.indexOf("data-kitchen-review-area");

    expect(html).toContain('data-kitchen-event-id="mock-taco-001"');
    expect(html).toContain("Redacted Taco Package");
    expect(html).toContain("Number of guests");
    expect(html).toContain("Chafing dishes");
    expect(html).not.toContain("Event Kitchen Checklist");
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(headerIndex).toBeLessThan(tableIndex);
    expect(reviewIndex).toBeGreaterThan(tableIndex);
  });

  it("renders multiple events as independent checklist sheets", () => {
    const first = renderSheet(0);
    const second = renderSheet(1);
    const html = `<section>${first}${second}</section>`;

    expect(html.match(/data-kitchen-event-id=/g)).toHaveLength(2);
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain('id="kitchen-bwa-mock-taco-001"');
    expect(html).toContain('id="kitchen-bwa-mock-wing-002"');
    expect(html.indexOf("Redacted Taco Package")).toBeLessThan(
      html.indexOf("Redacted Wing Package"),
    );
  });

  it("renders only approved Food Runner and BWA roster options", () => {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);
    checklist.foodRunnerOrBwa = "Ryan (POC)";
    const html = renderToStaticMarkup(
      createElement(KitchenChecklistSheet, {
        bwaDraft: "Ryan (POC)",
        bwaOptions: ["Diana", "Ryan"],
        bwaSaveState: "idle",
        checklist,
        inline: true,
        onBwaChange: noop,
        onSaveBwa: noop,
      }),
    );

    expect(html).toContain('<select id="kitchen-bwa-mock-taco-001"');
    expect(html).toContain('<option value="Diana">Diana</option>');
    expect(html).toContain('<option value="Ryan">Ryan</option>');
    expect(html).not.toContain('<option value="Ryan (POC)"');
    expect(html).not.toContain('placeholder="Enter employee name"');
  });

  it("renders independent Ready and Completed controls after Quantity", () => {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);
    const beef = checklist.sections
      .flatMap((section) => section.rows)
      .find((row) => row.key === "taco-beef")!;
    const beefKey = quantityAwareReadinessKey({
      itemKey: beef.key,
      quantity: beef.quantity,
      numberOfPans: beef.numberOfPans,
      panSize: beef.panSize,
      unit: beef.unit,
      ruleVersion: checklist.ruleVersion,
    });
    const wings = {
      itemKey: "addon:wings",
      foodName: "Wings",
      description: "Traditional wings served with celery and ranch.",
      quantity: 64,
      unit: "each",
      numberOfPans: 3,
      panSize: "1/3" as const,
      sourceUpdatedAt: "2026-07-29T16:30:00Z",
    };
    checklist.completedItemKeys = [
      beefKey,
      quantityAwareReadinessKey({
        ...wings,
        ruleVersion: checklist.ruleVersion,
      }),
    ];
    checklist.finalCompletedItemKeys = [beefKey];
    checklist.liveFoodAddOns = [wings];
    const html = renderToStaticMarkup(
      createElement(KitchenChecklistSheet, {
        bwaDraft: "",
        bwaSaveState: "idle",
        checklist,
        inline: true,
        onBwaChange: noop,
        onCompletedChange: noop,
        onOpenDescription: noop,
        onReadyChange: noop,
        onSaveBwa: noop,
        readinessPending: new Set<string>(),
        completionPending: new Set<string>(),
      }),
    );

    const quantityHeader = html.indexOf(
      '<th scope="col">Quantity</th>',
    );
    const completedHeader = html.indexOf(
      '<th scope="col">Completed</th>',
    );
    const beefReadyInput = html.match(
      /<input aria-label="Mark Beef ready"[^>]*>/,
    )?.[0];
    const beefCompletedInput = html.match(
      /<input aria-label="Mark Beef completed"[^>]*>/,
    )?.[0];
    const wingsCompletedInput = html.match(
      /<input aria-label="Mark add-on Wings completed"[^>]*>/,
    )?.[0];

    expect(html).toContain("<th scope=\"col\">Ready</th>");
    expect(quantityHeader).toBeGreaterThanOrEqual(0);
    expect(completedHeader).toBeGreaterThan(quantityHeader);
    expect(html).toContain('<th colSpan="6"');
    expect(beefReadyInput).toContain('checked=""');
    expect(beefCompletedInput).toContain('checked=""');
    expect(wingsCompletedInput).not.toContain('checked=""');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Live food add-ons");
    expect(html).toContain('aria-label="Mark add-on Wings ready"');
    expect(html).toContain(
      'aria-label="Mark add-on Wings completed"',
    );
    expect(html.match(/kitchen-item-complete/g)).toHaveLength(2);
    expect(html).toContain("Needs review:");
  });

  it("does not apply Ready row styling to a final-completed-only item", () => {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);
    const beef = checklist.sections
      .flatMap((section) => section.rows)
      .find((row) => row.key === "taco-beef")!;
    checklist.finalCompletedItemKeys = [
      quantityAwareReadinessKey({
        itemKey: beef.key,
        quantity: beef.quantity,
        numberOfPans: beef.numberOfPans,
        panSize: beef.panSize,
        unit: beef.unit,
        ruleVersion: checklist.ruleVersion,
      }),
    ];
    const html = renderToStaticMarkup(
      createElement(KitchenChecklistSheet, {
        bwaDraft: "",
        bwaSaveState: "idle",
        checklist,
        inline: true,
        onBwaChange: noop,
        onCompletedChange: noop,
        onReadyChange: noop,
        onSaveBwa: noop,
      }),
    );
    const readyInput = html.match(
      /<input aria-label="Mark Beef ready"[^>]*>/,
    )?.[0];
    const completedInput = html.match(
      /<input aria-label="Mark Beef completed"[^>]*>/,
    )?.[0];

    expect(readyInput).not.toContain('checked=""');
    expect(completedInput).toContain('checked=""');
    expect(html).not.toContain("kitchen-item-complete");
  });

  it("does not carry readiness forward when a row quantity changes", () => {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);
    const beef = checklist.sections
      .flatMap((section) => section.rows)
      .find((row) => row.key === "taco-beef")!;
    checklist.completedItemKeys = [
      quantityAwareReadinessKey({
        itemKey: beef.key,
        quantity: (beef.quantity ?? 0) + 1,
        numberOfPans: beef.numberOfPans,
        panSize: beef.panSize,
        unit: beef.unit,
        ruleVersion: checklist.ruleVersion,
      }),
    ];
    const html = renderToStaticMarkup(
      createElement(KitchenChecklistSheet, {
        bwaDraft: "",
        bwaSaveState: "idle",
        checklist,
        inline: true,
        onBwaChange: noop,
        onOpenDescription: noop,
        onReadyChange: noop,
        onSaveBwa: noop,
        readinessPending: new Set<string>(),
      }),
    );

    expect(html).not.toContain("kitchen-item-complete");
  });

  it("does not carry add-on readiness forward after the source definition changes", () => {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);
    const wings = {
      itemKey: "addon:wings",
      foodName: "Wings",
      description: "Traditional wings served with celery and ranch.",
      quantity: 64,
      unit: "each",
      numberOfPans: 3,
      panSize: "1/3" as const,
      sourceUpdatedAt: "2026-07-29T16:31:00Z",
    };
    checklist.liveFoodAddOns = [wings];
    checklist.completedItemKeys = [
      quantityAwareReadinessKey({
        ...wings,
        ruleVersion: checklist.ruleVersion,
        sourceUpdatedAt: "2026-07-29T16:30:00Z",
      }),
    ];
    const html = renderToStaticMarkup(
      createElement(KitchenChecklistSheet, {
        bwaDraft: "",
        bwaSaveState: "idle",
        checklist,
        inline: true,
        onBwaChange: noop,
        onOpenDescription: noop,
        onReadyChange: noop,
        onSaveBwa: noop,
        readinessPending: new Set<string>(),
      }),
    );

    expect(html).not.toContain("kitchen-item-complete");
  });
});
