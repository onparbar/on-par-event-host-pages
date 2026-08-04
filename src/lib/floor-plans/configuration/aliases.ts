const normalizeAlias = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export const AREA_ALIASES: Readonly<Record<string, string>> = {
  "vip 1": "vip-1",
  vip1: "vip-1",
  "vip room 1": "vip-1",
  "vip section 1": "vip-1",
  "vip 2": "vip-2",
  vip2: "vip-2",
  "vip room 2": "vip-2",
  "vip section 2": "vip-2",
  "main dining": "main-dining",
  "main dining room": "main-dining",
  "main dining area": "main-dining",
  "wat tables": "wat-tables",
  "wild axe tables": "wat-tables",
  "wild axe throwing tables": "wat-tables",
  "geg tables": "geg-tables",
  "great escape tables": "geg-tables",
  "big show": "big-show-karaoke",
  "the big show": "big-show-karaoke",
  "big show karaoke": "big-show-karaoke",
  "gem room": "gem-room",
  "the gem room": "gem-room",
  "ocean room": "ocean-room",
  "the ocean room": "ocean-room",
  "disco room": "disco-room",
  "disco inferno": "disco-room",
  "the disco inferno": "disco-room",
  "royal room": "royal-room",
  "the royal room": "royal-room",
  "prime room": "prime-room",
  "the prime room": "prime-room",
  clubhouse: "clubhouse",
  "the clubhouse": "clubhouse",
  patio: "patio-reserved",
  "full building buyout": "facility",
  "full facility buyout": "facility",
  "entire building": "facility",
};

export const ENTERTAINMENT_ALIASES: Readonly<Record<string, string>> = {
  bowling: "bowling",
  "duckpin bowling": "bowling",
  "bowling lane": "bowling",
  "bowling lanes": "bowling",
  darts: "darts",
  "dart lane": "darts",
  "dart lanes": "darts",
  pool: "pool",
  "pool table": "pool",
  "pool tables": "pool",
  shuffleboard: "shuffleboard",
  "shuffle board": "shuffleboard",
  "neo shuffleboard": "shuffleboard",
  "mini golf": "mini-golf",
  "putt putt": "mini-golf",
};

export function resolveAreaAlias(value: string) {
  return AREA_ALIASES[normalizeAlias(value)] ?? null;
}

export function resolveEntertainmentAlias(value: string) {
  return ENTERTAINMENT_ALIASES[normalizeAlias(value)] ?? null;
}
