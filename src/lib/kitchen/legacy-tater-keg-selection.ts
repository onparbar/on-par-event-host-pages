import { createHash } from "node:crypto";
import { normalizeKitchenSelection } from "./normalize";
import type { KitchenSourceEvent } from "./types";

type Source = Pick<KitchenSourceEvent,
  "eventId" | "localDate" | "sourceUpdatedAt" | "status" | "selections"
>;

/** Recover the reported purchased line from its exact pre-fix Tripleseat snapshot. */
export function legacyTaterKegSelection(source: Source) {
  if (source.localDate !== "2026-11-06" || source.status?.trim().toUpperCase() !== "DEFINITE" ||
    !source.sourceUpdatedAt || !Array.isArray(source.selections) ||
    source.selections.some((selection) => normalizeKitchenSelection(selection).kinds.includes("platter:tater-kegs"))) {
    return undefined;
  }

  return source.selections.find((selection) => {
    if (selection.name !== "Tater Kegs" || selection.quantity !== 1 ||
      selection.sourceCategory || selection.isFood != null || selection.sourceId == null) return false;
    const fingerprint = createHash("sha256")
      .update([source.eventId, source.localDate, source.sourceUpdatedAt, selection.sourceId].join("|"))
      .digest("hex");
    return fingerprint === "744b12d5ef8ade8afa48daa451f8961c30b4e5b400c0f9116cebebdf1f807e80";
  });
}
