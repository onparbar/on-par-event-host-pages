import { operationalKitchenEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";

/** Reservation identity only; a matching event title is never enough. */
export function vipCheckinNavigationRows<T extends { reservationId: string; reservationDate: string }>(rows: readonly T[], preferredEventId: string | null, date: string) {
  const datedRows = rows.filter((row) => row.reservationDate === date);
  if (!preferredEventId) return datedRows;
  if (preferredEventId.startsWith("vip-")) return datedRows.filter((row) => vipPrepExternalId({ id: row.reservationId }) === preferredEventId);
  const requested = operationalKitchenEventId(preferredEventId);
  const matches = datedRows.filter((row) => operationalKitchenEventId(vipPrepExternalId({ id: row.reservationId })) === requested);
  return matches.length > 1 ? [] : matches;
}
