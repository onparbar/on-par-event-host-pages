import type { EventServingPlan, ServingObject } from "@/lib/operations/serving-plan";
import { APPETIZER_WINGS_DESSERT_SETUP_OBJECTS } from "./setup-objects";

export type Box = { left: number; top: number; width: number; height: number };
type Surface = "buffet" | "dessert-cocktail";
export type Art = Box & { key: string; sprite: number; tableIndex: number; rotate?: number; surface?: Surface };
export type Target = Box & { id: string; item: ServingObject; tableIndex: number; surface?: Surface };
export type TableMockup = { art: Art[]; targets: Target[]; crowded: boolean; tableCount: number; referenceImage?: string; dessertSupport?: { tableIndex: number; kind: "round-cocktail" } };
type Group = { item: ServingObject; pair?: ServingObject };

/** Decorative composition only. Never changes event food, equipment requirements or purchased quantities. */
export function buildTableMockup(plan: EventServingPlan): TableMockup {
  if (plan.status === "no-food") return { art: [], targets: [], crowded: false, tableCount: 0 };
  const reference = twoChaferReference(plan);
  if (reference) return reference;
  const art: Art[] = [], targets: Target[] = [], groups: Group[] = [];
  for (const item of plan.objects.filter((entry) => entry.kind !== "carts")) {
    if (item.kind === "taco-stands" && groups.at(-1)?.item.kind === "tortillas") groups.at(-1)!.pair = item;
    else groups.push({ item });
  }
  // Visual row budgets only: equipment dimensions/clearances have not been measured.
  const rowHeight = (item: ServingObject, compact: boolean) => item.kind === "tortillas" ? compact ? 10 : 11 : item.kind === "lettuce-wraps" ? compact ? 6 : 7 : item.kind === "chafer" ? compact ? 16 : 19 : item.kind === "tier" ? compact ? 13 : 17 : item.kind === "sauces" ? compact ? 6 : 8.5 : compact ? 10 : 12;
  const compact = groups.reduce((sum, group) => sum + rowHeight(group.item, false), 0) > 69;
  let dessert: Group | undefined;
  if (groups.reduce((sum, group) => sum + rowHeight(group.item, compact), 0) > 69) {
    const index = groups.findIndex((group) => group.item.id === "cold-platter-dessert");
    if (index >= 0) dessert = groups.splice(index, 1)[0];
  }
  const boards: Group[][] = [[]];
  let used = 0;
  for (const group of groups) {
    const next = rowHeight(group.item, compact);
    if (used + next > 69 && boards.at(-1)!.length) { boards.push([]); used = 0; }
    boards.at(-1)!.push(group);
    used += next;
  }
  if (dessert && used + rowHeight(dessert.item, compact) <= 69) { boards.at(-1)!.push(dessert); dessert = undefined; }
  const rect = (left: number, top: number, width: number, height = width * 2 / 3): Box => ({ left, top, width, height });
  const centered = (centerY: number, width: number, centerX = 50) => rect(centerX - width / 2, centerY - width / 3, width);
  const addArt = (key: string, sprite: number, box: Box, tableIndex: number, rotate?: number, surface?: Surface) => art.push({ key, sprite, tableIndex, ...box, ...(rotate === undefined ? {} : { rotate }), ...(surface ? { surface } : {}) });
  const addTarget = (item: ServingObject, box: Box, tableIndex: number, suffix = "", surface?: Surface) => targets.push({ id: `${item.id}${suffix}`, item, tableIndex, ...box, ...(surface ? { surface } : {}) });
  function toolCount(item: ServingObject, name: "tongs" | "spoons") {
    const entry = item.contents.find((value) => new RegExp(`^\\d+ (?:small |large )?${name === "tongs" ? "tongs?" : "spoons?"}$`).test(value));
    return entry ? Number(entry.split(" ")[0]) : new RegExp(`^(?:small |large )?${name}(?: per serving line)?$`).test(item.unit) ? item.quantity ?? 0 : 0;
  }
  function drawTools(item: ServingObject, box: Box, tableIndex: number, suffix = "", divisor = 1, targetBox: Box = box, surface?: Surface) {
    addTarget(item, targetBox, tableIndex, suffix, surface);
    const tongs = toolCount(item, "tongs") / divisor, spoons = toolCount(item, "spoons") / divisor;
    const count = tongs + spoons, rows = Math.max(1, count);
    const toolHeight = Math.min(box.width * .84 / 4, box.height / rows * .8), toolWidth = toolHeight * 4;
    for (let index = 0; index < count; index += 1) addArt(`${item.id}${suffix}-tool-${index}`, index < tongs ? 7 : 8, rect(box.left + (box.width - toolWidth) / 2, box.top + (index + .5) * box.height / rows - toolHeight / 2, toolWidth, toolHeight), tableIndex, undefined, surface);
  }

  for (const item of plan.objects.filter((entry) => entry.kind === "carts")) {
    addTarget(item, rect(25, 5, 50, 20), 0);
    for (const child of item.children ?? []) {
      if (child.kind === "plates" || child.kind === "napkins") {
        for (const [index, left] of (child.kind === "plates" ? [30, 56] : [32, 58]).entries()) {
          const box = rect(left, child.kind === "plates" ? 10 : 6, child.kind === "plates" ? 15 : 10);
          const suffix = index === 0 ? "-left" : "-right";
          addTarget(child, box, 0, suffix); addArt(`${child.id}${suffix}`, child.kind === "plates" ? 1 : 2, box, 0);
        }
      } else { const box = rect(45, 7, 10); addTarget(child, box, 0); addArt(child.id, 3, box, 0); }
    }
  }

  const standaloneBar = groups.filter((group) => group.item.kind === "chafer").length === 1 && groups.some((group) => ["appetizer-chafer", "wing-chafer"].includes(group.item.id));
  const placements = boards.flatMap((board, tableIndex) => {
    const total = board.reduce((sum, group) => sum + rowHeight(group.item, compact), 0);
    let top = standaloneBar && boards.length === 1 && !dessert ? (27 + 96 - total) / 2 : 27;
    return board.map((group) => { const height = rowHeight(group.item, compact), centerY = top + height / 2; top += height; return { group, tableIndex, height, centerY, surface: undefined as Surface | undefined }; });
  });
  if (dessert) placements.push({ group: dessert, tableIndex: boards.length - 1, height: 30, centerY: 50, surface: "dessert-cocktail" });
  for (const { group, tableIndex, height, centerY, surface } of placements) {
      const { item } = group, chaferScale = Math.min(1, (height - 1) / 18);
      const box = surface === "dessert-cocktail" ? rect(17, 35, 66, 30) : item.kind === "chafer" ? rect(50 - 12.5 * chaferScale, centerY - 9 * chaferScale, 25 * chaferScale, 18 * chaferScale) : item.kind === "lettuce-wraps" ? rect(42, centerY - 2.85, 16, 5.7) : item.kind === "cold-platter" ? rect(36, centerY - 4.5, 28, 9) : item.kind === "sauces" ? rect(33, centerY - 2.5, 34, 5) : centered(centerY, Math.min(28, height * 1.35));
      addTarget(item, box, tableIndex, "", surface);
      if (item.kind === "tortillas") {
        targets.pop();
        for (const [index, centerX] of [34, 66].entries()) { const warmer = centered(centerY, Math.min(16, (height - 1) * 1.5), centerX); addArt(`${item.id}-${index}`, 9, warmer, tableIndex); addTarget(item, warmer, tableIndex, index === 0 ? "-left" : "-right"); }
        if (group.pair) { const stands = centered(centerY, 12); addArt(group.pair.id, 10, stands, tableIndex); addTarget(group.pair, stands, tableIndex); }
      } else if (item.kind === "chafer") {
        const pans = (item.children ?? []).filter((child) => child.kind === "pan");
        addArt(item.id, pans[0]?.panSize === "1/2" ? 4 : 5, box, tableIndex);
        // Pan contents are identified through the containing dish or picker, not inferred from artwork.
        for (const [index, child] of (item.children ?? []).filter((entry) => entry.kind === "utensils").entries()) {
          const plate = rect((index === 0 ? 28 : 72) - 6.5 * chaferScale, centerY - 6.5 * chaferScale, 13 * chaferScale, 13 * chaferScale);
          addArt(`${child.id}-plate`, 6, plate, tableIndex); drawTools(child, plate, tableIndex);
        }
      } else if (item.kind === "tier") {
        addArt(item.id, 12, box, tableIndex);
        for (const [index, child] of (item.children ?? []).entries()) {
          const tier = rect(box.left, box.top + index * box.height / 3, box.width, box.height / 3);
          addTarget(child, tier, tableIndex);
          for (const tool of child.children ?? []) {
            const tools = rect(tier.left + tier.width * .55, tier.top, tier.width * .4, tier.height);
            // The approved Taco Bar tier reference already includes these two tools on each tier.
            if (item.id === "taco-tier" && ["tier-top-tools", "tier-middle-tools", "tier-bottom-tools"].includes(tool.id) && tool.quantity === 2) addTarget(tool, tools, tableIndex);
            else drawTools(tool, tools, tableIndex);
          }
        }
      } else if (item.kind === "sauces") {
        // Rotated art has the same final visible bounds as the horizontal station target.
        addArt(`${item.id}-plate`, 6, rect(50 - box.height * .75, centerY - box.width / 3, box.height * 1.5, box.width * 2 / 3), tableIndex, 90);
        const sauces = item.children?.length ? item.children : [item];
        const width = box.width / sauces.length;
        for (const [index, sauce] of sauces.entries()) {
          const slot = rect(box.left + index * width, box.top, width, box.height);
          addArt(`${sauce.id}-spoon`, 8, rect(slot.left + width * .08, centerY - width * .105, width * .84, width * .21), tableIndex);
          if (sauce.id !== item.id) addTarget(sauce, slot, tableIndex);
        }
      } else {
        addArt(`${item.id}-plate`, item.kind === "taco-stands" ? 10 : 6, box, tableIndex, undefined, surface);
        for (const child of item.children ?? []) if (child.kind === "utensils") {
          const tools = rect(box.left + box.width * .1, box.top + box.height * .1, box.width * .8, box.height * .8);
          const toolTarget = rect(box.left + box.width * .65, box.top + box.height * .15, box.width * .3, box.height * .7);
          // These reference risers already picture their approved two tongs.
          if (item.kind === "lettuce-wraps" || item.id === "cold-platter-dessert") addTarget(child, toolTarget, tableIndex, "", surface);
          else drawTools(child, tools, tableIndex, "", item.kind === "cold-platter" ? item.quantity ?? 1 : 1, item.kind === "cold-platter" ? toolTarget : tools, surface);
        }
      }
  }
  return { art, targets, crowded: boards.length > 1, tableCount: boards.length, ...(dessert ? { dessertSupport: { tableIndex: boards.length - 1, kind: "round-cocktail" as const } } : {}) };
}

