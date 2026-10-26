import type { WorkspacePayload } from "./workspace";
import { checklistSections } from "@/lib/checklist-model";
import { checklistReadiness } from "@/lib/checklist-readiness";
import { formatEntertainmentIntervalHours } from "@/lib/entertainment/duration";

export type WorkspaceTimelineItem = {
  id: string;
  label: string;
  at: string | null;
  location: string;
  instruction: string;
  completed: boolean;
};

/** Scheduled times remain distinct from actual completion evidence. Mini golf is never timed. */
export function workspaceTimeline(payload: WorkspacePayload): WorkspaceTimelineItem[] {
  const area = payload.event.rooms.join(", ");
  const entries: WorkspaceTimelineItem[] = [];
  const readiness = payload.record ? checklistReadiness(payload.event, payload.record) : null;
  const sectionComplete = (sectionKey: string) => {
    const keys = new Set(checklistSections.find((section) => section.key === sectionKey)?.items.map((item) => item.key));
    const tasks = readiness?.tasks.filter((item) => keys.has(item.key) && item.applicability !== "not-applicable") ?? [];
    return tasks.length > 0 && tasks.every((item) => item.applicability === "required" && payload.record?.tasks[item.key] && payload.record.taskEvidence?.[item.key]?.employeeName.trim() && Number.isFinite(Date.parse(payload.record.taskEvidence[item.key].completedAt)));
  };
  if (payload.eventStartAt) {
    entries.push({ id: "setup", label: "Setup deadline", at: new Date(Date.parse(payload.eventStartAt) - 60 * 60_000).toISOString(), location: area, instruction: "Complete the event setup checklist.", completed: sectionComplete("one-hour-before") });
    entries.push({ id: "arrival", label: "Scheduled guest arrival", at: payload.eventStartAt, location: area, instruction: "VIP arrival must be confirmed separately in VIP Check-In.", completed: false });
  } else {
    entries.push({ id: "arrival", label: "Guest arrival — time needs review", at: null, location: area, instruction: "Check the contract before using this itinerary.", completed: false });
  }
  if (payload.foodReminderAt) entries.push({ id: "food", label: "Get Food Out", at: payload.foodReminderAt, location: area, instruction: "Have food out and ready 15 minutes before the party. This is not an order release.", completed: payload.record?.tasks["food-kitchen-window"] === true });
  for (const activity of payload.activities.filter((item) => !item.cancelled)) {
    const duration = !activity.untimed && activity.startAt && activity.endAt ? formatEntertainmentIntervalHours(activity.startAt, activity.endAt) : "";
    entries.push({ id: `${activity.id}:start`, label: `${activity.label}${activity.quantity ? `: ${activity.quantity}` : ""}`, at: activity.untimed ? null : activity.startAt, location: activity.resourceNames.join(", ") || area, instruction: activity.untimed ? "Untimed contract activity." : activity.startAt ? `Activity start / guest transition.${duration ? ` Duration: ${duration}.` : ""}` : "Activity time needs review.", completed: Boolean(activity.startedAt || activity.completedAt) });
    if (!activity.untimed && activity.endAt) entries.push({ id: `${activity.id}:end`, label: `${activity.label} ends`, at: activity.endAt, location: activity.resourceNames.join(", ") || area, instruction: "Guide guests to the next scheduled activity.", completed: Boolean(activity.completedAt) });
  }
  if (payload.eventEndAt) entries.push({ id: "breakdown", label: "Event ends / breakdown", at: payload.eventEndAt, location: area, instruction: "Complete closing and breakdown tasks.", completed: sectionComplete("end-of-event") });
  return entries.sort((left, right) => left.at === null && right.at !== null ? 1 : right.at === null && left.at !== null ? -1 : (left.at ?? "").localeCompare(right.at ?? "") || left.id.localeCompare(right.id));
}

export function workspaceTimelinePosition(entries: readonly WorkspaceTimelineItem[], now: Date) {
  const timed = entries.filter((item) => item.at && !item.completed);
  const next = timed.find((item) => Date.parse(item.at!) > now.getTime());
  const current = timed.filter((item) => Date.parse(item.at!) <= now.getTime()).at(-1);
  return { current: current?.id ?? null, next: next?.id ?? null };
}
