import { formatEventDate } from "@/lib/event-format";
import { events, type EventPlan } from "@/lib/events";

export type ChecklistEvent = EventPlan & {
  dateLabel: string;
  poc: string;
};

export function checklistEventsForPlans(
  plans: readonly EventPlan[],
): ChecklistEvent[] {
  return plans.map((event) => {
    return {
      ...event,
      dateLabel: formatEventDate(event.date),
      poc: "",
    };
  });
}

export const checklistEvents: ChecklistEvent[] = checklistEventsForPlans(events);
