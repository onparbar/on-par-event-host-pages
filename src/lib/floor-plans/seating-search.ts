import { getPhysicalFloorPlanAreaId } from "./configuration/areas";
import type { FloorPlanArea } from "./types";

export type SeatingSearchResult = {
  tables: FloorPlanArea[];
  status: "complete" | "search-incomplete" | "no-valid-combination" | "missing-source";
  explored: number;
};

function center(table: FloorPlanArea) {
  return { x: table.x + table.width / 2, y: table.y + table.height / 2 };
}

function components(tables: readonly FloorPlanArea[]) {
  const unseen = new Set(tables.map((_, index) => index));
  let result = 0;
  while (unseen.size) {
    result += 1;
    const first = unseen.values().next().value as number;
    const queue = [first];
    unseen.delete(first);
    while (queue.length) {
      const left = center(tables[queue.pop()!]);
      for (const index of unseen) {
        const right = center(tables[index]);
        if (Math.hypot(left.x - right.x, left.y - right.y) <= 90) {
          unseen.delete(index);
          queue.push(index);
        }
      }
    }
  }
  return result;
}

/** Exact capacity/radius search, followed by bounded grouping optimization.
 * A valid seed is reconstructed before optimization, even above 32 tables. */
export function searchSeatingCombination(
  tables: readonly FloorPlanArea[],
  guestCount: number,
  reservedSeating: readonly FloorPlanArea[] = [],
  foodTables: readonly FloorPlanArea[] = [],
  maxNodes = 50_000,
): SeatingSearchResult {
  if (!Number.isInteger(guestCount) || guestCount < 0) {
    return { tables: [], status: "missing-source", explored: 0 };
  }
  if (guestCount === 0) return { tables: [], status: "complete", explored: 0 };
  const physicalIds = new Set<string>();
  let candidates = tables.filter((table) => {
    const id = getPhysicalFloorPlanAreaId(table.id);
    if (physicalIds.has(id) || !table.isReservable || !Number.isInteger(table.capacity) || table.capacity <= 0 ||
      !["rectangle-table", "square-table", "seating-section"].includes(table.type)) return false;
    physicalIds.add(id);
    return true;
  });
  if (candidates.reduce((total, table) => total + table.capacity, 0) < guestCount) {
    return { tables: [], status: "no-valid-combination", explored: 0 };
  }
  const distances = new Map(candidates.map((table) => {
    const point = center(table);
    return [table.id, foodTables.length ? Math.min(...foodTables.map((food) => {
      const anchor = center(food);
      return Math.hypot(point.x - anchor.x, point.y - anchor.y);
    })) : 0];
  }));
  // Food access is the existing first priority, ahead of unused seats.
  const byDistance = [...candidates].sort((left, right) => distances.get(left.id)! - distances.get(right.id)!);
  let capacity = 0;
  let radius = 0;
  for (const table of byDistance) {
    capacity += table.capacity;
    radius = distances.get(table.id)!;
    if (capacity >= guestCount) break;
  }
  candidates = candidates.filter((table) => distances.get(table.id)! <= radius);
  // The minimum sufficient capacity is at most demand + largest table - 1.
  const limit = guestCount + Math.max(...candidates.map((table) => table.capacity)) - 1;
  const reachable: Set<number>[] = Array.from({ length: candidates.length + 1 }, () => new Set<number>());
  reachable[candidates.length].add(0);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    for (const value of reachable[index + 1]) {
      reachable[index].add(value);
      if (value + candidates[index].capacity <= limit) reachable[index].add(value + candidates[index].capacity);
    }
  }
  const target = Math.min(...[...reachable[0]].filter((value) => value >= guestCount));
  if (!Number.isFinite(target)) return { tables: [], status: "no-valid-combination", explored: 0 };
  const seed: FloorPlanArea[] = [];
  let remaining = target;
  for (let index = 0; index < candidates.length && remaining > 0; index += 1) {
    if (reachable[index + 1].has(remaining - candidates[index].capacity)) {
      seed.push(candidates[index]);
      remaining -= candidates[index].capacity;
    }
  }
  const score = (selected: readonly FloorPlanArea[]) => {
    const proximity = selected.reduce((total, table, index) => {
      const point = center(table);
      const anchors = reservedSeating.length ? reservedSeating : selected.slice(0, index);
      return total + anchors.reduce((sum, anchor) => {
        const other = center(anchor);
        return sum + Math.hypot(point.x - other.x, point.y - other.y);
      }, 0);
    }, 0);
    return [components([...reservedSeating, ...selected]), selected.length, proximity];
  };
  let best = seed;
  let bestScore = score(best);
  let explored = 0;
  let incomplete = false;
  const selected: FloorPlanArea[] = [];
  function visit(index: number, needed: number) {
    if (explored >= maxNodes) { incomplete = true; return; }
    explored += 1;
    if (needed === 0) {
      const nextScore = score(selected);
      const firstDifference = nextScore.findIndex((value, position) => value !== bestScore[position]);
      if (firstDifference >= 0 && nextScore[firstDifference] < bestScore[firstDifference]) {
        best = [...selected];
        bestScore = nextScore;
      }
      return;
    }
    if (index === candidates.length || !reachable[index].has(needed)) return;
    const table = candidates[index];
    if (reachable[index + 1].has(needed - table.capacity)) {
      selected.push(table);
      visit(index + 1, needed - table.capacity);
      selected.pop();
    }
    if (reachable[index + 1].has(needed)) visit(index + 1, needed);
  }
  visit(0, target);
  return { tables: best, status: incomplete ? "search-incomplete" : "complete", explored };
}
