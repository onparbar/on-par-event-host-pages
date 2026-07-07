import eventPlanData from "../../public/data/event-plan-data.json";

export type EventPlan = {
  id: number;
  name: string;
  date: string;
  day: string;
  time: string;
  guest_count: number;
  rooms: string[];
  color: string;
  food: string[];
  drink_options: string[];
  entertainment: Array<{
    name: string;
    quantity: string;
    time: string;
    duration: string;
  }>;
  special_instructions?: string[];
  verification_status: string;
};

export type DateAsset = {
  date: string;
  label: string;
  image: string;
  events: string[];
  source?: string;
};

export type ItineraryAsset = EventPlan & {
  pdf: string;
};

type DateConfig = {
  image: string;
  source?: string;
};

export const events = (eventPlanData as { events: EventPlan[] }).events;

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function itineraryPdfPath(event: EventPlan) {
  return `/itinerary-pdfs/${event.date}-${slugify(event.name)}.pdf`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

const floorPlanByDate: Record<string, DateConfig> = {
  "2026-06-25": { image: "/floor-plans/june-25-floor-plans.png" },
  "2026-07-02": { image: "/floor-plans/july-02-gaf-partners-meeting.png" },
  "2026-07-07": { image: "/floor-plans/july-07-work-event-for-30-co-workers.png" },
  "2026-07-09": { image: "/floor-plans/july-09-lexisnexis-government-markets-meeting.png" },
  "2026-07-10": { image: "/floor-plans/july-10-floor-plans.png" },
  "2026-07-14": { image: "/floor-plans/july-14-jennifer-nicholson.png" },
  "2026-07-15": { image: "/floor-plans/july-15-lexisnexis.png" },
  "2026-07-19": { image: "/floor-plans/july-19-husbands-60th-birthday.png" },
  "2026-07-21": { image: "/floor-plans/july-21-beacon-investing.png" },
  "2026-07-22": { image: "/floor-plans/july-22-north-dayton-school-of-discovery.png" },
  "2026-07-23": { image: "/floor-plans/july-23-floor-plans.png" },
};

const entertainmentScheduleByDate: Record<string, DateConfig> = {
  "2026-06-25": {
    image: "/entertainment-schedules/june-25-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull June 25, 2026",
  },
  "2026-07-02": {
    image: "/entertainment-schedules/july-02-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull June 2, 2026; moved to July 2, 2026 per request",
  },
  "2026-07-07": {
    image: "/entertainment-schedules/july-07-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 7, 2026",
  },
  "2026-07-09": {
    image: "/entertainment-schedules/july-09-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 7, 2026",
  },
  "2026-07-10": {
    image: "/entertainment-schedules/july-10-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 7, 2026",
  },
  "2026-07-14": {
    image: "/entertainment-schedules/july-14-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull June 25, 2026",
  },
  "2026-07-15": {
    image: "/entertainment-schedules/july-15-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 7, 2026",
  },
  "2026-07-19": {
    image: "/entertainment-schedules/july-19-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 7, 2026",
  },
  "2026-07-21": {
    image: "/entertainment-schedules/july-21-entertainment-schedule.png",
    source: "Tripleseat API pull June 25, 2026; no BEO view returned",
  },
  "2026-07-22": {
    image: "/entertainment-schedules/july-22-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull June 25, 2026",
  },
  "2026-07-23": {
    image: "/entertainment-schedules/july-23-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull June 25, 2026",
  },
};

function buildDateAssets(configByDate: Record<string, DateConfig>): DateAsset[] {
  return Object.entries(configByDate).map(([date, config]) => ({
    date,
    label: dateLabel(date),
    image: config.image,
    events: events.filter((event) => event.date === date).map((event) => event.name),
    source: config.source,
  }));
}

export const itineraries: ItineraryAsset[] = events.map((event) => ({
  ...event,
  pdf: itineraryPdfPath(event),
}));

export const floorPlans: DateAsset[] = buildDateAssets(floorPlanByDate);

export const entertainmentSchedules: DateAsset[] = buildDateAssets(entertainmentScheduleByDate);

export function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
