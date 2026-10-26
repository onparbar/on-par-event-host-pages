import { formatClock, localDateForIso } from "@/lib/entertainment/time";
import { reservationOccupancy } from "@/lib/operations/reservation-buffer";
import { getFloorPlanArea, getPhysicalFloorPlanAreaId, requiredFoodTableCount } from "./configuration/areas";
import { floorPlanAreaTimeOverlap, timeRangesOverlap } from "./conflicts";
import type { FloorPlanEvent, FloorPlanReservation } from "./types";

type Interval = { startAt: string; endAt: string };

function interval(reservation: Pick<FloorPlanReservation, "startAt" | "endAt">): Interval | null {
  return reservationOccupancy(reservation.startAt, reservation.endAt)
    ? { startAt: reservation.startAt!, endAt: reservation.endAt! } : null;
}

function seatingArea(reservation: FloorPlanReservation) {
  const area = getFloorPlanArea(reservation.areaId);
  if (!area?.isReservable || area.capacity <= 0) return null;
  const correctPurpose = reservation.reservationType === "seating"
    ? ["rectangle-table", "square-table", "seating-section", "room"].includes(area.type)
    : reservation.reservationType === "room" && ["room", "seating-section"].includes(area.type);
  return correctPurpose ? getFloorPlanArea(getPhysicalFloorPlanAreaId(area.id)) : null;
}

function insideContract(event: FloorPlanEvent, areaId: string) {
  const area = getFloorPlanArea(areaId);
  return event.contractedAreaIds.includes("facility") || Boolean(area && (
    event.contractedAreaIds.includes(area.id) ||
    (area.parentAreaId && event.contractedAreaIds.includes(area.parentAreaId))
  ));
}

function isFoodOverlap(seating: FloorPlanReservation, food: FloorPlanReservation) {
  return food.reservationType === "food-table" &&
    getPhysicalFloorPlanAreaId(seating.areaId) === getPhysicalFloorPlanAreaId(food.areaId) &&
    (!interval(food) || !interval(seating) || timeRangesOverlap(seating.startAt, seating.endAt, food.startAt, food.endAt));
}

/** Physical identities are counted once; a food-use alias never creates seats. */
export function distinctPhysicalSeatingCapacity(reservations: readonly FloorPlanReservation[]) {
  const capacities = new Map<string, number>();
  for (const reservation of reservations) {
    const area = seatingArea(reservation);
    if (!area || reservations.some((food) => isFoodOverlap(reservation, food))) continue;
    capacities.set(area.id, area.capacity);
  }
  return [...capacities.values()].reduce((sum, capacity) => sum + capacity, 0);
}

function covers(intervals: readonly Interval[], start: number, end: number) {
  let cursor = start;
  for (const current of [...intervals].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))) {
    if (Date.parse(current.startAt) > cursor) break;
    cursor = Math.max(cursor, Date.parse(current.endAt));
    if (cursor >= end) return true;
  }
  return false;
}