/** Reuse the approved whole-table illustration only when every pictured station matches. */
function twoChaferReference(plan: EventServingPlan): TableMockup | null {
  if (plan.unplacedFood.length) return null;
  const carts = plan.objects.filter((item) => item.kind === "carts");
  const chafers = plan.objects.filter((item) => item.kind === "chafer");
  const sauces = plan.objects.filter((item) => item.kind === "sauces");
  const desserts = plan.objects.filter((item) => item.id === "cold-platter-dessert");
  if (plan.objects.length !== 5 || carts.length !== 1 || carts[0].quantity !== 2 || chafers.length !== 2 || sauces.length !== 1 || desserts.length !== 1 || desserts[0].kind !== "cold-platter") return null;
  const sauceTypes = sauces[0].children ?? [];
  if (sauceTypes.length !== 3 || sauceTypes.some((item) => item.quantity === null || item.quantity <= 0)) return null;
  for (const [index, chafer] of chafers.entries()) {
    const tools = chafer.children?.filter((item) => item.kind === "utensils") ?? [];
    if (tools.length !== 2 || tools.some((item) => item.quantity !== (index === 0 ? 3 : 2) || item.contents.length !== 1 || item.contents[0] !== `${index === 0 ? 3 : 2} tongs`)) return null;
  }
  const targets: Target[] = [];
  const anchor = (id: string): Box => {
    const { left, top, width, height } = APPETIZER_WINGS_DESSERT_SETUP_OBJECTS.find((item) => item.id === id)!;
    return { left, top, width, height };
  };
  const add = (item: ServingObject, box: Box, suffix = "") => targets.push({ id: `${item.id}${suffix}`, item, tableIndex: 0, ...box });
  add(carts[0], anchor("marble-cart-left"), "-left");
  add(carts[0], anchor("marble-cart-right"), "-right");
  for (const item of carts[0].children ?? []) {
    if (item.kind === "plates" || item.kind === "napkins") {
      for (const side of ["left", "right"]) add(item, anchor(item.kind === "plates" ? `plate-stack-${side}` : `napkins-${side}`), `-${side}`);
    } else if (item.kind === "forks") add(item, anchor("fork-caddy"));
  }
  for (const [index, item] of chafers.entries()) {
    const station = index === 0 ? "chafer-one" : "chafer-two";
    add(item, anchor(station));
    for (const [side, tools] of (item.children ?? []).filter((child) => child.kind === "utensils").entries()) add(tools, anchor(`${station}-${side === 0 ? "left" : "right"}-utensil-plate`));
  }
  add(sauces[0], anchor("sauce-plate"));
  sauceTypes.forEach((item, index) => add(item, anchor(`sauce-spoon-${["left", "center", "right"][index]}`)));
  const dessert = desserts[0], box = anchor("dessert-riser");
  add(dessert, { ...box, top: 78.8, height: box.top + box.height - 78.8 });
  for (const tools of dessert.children ?? []) if (tools.kind === "utensils") add(tools, { left: box.left + box.width * .65, top: box.top + box.height * .15, width: box.width * .3, height: box.height * .7 });
  return { art: [], targets, crowded: false, tableCount: 1, referenceImage: "/setup/appetizer-wings-dessert-reference-v1.png" };
}
