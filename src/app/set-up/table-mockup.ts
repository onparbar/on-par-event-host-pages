import type { EventServingPlan, ServingObject } from "@/lib/operations/serving-plan";

export type Box = { left: number; top: number; width: number; height: number };
export type Art = Box & { key: string; sprite: number; tableIndex: number; rotate?: number };
export type Target = Box & { id: string; item: ServingObject; tableIndex: number };
export type TableMockup = { art: Art[]; targets: Target[]; crowded: boolean; tableCount: number };
type Group = { item: ServingObject; pair?: ServingObject; instance?: number; bowls?: ServingObject[] };

/** Decorative composition only. Never changes event food, equipment requirements or purchased quantities. */
export function buildTableMockup(plan: EventServingPlan): TableMockup {
  if (plan.status === "no-food") return { art: [], targets: [], crowded: false, tableCount: 0 };
  const art: Art[] = [], targets: Target[] = [], groups: Group[] = [];
  for (const item of plan.objects.filter((entry) => entry.kind !== "carts")) {
    if (item.kind === "taco-stands" && groups.at(-1)?.item.kind === "tortillas") groups.at(-1)!.pair = item;
    else if (item.kind === "cold-platter") {
      for (let index = 0; index < (item.quantity ?? 1); index += 1) groups.push({ item, instance: index });
    } else if (item.kind === "sauces" && item.children?.length) {
      const bowls = item.children.flatMap((child) => Array.from({ length: child.quantity ?? 0 }, () => child));
      for (let index = 0; index < Math.max(1, bowls.length); index += 3) groups.push({ item, bowls: bowls.slice(index, index + 3), instance: index / 3 });
    } else groups.push({ item });
  }
  const weight = (item: ServingObject) => item.kind === "tortillas" ? 1 : item.kind === "lettuce-wraps" ? .6 : item.kind === "chafer" ? 1.4 : item.kind === "tier" ? 1.3 : item.kind === "sauces" ? .65 : .8;
  const boards: Group[][] = [[]];
  let used = 0;
  for (const group of groups) {
    const next = weight(group.item);
    if (used + next > 5 + Number.EPSILON && boards.at(-1)!.length) { boards.push([]); used = 0; }
    boards.at(-1)!.push(group);
    used += next;
  }
  const rect = (left: number, top: number, width: number, height = width * 2 / 3): Box => ({ left, top, width, height });
  const centered = (centerY: number, width: number, centerX = 50) => rect(centerX - width / 2, centerY - width / 3, width);
  const addArt = (key: string, sprite: number, box: Box, tableIndex: number, rotate?: number) => art.push({ key, sprite, tableIndex, ...box, ...(rotate === undefined ? {} : { rotate }) });
  const addTarget = (item: ServingObject, box: Box, tableIndex: number, suffix = "") => targets.push({ id: `${item.id}${suffix}`, item, tableIndex, ...box });
  function toolCount(item: ServingObject, name: "tongs" | "spoons") {
    const entry = item.contents.find((value) => new RegExp(`^\\d+ (?:small |large )?${name === "tongs" ? "tongs?" : "spoons?"}$`).test(value));
    return entry ? Number(entry.split(" ")[0]) : new RegExp(`^(?:small |large )?${name}(?: per serving line)?$`).test(item.unit) ? item.quantity ?? 0 : 0;
  }
  function drawTools(item: ServingObject, box: Box, tableIndex: number, suffix = "", divisor = 1, targetBox: Box = box) {
    addTarget(item, targetBox, tableIndex, suffix);
    const tongs = toolCount(item, "tongs") / divisor, spoons = toolCount(item, "spoons") / divisor;
    const count = tongs + spoons, rows = Math.max(1, count);
    const toolHeight = Math.min(box.width * .84 / 4, box.height / rows * .8), toolWidth = toolHeight * 4;
    for (let index = 0; index < count; index += 1) addArt(`${item.id}${suffix}-tool-${index}`, index < tongs ? 7 : 8, rect(box.left + (box.width - toolWidth) / 2, box.top + (index + .5) * box.height / rows - toolHeight / 2, toolWidth, toolHeight), tableIndex);
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

  const bowlInstances = new Map<string, number>();
  for (const [tableIndex, board] of boards.entries()) {
    let top = 29;
    for (const group of board) {
      const { item } = group, height = 13 * weight(item), centerY = top + height / 2;
      const box = item.kind === "chafer" ? rect(37.5, centerY - 9, 25, 18) : centered(centerY, Math.min(28, height * 1.35));
      const suffix = group.instance === undefined ? "" : `-instance-${group.instance}`;
      addTarget(item, box, tableIndex, suffix);
      if (item.kind === "tortillas") {
        targets.pop();
        for (const [index, centerX] of [34, 66].entries()) { const warmer = centered(centerY, 16, centerX); addArt(`${item.id}-${index}`, 9, warmer, tableIndex); addTarget(item, warmer, tableIndex, index === 0 ? "-left" : "-right"); }
        if (group.pair) { const stands = centered(centerY, 12); addArt(group.pair.id, 10, stands, tableIndex); addTarget(group.pair, stands, tableIndex); }
      } else if (item.kind === "chafer") {
        const pans = (item.children ?? []).filter((child) => child.kind === "pan");
        addArt(item.id, pans[0]?.panSize === "1/2" ? 4 : 5, box, tableIndex);
        // Pan contents are identified through the containing dish or picker, not inferred from artwork.
        for (const [index, child] of (item.children ?? []).filter((entry) => entry.kind === "utensils").entries()) {
          const plate = rect(index === 0 ? 21.5 : 65.5, centerY - 6.5, 13, 13);
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
        addArt(`${item.id}${suffix}-plate`, 6, box, tableIndex, 90);
        const bowls = group.bowls ?? Array.from({ length: item.quantity ?? 0 }, () => item);
        const size = Math.min(7, box.width / Math.max(1, bowls.length));
        for (const [index, bowl] of bowls.entries()) {
          const instance = bowlInstances.get(bowl.id) ?? 0; bowlInstances.set(bowl.id, instance + 1);
          const bowlBox = centered(centerY, size, box.left + (index + .5) * box.width / bowls.length);
          addArt(`${bowl.id}-bowl-${instance}`, 15, bowlBox, tableIndex);
          addArt(`${bowl.id}-spoon-${instance}`, 8, rect(bowlBox.left + size * .2, bowlBox.top, size * .8), tableIndex);
          if (bowl.id !== item.id) addTarget(bowl, bowlBox, tableIndex, `-bowl-${instance}`);
        }
      } else {
        addArt(`${item.id}${suffix}-plate`, item.kind === "taco-stands" ? 10 : 6, box, tableIndex);
        for (const child of item.children ?? []) if (child.kind === "utensils") {
          const tools = rect(box.left + box.width * .1, box.top + box.height * .1, box.width * .8, box.height * .8);
          const toolTarget = rect(box.left + box.width * .65, box.top + box.height * .15, box.width * .3, box.height * .7);
          // These reference risers already picture their approved two tongs.
          if (item.kind === "lettuce-wraps" || item.id === "cold-platter-dessert") addTarget(child, toolTarget, tableIndex, suffix);
          else drawTools(child, tools, tableIndex, suffix, item.kind === "cold-platter" ? item.quantity ?? 1 : 1, item.kind === "cold-platter" ? toolTarget : tools);
        }
      }
      top += height;
    }
  }
  return { art, targets, crowded: boards.length > 1, tableCount: boards.length };
}
