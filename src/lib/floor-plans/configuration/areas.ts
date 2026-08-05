import type { FloorPlanArea, FloorPlanAreaType } from "../types";

type AreaInput = Omit<
  FloorPlanArea,
  "capacity" | "isAda" | "canBeFoodTable" | "isReservable" | "isMovable"
> &
  Partial<
    Pick<
      FloorPlanArea,
      "capacity" | "isAda" | "canBeFoodTable" | "isReservable" | "isMovable"
    >
  >;

function area(input: AreaInput): FloorPlanArea {
  return {
    capacity: 0,
    isAda: false,
    canBeFoodTable: false,
    isReservable: true,
    isMovable: false,
    ...input,
  };
}

function rectangleTable(
  id: string,
  name: string,
  parentAreaId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  shortLabel = "",
) {
  return area({
    id,
    name,
    shortLabel,
    type: "rectangle-table",
    capacity: 8,
    parentAreaId,
    x,
    y,
    width,
    height,
  });
}

function squareTable(
  id: string,
  name: string,
  parentAreaId: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return area({
    id,
    name,
    shortLabel: "",
    type: "square-table",
    capacity: 4,
    parentAreaId,
    x,
    y,
    width,
    height,
  });
}

function foodTable(
  id: string,
  name: string,
  parentAreaId: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return area({
    id,
    name,
    shortLabel: "F",
    type: "rectangle-table",
    parentAreaId,
    x,
    y,
    width,
    height,
    isAda: true,
    canBeFoodTable: true,
  });
}

function entertainmentArea(
  id: string,
  name: string,
  type: Extract<
    FloorPlanAreaType,
    "bowling" | "darts" | "pool" | "shuffleboard" | "mini-golf" | "room"
  >,
  entertainmentResourceId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  shortLabel: string,
) {
  return area({
    id,
    name,
    shortLabel,
    type,
    entertainmentResourceId,
    x,
    y,
    width,
    height,
  });
}

