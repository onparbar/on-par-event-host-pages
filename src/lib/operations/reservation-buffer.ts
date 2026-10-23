export const RESERVATION_SETUP_MINUTES = 60;
export const RESERVATION_CLEANUP_MINUTES = 30;

// Seating setup/cleanup only. Shared entertainment uses exact booked times.
// These are elapsed-minute occupancy buffers, not changes to contracted times.
export function reservationOccupancy(startAt: string | null, endAt: string | null) {
  if (!startAt || !endAt) return null;
  if (![startAt, endAt].every((value) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value))) return null;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    startAt: new Date(start - RESERVATION_SETUP_MINUTES * 60_000).toISOString(),
    endAt: new Date(end + RESERVATION_CLEANUP_MINUTES * 60_000).toISOString(),
  };
}

export function reservationOccupancyOverlap(
  leftStart: string | null,
  leftEnd: string | null,
  rightStart: string | null,
  rightEnd: string | null,
) {
  const left = reservationOccupancy(leftStart, leftEnd);
  const right = reservationOccupancy(rightStart, rightEnd);
  if (!left || !right) return null;
  const startAt = Date.parse(left.startAt) >= Date.parse(right.startAt) ? left.startAt : right.startAt;
  const endAt = Date.parse(left.endAt) <= Date.parse(right.endAt) ? left.endAt : right.endAt;
  return Date.parse(startAt) < Date.parse(endAt) ? { startAt, endAt } : null;
}
