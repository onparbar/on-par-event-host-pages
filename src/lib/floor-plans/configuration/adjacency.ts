import { getAreaForEntertainmentResource, getFloorPlanArea } from "./areas";

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
  { seatingAreaId: "wat-tables", entertainmentType: "bowling", preferredInventoryIds: [["bowling-1", "bowling-2", "bowling-3", "bowling-4"], ["bowling-5", "bowling-6"]] },
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

export function bowlingLaneDirection(seatingAreaIds: readonly string[]): "ascending" | "descending" | null {
  // Retain the existing VIP-first rule when the booking includes multiple sections.
  if (seatingAreaIds.some((id) => id === "vip-1" || id === "vip-2")) return "ascending";
  const low = seatingAreaIds.includes("big-show-karaoke");
  const high = seatingAreaIds.some((id) => id === "main-dining" || id === "geg-tables");
  return low === high ? null : low ? "ascending" : "descending";
}

export function preferredInventory(
  seatingAreaId: string | readonly string[],
  entertainmentType: AreaPreference["entertainmentType"],
) {
  const seatingAreaIds = typeof seatingAreaId === "string" ? [seatingAreaId] : seatingAreaId;
  const direction = entertainmentType === "bowling" ? bowlingLaneDirection(seatingAreaIds) : null;
  if (direction) {
    const lanes = [...DEFAULT_INVENTORY.bowling];
    return direction === "descending" ? lanes.reverse() : lanes;
  }
  const preferences = AREA_PREFERENCES.filter(
    (item) =>
      seatingAreaIds.includes(item.seatingAreaId) &&
      item.entertainmentType === entertainmentType,
  );
  const flattened = preferences.flatMap((item) => item.preferredInventoryIds.flat());
  const inventory = [...new Set([...flattened, ...DEFAULT_INVENTORY[entertainmentType]])];
  if (entertainmentType !== "bowling") return inventory;
  return inventory.sort((left, right) =>
    distanceToSeating(left, seatingAreaIds) - distanceToSeating(right, seatingAreaIds) ||
    inventoryNumber(left) - inventoryNumber(right),
  );
}

function inventoryNumber(id: string) {
  return Number(id.match(/(\d+)$/)?.[1]);
}

function distanceToSeating(resourceId: string, seatingAreaIds: readonly string[]) {
  const resource = getAreaForEntertainmentResource(resourceId);
  const areas = seatingAreaIds.flatMap((id) => {
    const area = getFloorPlanArea(id);
    return area && area.id !== "facility" ? [area] : [];
  });
  if (!resource || areas.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...areas.map((area) => Math.hypot(
    resource.x + resource.width / 2 - (area.x + area.width / 2),
    resource.y + resource.height / 2 - (area.y + area.height / 2),
  )));
}

export function selectEntertainmentResources(
  seatingAreaId: string | readonly string[],
  entertainmentType: AreaPreference["entertainmentType"],
  quantity: number,
  unavailableIds: ReadonlySet<string> = new Set(),
) {
  if (!Number.isInteger(quantity) || quantity <= 0) return [];
  const seatingAreaIds = typeof seatingAreaId === "string" ? [seatingAreaId] : seatingAreaId;
  if (entertainmentType === "bowling" && !seatingAreaIds.some((id) =>
    id !== "facility" && getFloorPlanArea(id),
  )) return [];
  const ordered = preferredInventory(seatingAreaId, entertainmentType).filter(
    (id) => !unavailableIds.has(id),
  );
  if (entertainmentType === "mini-golf") {
    return ordered.slice(0, Math.min(quantity, ordered.length));
  }
  if (ordered.length < quantity) return [];
  // Start at the requested side and skip occupied lanes, even if they split the group.
  if (entertainmentType === "bowling" && bowlingLaneDirection(seatingAreaIds)) {
    return ordered.slice(0, quantity);
  }

  const numeric = ordered
    .map((id) => ({ id, number: inventoryNumber(id) }))
    .filter((item) => Number.isFinite(item.number))
    .sort((left, right) => left.number - right.number);
  const consecutive: string[][] = [];
  for (let start = 0; start <= numeric.length - quantity; start += 1) {
    const candidate = numeric.slice(start, start + quantity);
    if (candidate.every((item, index) => index === 0 || item.number === candidate[index - 1].number + 1)) {
      consecutive.push(candidate.map((item) => item.id));
    }
  }
  const score = (ids: readonly string[]) => ids.reduce((total, id) =>
    total + (entertainmentType === "bowling"
      ? distanceToSeating(id, seatingAreaIds)
      : ordered.indexOf(id)), 0);
  consecutive.sort((left, right) => score(left) - score(right) ||
    inventoryNumber(left[0]) - inventoryNumber(right[0]));
  if (consecutive.length > 0) return consecutive[0];
  return ordered.slice(0, quantity);
}