const baseAreas: FloorPlanArea[] = [
  area({ id: "facility", name: "Entire Facility", shortLabel: "FULL BUYOUT", type: "room", x: 600, y: 0, width: 1100, height: 1080 }),
  area({ id: "main-dining", name: "Main Dining", shortLabel: "MAIN DINING", type: "seating-section", x: 1070, y: 720, width: 300, height: 210 }),
  area({ id: "wat-tables", name: "WAT Tables", shortLabel: "WAT", type: "seating-section", x: 970, y: 410, width: 70, height: 130 }),
  area({ id: "geg-tables", name: "GEG Tables", shortLabel: "GEG", type: "seating-section", x: 910, y: 840, width: 150, height: 125 }),
  area({ id: "level-up-seating", name: "Level Up Tables", shortLabel: "LEVEL UP", type: "seating-section", x: 675, y: 345, width: 285, height: 65 }),
  entertainmentArea("big-show-karaoke", "The Big Show", "room", "private-room-big-show", 933, 78, 291, 142, "BIG SHOW"),
  entertainmentArea("disco-room", "The Disco Inferno", "room", "private-room-disco-inferno", 933, 0, 107, 67, "DISCO"),
  entertainmentArea("prime-room", "The Prime Room", "room", "private-room-prime", 1131, 0, 96, 57, "PRIME"),
  entertainmentArea("royal-room", "The Royal Room", "room", "private-room-royal", 1245, 0, 96, 34, "ROYAL"),
  entertainmentArea("gem-room", "The Gem Room", "room", "private-room-gem", 1237, 57, 97, 89, "GEM"),
  entertainmentArea("ocean-room", "The Ocean Room", "room", "private-room-ocean", 1237, 156, 96, 65, "OCEAN"),
  entertainmentArea("pool-1", "Pool Table 1", "pool", "pool-1", 979, 264, 39, 64, "1"),
  entertainmentArea("pool-2", "Pool Table 2", "pool", "pool-2", 1032, 264, 39, 64, "2"),
  entertainmentArea("pool-3", "Pool Table 3", "pool", "pool-3", 1079, 264, 39, 64, "3"),
  entertainmentArea("shuffleboard-1", "Shuffleboard Table 1", "shuffleboard", "shuffleboard-1", 1251, 221, 22, 107, "1"),
  entertainmentArea("shuffleboard-2", "Shuffleboard Table 2", "shuffleboard", "shuffleboard-2", 1305, 221, 22, 107, "2"),
  entertainmentArea("level-up-mini-golf", "Level Up Mini Golf", "mini-golf", "mini-golf-level-up", 690, 487, 164, 42, "MINI GOLF"),
  entertainmentArea("wild-axe-mini-golf", "Wild Axe Mini Golf", "mini-golf", "mini-golf-wild-axe", 730, 719, 164, 42, "MINI GOLF"),
  entertainmentArea("great-escape-mini-golf", "Great Escape Mini Golf", "mini-golf", "mini-golf-great-escape", 622, 818, 164, 41, "MINI GOLF"),
  entertainmentArea("vip-1", "VIP 1", "room", "private-room-vip-1", 1072, 544, 120, 80, "VIP 1"),
  entertainmentArea("vip-2", "VIP 2", "room", "private-room-vip-2", 1197, 544, 136, 80, "VIP 2"),
  rectangleTable("vip1-extra-front-1", "VIP 1 Extra Table 1", "vip-1", 1049, 391, 18, 50),
  rectangleTable("vip1-extra-front-2", "VIP 1 Extra Table 2", "vip-1", 1094, 391, 18, 50),
  rectangleTable("vip1-extra-front-3", "VIP 1 Extra Table 3", "vip-1", 1052, 456, 15, 44),
  rectangleTable("vip1-extra-front-4", "VIP 1 Extra Table 4", "vip-1", 1097, 455, 15, 45),
  area({ id: "vip1-conversation-wall", name: "VIP 1 Conversation Wall", shortLabel: "CONVO", type: "seating-section", parentAreaId: "vip-1", x: 1163, y: 397, width: 88, height: 44 }),
  area({ id: "vip1-extra-convo", name: "VIP 1 Conversation Seating", shortLabel: "VIP 1", type: "seating-section", parentAreaId: "vip-1", x: 1164, y: 448, width: 87, height: 52 }),
  foodTable("vip1-food-table", "VIP 1 ADA Food Table", "vip-1", 1119, 508, 68, 25),
  foodTable("vip2-food-table", "VIP 2 ADA Food Table", "vip-2", 1217, 508, 68, 22),
  rectangleTable("vip2-extra-bowling-table", "VIP 2 Extra Table", "vip-2", 1320, 488, 56, 21),
  rectangleTable("main-rect-left-1", "Main Dining Table L1", "main-dining", 1084, 758, 55, 19),
  rectangleTable("main-rect-left-2", "Main Dining Table L2", "main-dining", 1081, 797, 55, 19),
  rectangleTable("main-rect-left-3", "Main Dining Table L3", "main-dining", 1084, 836, 55, 19),
  rectangleTable("main-rect-left-4", "Main Dining Table L4", "main-dining", 1081, 874, 56, 20),
  rectangleTable("main-rect-center-1", "Main Dining Table C1", "main-dining", 1196, 755, 19, 55),
  rectangleTable("main-rect-center-2", "Main Dining Table C2", "main-dining", 1251, 755, 19, 55),
  rectangleTable("main-rect-right-1", "Main Dining Table R1", "main-dining", 1296, 791, 55, 19),
  rectangleTable("main-rect-right-2", "Main Dining Table R2", "main-dining", 1296, 830, 55, 19),
  rectangleTable("main-rect-right-3", "Main Dining Table R3", "main-dining", 1296, 870, 55, 19),
  area({ id: "main-convo-1", name: "Main Dining Conversation Wall 1", shortLabel: "CONVO", type: "seating-section", parentAreaId: "main-dining", x: 1187, y: 833, width: 75, height: 33 }),
  area({ id: "main-convo-2", name: "Main Dining Conversation Wall 2", shortLabel: "CONVO", type: "seating-section", parentAreaId: "main-dining", x: 1186, y: 874, width: 74, height: 33 }),
  area({ id: "main-round-left", name: "Main Dining Round Table 1", shortLabel: "", type: "service-area", parentAreaId: "main-dining", x: 1148, y: 737, width: 28, height: 26, isReservable: false }),
  area({ id: "main-round-center", name: "Main Dining Round Table 2", shortLabel: "", type: "service-area", parentAreaId: "main-dining", x: 1292, y: 737, width: 28, height: 26, isReservable: false }),
  area({ id: "main-round-right", name: "Main Dining Round Table 3", shortLabel: "", type: "service-area", parentAreaId: "main-dining", x: 1337, y: 740, width: 27, height: 26, isReservable: false }),
  rectangleTable("ge-table-1", "GEG Table 1", "geg-tables", 916, 850, 55, 19, "GEG"),
  rectangleTable("ge-table-2", "GEG Table 2", "geg-tables", 916, 884, 55, 19, "GEG"),
  rectangleTable("ge-table-3", "GEG Table 3", "geg-tables", 916, 919, 55, 19, "GEG"),
  foodTable("ge-food-table", "GEG ADA Food Table", "geg-tables", 990, 934, 62, 25),
  squareTable("level-up-square-1", "Level Up Square Table 1", "level-up-seating", 685, 356, 16, 15),
  squareTable("level-up-square-2", "Level Up Square Table 2", "level-up-seating", 729, 356, 16, 15),
  squareTable("level-up-square-3", "Level Up Square Table 3", "level-up-seating", 784, 356, 16, 15),
  squareTable("level-up-square-4", "Level Up Square Table 4", "level-up-seating", 838, 356, 16, 15),
  squareTable("level-up-square-5", "Level Up Square Table 5", "level-up-seating", 887, 356, 16, 15),
  squareTable("level-up-square-6", "Level Up Square Table 6", "level-up-seating", 938, 376, 16, 15),
  area({ id: "darts-convo", name: "Darts Conversation Wall", shortLabel: "DARTS", type: "seating-section", x: 1382, y: 904, width: 54, height: 36 }),
  foodTable("karaoke-food", "Big Show ADA Food Table 1", "big-show-karaoke", 1138, 184, 48, 30),
  foodTable("karaoke-food-2", "Big Show ADA Food Table 2", "big-show-karaoke", 1188, 184, 48, 30),
  area({ id: "patio-reserved", name: "Patio", shortLabel: "PATIO", type: "room", x: 1010, y: 965, width: 460, height: 110 }),
  foodTable("main-food-1", "Main Dining ADA Food Table 1", "main-dining", 1082, 895, 58, 22),
  foodTable("main-food-2", "Main Dining ADA Food Table 2", "main-dining", 1295, 895, 58, 22),
  area({ id: "clubhouse", name: "The Clubhouse", shortLabel: "CLUBHOUSE", type: "room", x: 664, y: 0, width: 252, height: 180 }),
  rectangleTable("wat-table-1", "WAT Table 1", "wat-tables", 976, 423, 55, 19, "WAT"),
  rectangleTable("wat-table-2", "WAT Table 2", "wat-tables", 976, 475, 55, 19, "WAT"),
  rectangleTable("wat-table-3", "WAT Table 3", "wat-tables", 976, 523, 55, 19, "WAT"),
];

