import type { EventPlan, ItineraryAsset } from "@/lib/event-plans/types";

export function itineraryEntertainmentGroups(event: Pick<EventPlan, "entertainment">) {
  if (!event.entertainment.length) {
    return [{ title: "No reserved entertainment", detail: "No entertainment reservation is listed for this event." }];
  }
  return event.entertainment.map((item) => {
    const details = [item.quantity];
    if (!/mini\s+golf/i.test(item.name)) {
      if (item.time && !/time not listed|untimed/i.test(item.time)) {
        details.push(item.time.replace(/\s*-\s*/g, " – ").replace(/\s+/g, " "));
      } else if (/untimed/i.test(item.time)) {
        details.push("Untimed");
      } else if (/time not listed/i.test(item.time)) {
        details.push("Time not listed on BEO");
      } else if (item.duration) {
        details.push(item.duration);
      }
    }
    return { title: item.name, detail: details.filter(Boolean).join(" · ") };
  });
}

export function changedItinerarySections(previous: NonNullable<ItineraryAsset["revision"]>, current: NonNullable<ItineraryAsset["revision"]>) {
  const labels = { event: "Event details", food: "Food / drinks", entertainment: "Entertainment", seating: "Seating / approval", notes: "Instructions / review items" };
  const changed = (Object.keys(labels) as Array<keyof typeof labels>)
    .filter((key) => previous.sections[key] !== current.sections[key])
    .map((key) => labels[key]);
  if (!changed.length && previous.fingerprint !== current.fingerprint) changed.push("Source revision / calculation rules");
  return changed;
}
