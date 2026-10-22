import { operationalKitchenEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";

/** Reservation identity only; a matching event title is never enough. */
export function vipCheckinNavigationRows<T extends { reservationId: string; reservationDate: string }>(rows: readonly T[], preferredEventId: string | null, date: string) {
  const datedRows = rows.filter((row) => row.reservationDate === date);
  if (!preferredEventId) return datedRows;
  const requested = operationalKitchenEventId(preferredEventId);
  return datedRows.filter((row) => operationalKitchenEventId(vipPrepExternalId({ id: row.reservationId })) === requested);
}
