import { createHash } from "node:crypto";
import { vipPreorderFingerprint, type VipPrepReservation } from "@/lib/vip-prep/client";

export type VipInitialFoodSnapshot = {
  version: 1;
  reservationId: string;
  sourceUpdatedAt: string;
  sourceFingerprint: string;
  bookingDate: string;
  startAt: string;
  endAt: string;
  resourceCode: string;
  food: Array<{ code: string; label: string; quantity: number }>;
  checkedInBy: string;
  checkedInAt: string;
};

export function vipReleaseFingerprint(reservation: VipPrepReservation) {
  return createHash("sha256").update(vipPreorderFingerprint(reservation)).digest("hex");
}

export function vipInitialFoodSnapshot(
  reservation: VipPrepReservation,
  checkin: { employee_name: string; checked_in_at: string },
): VipInitialFoodSnapshot {
  return {
    version: 1,
    reservationId: reservation.id,
    sourceUpdatedAt: reservation.updatedAt,
    sourceFingerprint: vipReleaseFingerprint(reservation),
    bookingDate: reservation.operatingDate,
    startAt: reservation.startAt,
    endAt: reservation.endAt,
    resourceCode: reservation.resource.code,
    food: reservation.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })),
    checkedInBy: checkin.employee_name,
    checkedInAt: checkin.checked_in_at,
  };
}

export function readVipInitialFoodSnapshot(value: unknown): VipInitialFoodSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as VipInitialFoodSnapshot;
  return snapshot.version === 1 && typeof snapshot.reservationId === "string" &&
    typeof snapshot.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(snapshot.sourceFingerprint) &&
    typeof snapshot.sourceUpdatedAt === "string" && typeof snapshot.bookingDate === "string" &&
    typeof snapshot.startAt === "string" && typeof snapshot.endAt === "string" &&
    typeof snapshot.resourceCode === "string" && Array.isArray(snapshot.food) &&
    snapshot.food.every((item) => item && typeof item.code === "string" && typeof item.label === "string" && Number.isSafeInteger(item.quantity) && item.quantity > 0) &&
    typeof snapshot.checkedInBy === "string" && snapshot.checkedInBy.trim() !== "" &&
    typeof snapshot.checkedInAt === "string" && Number.isFinite(Date.parse(snapshot.checkedInAt)) ? snapshot : null;
}
