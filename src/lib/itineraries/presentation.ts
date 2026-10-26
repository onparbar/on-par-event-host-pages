import type { EventPlan, ItineraryAsset } from "@/lib/event-plans/types";
import { normalizeEntertainmentDurationHours } from "@/lib/entertainment/duration";

export function itineraryDrinkLines(event: ItineraryAsset) {
  if (event.itinerary_edit?.fields.drinkLines) return event.itinerary_edit.fields.drinkLines;
  const lines = ["Free soda and juice for all guests"];
  event.drink_options.forEach((item) => {
    if (!/back nine|food \+ beverage|drink card|soft drinks included|soft drinks free of charge/i.test(item)) lines.push(item);
  });
  if (event.food.some((item) => /full course/i.test(item)) || event.drink_options.some((item) => /back nine|food \+ beverage|drink card/i.test(item))) lines.push(`$20 prepaid drink cards for ${event.guest_count} guests`);
  return lines;
}

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
      }
      if (item.duration) details.push(normalizeEntertainmentDurationHours(item.duration));
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
