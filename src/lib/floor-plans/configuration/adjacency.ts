export type AreaPreference = {
  seatingAreaId: string;
  entertainmentType:
    | "bowling"
    | "darts"
    | "pool"
    | "shuffleboard"
    | "mini-golf";
  preferredInventoryIds: string[][];
};

export const AREA_PREFERENCES: readonly AreaPreference[] = [
  { seatingAreaId: "vip-1", entertainmentType: "bowling", preferredInventoryIds: [["bowling-3", "bowling-4", "bowling-5", "bowling-6"], ["bowling-1", "bowling-2"], ["bowling-7", "bowling-8"]] },
  { seatingAreaId: "vip-2", entertainmentType: "bowling", preferredInventoryIds: [["bowling-4", "bowling-5", "bowling-6", "bowling-7"], ["bowling-1", "bowling-2", "bowling-3"], ["bowling-8", "bowling-9"]] },
  { seatingAreaId: "main-dining", entertainmentType: "bowling", preferredInventoryIds: [["bowling-9", "bowling-10", "bowling-11", "bowling-12"], ["bowling-7", "bowling-8"], ["bowling-5", "bowling-6"]] },
  { seatingAreaId: "wat-tables", entertainmentType: "bowling", preferredInventoryIds: [["bowling-1", "bowling-2", "bowling-3", "bowling-4"], ["bowling-5", "bowling-6"]] },
  { seatingAreaId: "geg-tables", entertainmentType: "bowling", preferredInventoryIds: [["bowling-10", "bowling-11", "bowling-12"], ["bowling-8", "bowling-9"]] },
  { seatingAreaId: "big-show-karaoke", entertainmentType: "bowling", preferredInventoryIds: [["bowling-1", "bowling-2", "bowling-3"], ["bowling-4", "bowling-5"]] },
  ...["vip-1", "vip-2", "main-dining", "wat-tables", "geg-tables", "big-show-karaoke"].flatMap((seatingAreaId) => [
    { seatingAreaId, entertainmentType: "darts" as const, preferredInventoryIds: seatingAreaId === "main-dining" || seatingAreaId === "geg-tables" ? [["darts-1", "darts-2", "darts-3", "darts-4", "darts-5"]] : [["darts-1", "darts-2", "darts-3"], ["darts-4", "darts-5"]] },
    { seatingAreaId, entertainmentType: "pool" as const, preferredInventoryIds: [["pool-1", "pool-2", "pool-3"]] },
    { seatingAreaId, entertainmentType: "shuffleboard" as const, preferredInventoryIds: [["shuffleboard-1", "shuffleboard-2"]] },
    { seatingAreaId, entertainmentType: "mini-golf" as const, preferredInventoryIds: seatingAreaId === "geg-tables" || seatingAreaId === "main-dining" ? [["mini-golf-great-escape"], ["mini-golf-wild-axe"], ["mini-golf-level-up"]] : [["mini-golf-level-up"], ["mini-golf-wild-axe"], ["mini-golf-great-escape"]] },
  ]),
] as const;

const DEFAULT_INVENTORY: Record<AreaPreference["entertainmentType"], string[]> = {
  bowling: Array.from({ length: 12 }, (_, index) => `bowling-${index + 1}`),
  darts: Array.from({ length: 5 }, (_, index) => `darts-${index + 1}`),
  pool: Array.from({ length: 3 }, (_, index) => `pool-${index + 1}`),
  shuffleboard: Array.from({ length: 2 }, (_, index) => `shuffleboard-${index + 1}`),
  "mini-golf": ["mini-golf-level-up", "mini-golf-wild-axe", "mini-golf-great-escape"],
};

export function preferredInventory(
  seatingAreaId: string,
  entertainmentType: AreaPreference["entertainmentType"],
) {
  const preference = AREA_PREFERENCES.find(
    (item) =>
      item.seatingAreaId === seatingAreaId &&
      item.entertainmentType === entertainmentType,
  );
  const flattened = preference?.preferredInventoryIds.flat() ?? [];
  return [...new Set([...flattened, ...DEFAULT_INVENTORY[entertainmentType]])];
}

export function selectEntertainmentResources(
  seatingAreaId: string,
  entertainmentType: AreaPreference["entertainmentType"],
  quantity: number,
  unavailableIds: ReadonlySet<string> = new Set(),
) {
  if (!Number.isInteger(quantity) || quantity <= 0) return [];
  const ordered = preferredInventory(seatingAreaId, entertainmentType).filter(
    (id) => !unavailableIds.has(id),
  );
  if (entertainmentType === "mini-golf") {
    return ordered.slice(0, Math.min(quantity, ordered.length));
  }

  const numeric = ordered
    .map((id) => ({ id, number: Number(id.match(/(\d+)$/)?.[1]) }))
    .filter((item) => Number.isFinite(item.number));
  for (let start = 0; start <= numeric.length - quantity; start += 1) {
    const candidate = numeric.slice(start, start + quantity);
    if (candidate.every((item, index) => index === 0 || item.number === candidate[index - 1].number + 1)) {
      return candidate.map((item) => item.id);
    }
  }
  return ordered.slice(0, quantity);
}
