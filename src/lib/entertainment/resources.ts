import type {
  EntertainmentCategory,
  EntertainmentResource,
} from "./types";

function numberedResources(
  category: EntertainmentCategory,
  prefix: string,
  count: number,
  startOrder: number,
) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${category}-${index + 1}`,
    canonicalName: `${prefix} ${index + 1}`,
    category,
    displayOrder: startOrder + index,
    active: true,
  })) satisfies EntertainmentResource[];
}

export const ENTERTAINMENT_RESOURCES: readonly EntertainmentResource[] = [
  ...numberedResources("bowling", "Bowling Lane", 12, 1),
  ...numberedResources("darts", "Dart Lane", 5, 101),
  ...numberedResources("pool", "Pool Table", 3, 201),
  ...numberedResources("shuffleboard", "Shuffleboard Table", 2, 301),
  {
    id: "mini-golf-level-up",
    canonicalName: "Level Up Mini Golf",
    category: "mini-golf",
    displayOrder: 351,
    active: true,
  },
  {
    id: "mini-golf-wild-axe",
    canonicalName: "Wild Axe Mini Golf",
    category: "mini-golf",
    displayOrder: 352,
    active: true,
  },
  {
    id: "mini-golf-great-escape",
    canonicalName: "Great Escape Mini Golf",
    category: "mini-golf",
    displayOrder: 353,
    active: true,
  },
  {
    id: "private-room-gem",
    canonicalName: "The Gem Room",
    category: "private-rooms",
    displayOrder: 401,
    active: true,
  },
  {
    id: "private-room-disco-inferno",
    canonicalName: "The Disco Inferno",
    category: "private-rooms",
    displayOrder: 402,
    active: true,
  },
  {
    id: "private-room-ocean",
    canonicalName: "The Ocean Room",
    category: "private-rooms",
    displayOrder: 403,
    active: true,
  },
  {
    id: "private-room-prime",
    canonicalName: "The Prime Room",
    category: "private-rooms",
    displayOrder: 404,
    active: true,
  },
  {
    id: "private-room-royal",
    canonicalName: "The Royal Room",
    category: "private-rooms",
    displayOrder: 405,
    active: true,
  },
  {
    id: "private-room-vip-1",
    canonicalName: "VIP 1",
    category: "private-rooms",
    displayOrder: 406,
    active: true,
  },
  {
    id: "private-room-vip-2",
    canonicalName: "VIP 2",
    category: "private-rooms",
    displayOrder: 407,
    active: true,
  },
  {
    id: "private-room-big-show",
    canonicalName: "The Big Show",
    category: "private-rooms",
    displayOrder: 408,
    active: true,
  },
] as const;

export const ENTERTAINMENT_CATEGORY_LABELS: Record<
  EntertainmentCategory,
  string
> = {
  bowling: "Bowling",
  darts: "Darts",
  pool: "Pool",
  shuffleboard: "Shuffleboard",
  "mini-golf": "Mini Golf",
  "private-rooms": "Private Rooms",
};

export const ENTERTAINMENT_SCHEDULE_CATEGORIES = [
  "bowling",
  "darts",
  "pool",
  "shuffleboard",
  "private-rooms",
] as const satisfies readonly EntertainmentCategory[];

export function isEntertainmentScheduleCategory(
  category: EntertainmentCategory,
) {
  return category !== "mini-golf";
}

const RESOURCE_BY_ID = new Map(
  ENTERTAINMENT_RESOURCES.map((resource) => [resource.id, resource]),
);

const PRIVATE_ROOM_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:the\s+)?gem(?:\s+room)?\b/i, "private-room-gem"],
  [/\b(?:the\s+)?disco\s+inferno(?:\s+room)?\b/i, "private-room-disco-inferno"],
  [/\b(?:the\s+)?ocean(?:\s+room)?\b/i, "private-room-ocean"],
  [/\b(?:the\s+)?prime(?:\s+room)?\b/i, "private-room-prime"],
  [/\b(?:the\s+)?royal(?:\s+room)?\b/i, "private-room-royal"],
  [/\bvip\s*(?:room\s*)?1\b/i, "private-room-vip-1"],
  [/\bvip\s*(?:room\s*)?2\b/i, "private-room-vip-2"],
  [/\b(?:the\s+)?big\s+show(?:\s+karaoke)?\b/i, "private-room-big-show"],
];

const MINI_GOLF_ALIASES: Array<[RegExp, string]> = [
  [/\blevel\s+up(?:\s+mini\s+golf)?\b/i, "mini-golf-level-up"],
  [/\bwild\s+axe(?:\s+mini\s+golf)?\b/i, "mini-golf-wild-axe"],
  [/\bgreat\s+escape(?:\s+mini\s+golf)?\b/i, "mini-golf-great-escape"],
];

const ACCESSIBLE_EVENT_COLORS = [
  "#0F766E",
  "#1D4ED8",
  "#7C3AED",
  "#B45309",
  "#BE123C",
  "#047857",
  "#4338CA",
  "#9F1239",
] as const;

export function getEntertainmentResource(resourceId: string) {
  return RESOURCE_BY_ID.get(resourceId) ?? null;
}

export function resourcesForCategory(category: EntertainmentCategory) {
  return ENTERTAINMENT_RESOURCES.filter(
    (resource) => resource.category === category,
  );
}

export function normalizeResourceText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function canonicalCategoryForText(
  value: string,
): EntertainmentCategory | null {
  const normalized = normalizeResourceText(value);
  if (
    /\b(?:duckpin\s+)?bowling\b/.test(normalized) ||
    /\bduckpin\s+lanes?\b/.test(normalized)
  ) {
    return "bowling";
  }
  if (/\bdarts?\b/.test(normalized) || /\bdart\s+(?:lanes?|boards?)\b/.test(normalized)) {
    return "darts";
  }
  if (
    /\bpool(?:\s+tables?)?\b/.test(normalized) ||
    /\bbilliards?\b/.test(normalized) ||
    /\bbilliard\s+tables?\b/.test(normalized)
  ) {
    return "pool";
  }
  if (
    /\bshuffleboard(?:\s+tables?)?\b/.test(normalized) ||
    /\bneo\s*shuffle(?:board)?\b/.test(normalized)
  ) {
    return "shuffleboard";
  }
  if (/\bmini\s+golf\b/.test(normalized) || /\bputt\s+putt\b/.test(normalized)) {
    return "mini-golf";
  }
  if (PRIVATE_ROOM_ALIASES.some(([pattern]) => pattern.test(value))) {
    return "private-rooms";
  }
  return null;
}

export function isAmbiguousLaneText(value: string) {
  const normalized = normalizeResourceText(value);
  return (
    /\blanes?\b/.test(normalized) &&
    canonicalCategoryForText(value) == null
  );
}

function numberRange(value: string, maximum: number) {
  const result: number[] = [];
  const pieces = value
    .replace(/\b(?:through|to)\b/gi, "-")
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const piece of pieces) {
    const range = piece.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      for (let number = start; number !== end + step; number += step) {
        if (number >= 1 && number <= maximum) {
          result.push(number);
        }
      }
      continue;
    }
    const number = Number(piece.match(/\d{1,2}/)?.[0]);
    if (number >= 1 && number <= maximum) {
      result.push(number);
    }
  }
  return [...new Set(result)];
}

function numberedResourceIds(
  value: string,
  category: Exclude<EntertainmentCategory, "private-rooms" | "mini-golf">,
) {
  const config: Record<
    Exclude<EntertainmentCategory, "private-rooms" | "mini-golf">,
    { pattern: RegExp; maximum: number }
  > = {
    bowling: {
      pattern:
        /\b(?:duckpin\s+)?bowling\s+lanes?\s*(?:#|no\.?\s*)?((?:\d{1,2}\s*(?:[-–,]|and|through|to)?\s*)+)/i,
      maximum: 12,
    },
    darts: {
      pattern:
        /\bdart\s+(?:lanes?|boards?)\s*(?:#|no\.?\s*)?((?:\d{1,2}\s*(?:[-–,]|and|through|to)?\s*)+)/i,
      maximum: 5,
    },
    pool: {
      pattern:
        /\b(?:pool|billiard)\s+tables?\s*(?:#|no\.?\s*)?((?:\d{1,2}\s*(?:[-–,]|and|through|to)?\s*)+)/i,
      maximum: 3,
    },
    shuffleboard: {
      pattern:
        /\b(?:neo\s*)?shuffle(?:board)?\s+tables?\s*(?:#|no\.?\s*)?((?:\d{1,2}\s*(?:[-–,]|and|through|to)?\s*)+)/i,
      maximum: 2,
    },
  };
  const match = value.match(config[category].pattern);
  return match
    ? numberRange(match[1], config[category].maximum).map(
        (number) => `${category}-${number}`,
      )
    : [];
}

export function exactResourceIdsForText(
  value: string,
  category = canonicalCategoryForText(value),
) {
  if (!category) {
    return [];
  }
  if (category === "mini-golf") {
    return MINI_GOLF_ALIASES.flatMap(([pattern, resourceId]) =>
      pattern.test(value) ? [resourceId] : [],
    );
  }
  if (category !== "private-rooms") {
    return numberedResourceIds(value, category);
  }
  return PRIVATE_ROOM_ALIASES.flatMap(([pattern, resourceId]) =>
    pattern.test(value) ? [resourceId] : [],
  );
}

export function quantityForText(
  value: string,
  category: EntertainmentCategory,
  structuredQuantity: number | null,
) {
  if (category === "mini-golf") {
    return exactResourceIdsForText(value, category).length || 1;
  }
  if (
    structuredQuantity != null &&
    Number.isInteger(structuredQuantity) &&
    structuredQuantity > 0
  ) {
    return structuredQuantity;
  }
  if (category === "private-rooms") {
    return exactResourceIdsForText(value, category).length || 1;
  }
  const nounPattern: Record<
    Exclude<EntertainmentCategory, "private-rooms" | "mini-golf">,
    string
  > = {
    bowling: "(?:duckpin\\s+)?(?:bowling\\s+)?lanes?",
    darts: "dart\\s+(?:lanes?|boards?)",
    pool: "(?:(?:pool|billiard)\\s+)?tables?",
    shuffleboard: "(?:(?:neo\\s*)?shuffle(?:board)?\\s+)?tables?",
  };
  const match = value.match(
    new RegExp(`\\b(\\d{1,2})\\s+${nounPattern[category]}\\b`, "i"),
  );
  return match ? Number(match[1]) : null;
}

export function deterministicEventColor(eventId: string) {
  let hash = 0;
  for (const character of eventId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return ACCESSIBLE_EVENT_COLORS[hash % ACCESSIBLE_EVENT_COLORS.length];
}

export function isHexColor(value: string | null | undefined) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function textColorForBackground(hex: string) {
  const normalized = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => {
    const value = Number.parseInt(normalized.slice(index, index + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.42 ? "#000000" : "#FFFFFF";
}