const bowlingRows: Record<number, [number, number, number, number]> = {
  1: [1466, 424, 103, 29], 2: [1466, 457, 103, 29], 3: [1466, 497, 103, 29], 4: [1466, 530, 103, 29],
  5: [1466, 575, 103, 29], 6: [1466, 609, 103, 29], 7: [1466, 649, 103, 29], 8: [1466, 682, 103, 30],
  9: [1466, 722, 103, 29], 10: [1466, 755, 103, 29], 11: [1466, 796, 103, 29], 12: [1466, 828, 103, 31],
};

const dartRows: Record<number, [number, number, number, number]> = {
  1: [1507, 894, 67, 24], 2: [1507, 937, 67, 24], 3: [1507, 980, 67, 24], 4: [1507, 1016, 67, 24], 5: [1507, 1055, 67, 24],
};

export const AREAS: readonly FloorPlanArea[] = [
  ...baseAreas,
  ...Object.entries(bowlingRows).map(([number, [x, y, width, height]]) =>
    entertainmentArea(`bowling-${number}`, `Bowling Lane ${number}`, "bowling", `bowling-${number}`, x, y, width, height, number),
  ),
  ...Object.entries(dartRows).map(([number, [x, y, width, height]]) =>
    entertainmentArea(`darts-${number}`, `Dart Lane ${number}`, "darts", `darts-${number}`, x, y, width, height, number),
  ),
] as const;

const AREA_BY_ID = new Map(AREAS.map((item) => [item.id, item]));
const AREA_BY_ENTERTAINMENT_RESOURCE = new Map(
  AREAS.flatMap((item) =>
    item.entertainmentResourceId
      ? [[item.entertainmentResourceId, item] as const]
      : [],
  ),
);

const FIXED_SEATING_HIGHLIGHTS_BY_AREA: Record<string, readonly string[]> = {
  "vip-1": ["vip1-conversation-wall", "vip1-extra-convo"],
};

export function getFloorPlanArea(areaId: string) {
  return AREA_BY_ID.get(areaId) ?? null;
}

export function getAreaForEntertainmentResource(resourceId: string) {
  return AREA_BY_ENTERTAINMENT_RESOURCE.get(resourceId) ?? null;
}

export function seatingTablesForArea(areaId: string) {
  return AREAS.filter(
    (item) =>
      item.parentAreaId === areaId &&
      (item.type === "rectangle-table" || item.type === "square-table") &&
      !item.canBeFoodTable,
  );
}

export function fixedSeatingHighlightsForArea(areaId: string) {
  return (FIXED_SEATING_HIGHLIGHTS_BY_AREA[areaId] ?? []).flatMap((id) => {
    const item = getFloorPlanArea(id);
    return item ? [item] : [];
  });
}

export function foodTablesNearArea(areaId: string) {
  const direct = AREAS.filter(
    (item) => item.canBeFoodTable && item.parentAreaId === areaId,
  );
  return direct.length
    ? direct
    : AREAS.filter((item) => item.canBeFoodTable).sort((left, right) => {
        const parent = getFloorPlanArea(areaId);
        if (!parent) return left.id.localeCompare(right.id);
        const distance = (item: FloorPlanArea) =>
          Math.hypot(
            item.x + item.width / 2 - (parent.x + parent.width / 2),
            item.y + item.height / 2 - (parent.y + parent.height / 2),
          );
        return distance(left) - distance(right);
      });
}