/** A fixed set of physical seats must remain usable for the whole party. */
export function summarizeEventSeating(
  event: FloorPlanEvent,
  reservations: readonly FloorPlanReservation[],
  options: { allReservations?: readonly FloorPlanReservation[] } = {},
) {
  const own = reservations.filter((row) => row.floorPlanEventId === event.id);
  const all = options.allReservations ?? reservations;
  const requiredInterval = interval(event);
  const issues: string[] = [];
  const validGuestCount = Number.isInteger(event.guestCount) && event.guestCount > 0;
  if (!validGuestCount) issues.push("A verified positive guest count is required before seating coverage can be confirmed.");
  const physical = new Map<string, { capacity: number; intervals: Interval[]; available: boolean; foodUse: boolean }>();
  for (const row of own) {
    if (row.reservationType !== "seating" && row.reservationType !== "room") continue;
    const area = seatingArea(row);
    if (!area) {
      if (row.reservationType === "seating") issues.push(`${getFloorPlanArea(row.areaId)?.name ?? row.areaId} has no verified capacity for this seating purpose.`);
      continue;
    }
    if (!insideContract(event, area.id)) {
      issues.push(`${area.name} is outside the contracted area and its seats are not counted.`);
      continue;
    }
    const range = interval(row);
    const id = area.id;
    const group = physical.get(id) ?? { capacity: area.capacity, intervals: [], available: true, foodUse: false };
    if (own.some((food) => isFoodOverlap(requiredInterval ? { ...row, ...requiredInterval } : row, food))) {
      group.foodUse = true;
      group.available = false;
    }
    if (range) group.intervals.push(range);
    else issues.push(`${area.name} has no valid seating interval.`);
    if (requiredInterval && all.some((other) => {
      if (other.id === row.id && other.floorPlanEventId === event.id) return false;
      const samePhysical = getPhysicalFloorPlanAreaId(other.areaId) === id;
      const otherParty = other.floorPlanEventId !== event.id;
      if (!samePhysical && !(otherParty && other.areaId === "facility")) return false;
      if (!otherParty && other.reservationType !== "food-table") return false;
      if (!interval(other)) return true;
      return Boolean(floorPlanAreaTimeOverlap(id, requiredInterval.startAt, requiredInterval.endAt, other.startAt, other.endAt));
    })) {
      group.available = false;
      issues.push(`${area.name} is unavailable during the required seating occupancy, including applicable setup and cleanup.`);
    }
    physical.set(id, group);
  }
  const assignedCapacity = [...physical.values()].reduce((sum, group) => sum + (group.foodUse ? 0 : group.capacity), 0);
  const start = requiredInterval ? Date.parse(requiredInterval.startAt) : 0;
  const end = requiredInterval ? Date.parse(requiredInterval.endAt) : 0;
  const groups = [...physical.values()];
  const coveredCapacity = requiredInterval ? groups.reduce((sum, group) =>
    sum + (group.available && covers(group.intervals, start, end) ? group.capacity : 0), 0) : 0;
  const boundaries = requiredInterval ? [...new Set([
    start, end, ...groups.flatMap((group) => group.intervals.flatMap((range) =>
      [Date.parse(range.startAt), Date.parse(range.endAt)].filter((time) => time > start && time < end))),
  ])].sort((a, b) => a - b) : [];
  const gaps: Array<Interval & { availableSeats: number; missingSeats: number }> = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index];
    const to = boundaries[index + 1];
    const availableSeats = groups.reduce((sum, group) =>
      sum + (group.available && covers(group.intervals, from, to) ? group.capacity : 0), 0);
    if (!validGuestCount || availableSeats >= event.guestCount) continue;
    const previous = gaps[gaps.length - 1];
    if (previous?.availableSeats === availableSeats && Date.parse(previous.endAt) === from) previous.endAt = new Date(to).toISOString();
    else gaps.push({ startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString(), availableSeats, missingSeats: event.guestCount - availableSeats });
  }
  if (!requiredInterval) issues.push("The required event seating interval is missing or invalid.");
  else if (coveredCapacity < event.guestCount && gaps.length === 0) {
    issues.push("The same physical tables do not cover the whole event. Automatic guest reseating or table sharing is not permitted.");
  }
  const onParBookingAreaIds = event.source.onParBookingAreaIds ?? [];
  const vipOnly = event.tripleseatEventId.startsWith("vip-") &&
    (onParBookingAreaIds.length === 0 || event.contractedAreaIds.every((id) => onParBookingAreaIds.includes(id)));
  const foodRequired = vipOnly ? 0 : requiredFoodTableCount(event.guestCount);
  const foodGroups = new Map<string, Interval[]>();
  for (const row of own) {
    if (row.reservationType !== "food-table" || !getFloorPlanArea(row.areaId)?.canBeFoodTable) continue;
    const id = getPhysicalFloorPlanAreaId(row.areaId);
    const range = interval(row);
    foodGroups.set(id, [...(foodGroups.get(id) ?? []), ...(range ? [range] : [])]);
  }
  const foodAssigned = requiredInterval ? [...foodGroups].filter(([id, ranges]) => {
    if (!covers(ranges, start, end)) return false;
    return !all.some((other) => {
      const samePhysical = getPhysicalFloorPlanAreaId(other.areaId) === id;
      const otherParty = other.floorPlanEventId !== event.id;
      if (!samePhysical && !(otherParty && other.areaId === "facility")) return false;
      if (!otherParty && other.reservationType === "food-table") return false;
      if (!otherParty && !seatingArea(other)) return false;
      return !interval(other) || Boolean(floorPlanAreaTimeOverlap(id, requiredInterval.startAt, requiredInterval.endAt, other.startAt, other.endAt));
    });
  }).length : 0;
  if (foodAssigned < foodGroups.size) issues.push("One or more food tables do not cover the full event interval or are unavailable during the required occupancy.");
  return {
    assignedCapacity,
    coveredCapacity,
    seatsNeeded: validGuestCount ? Math.max(0, event.guestCount - coveredCapacity) : 0,
    spareSeats: validGuestCount ? Math.max(0, coveredCapacity - event.guestCount) : 0,
    fullEventCoverage: validGuestCount && Boolean(requiredInterval) && coveredCapacity >= event.guestCount,
    requiredInterval,
    gaps,
    issues: [...new Set(issues)],
    foodRequired,
    foodAssigned,
  };
}

export function seatingCoverageMessage(event: FloorPlanEvent, summary: ReturnType<typeof summarizeEventSeating>) {
  const zone = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
    .formatToParts(new Date(iso)).find((part) => part.type === "timeZoneName")?.value ?? "";
  const format = (iso: string, showZone: boolean) => {
    const date = localDateForIso(iso);
    const otherDate = summary.requiredInterval && date !== localDateForIso(summary.requiredInterval.startAt);
    return `${otherDate ? `${date}, ` : ""}${formatClock(iso)}${showZone ? ` ${zone(iso)}` : ""}`;
  };
  const details = summary.gaps.map((gap) => {
    const showZone = zone(gap.startAt) !== zone(gap.endAt);
    return `${gap.availableSeats} seats cover ${format(gap.startAt, showZone)}–${format(gap.endAt, showZone)}; ${gap.missingSeats} more seats are needed.`;
  });
  return `${summary.assignedCapacity} verified seats assigned for ${event.guestCount} guests; ${summary.coveredCapacity} seats cover the whole event.${details.length ? ` ${details.join(" ")}` : ""}${summary.issues.length ? ` ${summary.issues.join(" ")}` : ""}`;
}
