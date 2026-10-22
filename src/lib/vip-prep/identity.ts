export function vipPrepExternalId(reservation: { id: string }) {
  return `vip-${reservation.id}`;
}

export function numericVipEventId(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

/** Reuse the existing saved-checklist identity; never match parties by name. */
export function operationalKitchenEventId(value: string | number) {
  const id = String(value);
  return id.startsWith("vip-") ? String(numericVipEventId(id)) : id;
}
