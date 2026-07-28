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
  events?: string[];
};

const baseEvents = (eventPlanData as { events: EventPlan[] }).events;

const eventOverrides: Record<number, Partial<EventPlan>> = {
  61072003: {
    entertainment: [
      {
        name: "Darts",
        quantity: "2 lanes",
        time: "Time not listed on BEO",
        duration: "2 hours",
      },
      {
        name: "Duckpin Bowling",
        quantity: "3 lanes",
        time: "5:30 PM - 7:30 PM",
        duration: "2 hours",
      },
      {
        name: "Mini Golf",
        quantity: "10 guests",
        time: "Untimed",
        duration: "9 holes",
      },
    ],
    special_instructions: [
      "Main Dining Room is listed in the current BEO event summary.",
      "Floor plan uses 7 total tables including the food table: the 3 tables above the current food table plus the 3 GEG tables.",
      "Bowling moved to lanes 10-12 from 5:30 PM - 7:30 PM.",
    ],
    verification_status:
      "Host update applied: floor plan reduced to 7 tables including food; bowling moved to lanes 10-12 from 5:30 PM - 7:30 PM.",
  },
};

const hostedOnlyEvents: EventPlan[] = [
  {
    id: 58984337,
    name: "Fanning Howey (corporate anniversary/work outing)",
    date: "2026-07-17",
    day: "Friday",
    time: "6:00 PM - 12:00 AM",
    guest_count: 190,
    rooms: ["Full Building Buyout", "Main Dining Room", "Big Show"],
    color: "#2f8f46",
    food: [
      "The Full Course | TACO BAR - Food + Beverage + Cookies",
      "Wing Platter",
      "Fry Platter",
    ],
    drink_options: [
      "Food + Beverage package",
      "Soft drinks included",
      "Big Show private self-pour taps",
    ],
    entertainment: [
      {
        name: "Darts",
        quantity: "5 lanes",
        time: "6:00 PM - 12:00 AM",
        duration: "6 hours",
      },
      {
        name: "Duckpin Bowling",
        quantity: "12 lanes",
        time: "6:00 PM - 12:00 AM",
        duration: "6 hours",
      },
      {
        name: "Mini Golf",
        quantity: "250 guests",
        time: "6:00 PM - 12:00 AM",
        duration: "9 holes",
      },
      {
        name: "Pool Tables",
        quantity: "3 tables",
        time: "6:00 PM - 12:00 AM",
        duration: "6 hours",
      },
      {
        name: "Neo Shuffleboard",
        quantity: "2 lanes",
        time: "6:00 PM - 12:00 AM",
        duration: "6 hours",
      },
      {
        name: "The Big Show",
        quantity: "1 private space",
        time: "6:00 PM - 12:00 AM",
        duration: "6 hours",
      },
      {
        name: "Karaoke Rooms",
        quantity: "5 rooms",
        time: "6:00 PM - 12:00 AM",
        duration: "6 hours",
      },
    ],
    special_instructions: [
      "5:00 PM - 6:00 PM setup uses 3 tables for school supplies and backpack assembly.",
      "Entire building reserved from 6:00 PM - 1:00 AM per BEO special instructions.",
      "Food quantity on the BEO is 250 while the event summary guest count is 190.",
      "Floor plan food setup uses both VIP food tables.",
    ],
    verification_status:
      "BEO checked above billing section; event is treated as a full-building buyout; entertainment timing set to 6:00 PM - 12:00 AM per latest host update.",
  },
];

const mergedBaseEvents = baseEvents.map((event) => (eventOverrides[event.id] ? { ...event, ...eventOverrides[event.id] } : event));

export const events = [...mergedBaseEvents, ...hostedOnlyEvents].sort((a, b) => {
  const timeA = new Date(`${a.date}T12:00:00Z`).getTime();
  const timeB = new Date(`${b.date}T12:00:00Z`).getTime();
  if (timeA !== timeB) return timeA - timeB;
  return a.time.localeCompare(b.time) || a.name.localeCompare(b.name);
});

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
  "2026-07-17": { image: "/floor-plans/july-17-fanning-howey.png" },
  "2026-07-19": { image: "/floor-plans/july-19-husbands-60th-birthday.png" },
  "2026-07-21": { image: "/floor-plans/july-21-key-sight.png" },
  "2026-07-22": { image: "/floor-plans/july-22-north-dayton-school-of-discovery.png" },
  "2026-07-23": { image: "/floor-plans/july-23-floor-plans.png" },
  "2026-07-24": {
    image: "/floor-plans/july-24-sizzlin-summer-singles-mixer.png",
    events: ["Sizzlin' Summer Singles Mixer"],
  },
  "2026-07-25": { image: "/floor-plans/july-25-floor-plans.png" },
  "2026-07-29": { image: "/floor-plans/july-29-work-outing-networking.png" },
  "2026-07-30": { image: "/floor-plans/july-30-university-of-dayton-edd-program.png" },
  "2026-08-06": { image: "/floor-plans/august-06-floor-plans.png" },
  "2026-08-07": { image: "/floor-plans/august-07-floor-plans.png" },
  "2026-08-08": { image: "/floor-plans/august-08-thompson-hine-dayton-summer-picnic.png" },
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
    source: "Tripleseat BEO/API pull July 14, 2026",
  },
  "2026-07-15": {
    image: "/entertainment-schedules/july-15-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 14, 2026",
  },
  "2026-07-17": {
    image: "/entertainment-schedules/july-17-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 17, 2026; full-building buyout host update",
  },
  "2026-07-19": {
    image: "/entertainment-schedules/july-19-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 14, 2026",
  },
  "2026-07-21": {
    image: "/entertainment-schedules/july-21-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 17, 2026",
  },
  "2026-07-22": {
    image: "/entertainment-schedules/july-22-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 21, 2026; Motility guest count updated to 20 and Motility entertainment times are still missing on the BEO",
  },
  "2026-07-23": {
    image: "/entertainment-schedules/july-23-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 21, 2026; GS1 desserts and special instructions updated",
  },
  "2026-07-24": {
    image: "/entertainment-schedules/july-24-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 24, 2026; Sizzlin' Summer Singles Mixer guest count updated to 24",
  },
  "2026-07-25": {
    image: "/entertainment-schedules/july-25-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 21, 2026; Michael's bowling and darts quantities updated and entertainment times are still missing on the BEO",
  },
  "2026-07-29": {
    image: "/entertainment-schedules/july-29-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 24, 2026; Winsupply bowling now runs 6:00 PM - 7:00 PM and Neo Shuffleboard timing is still missing on the BEO",
  },
  "2026-07-30": {
    image: "/entertainment-schedules/july-30-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 24, 2026; 178th Force Support Squadron entertainment now runs 12:00 PM - 2:00 PM",
  },
  "2026-08-06": {
    image: "/entertainment-schedules/august-06-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 24, 2026; two August 6 events added and entertainment start times are missing or unclear on both BEOs",
  },
  "2026-08-07": {
    image: "/entertainment-schedules/august-07-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 28, 2026; two August 7 events added and entertainment start times are not listed on either BEO",
  },
  "2026-08-08": {
    image: "/entertainment-schedules/august-08-entertainment-schedule.png",
    source: "Tripleseat BEO/API pull July 28, 2026; Thompson Hine Dayton Summer Picnic added and entertainment start times are not listed on the current BEO",
  },
};

function buildDateAssets(configByDate: Record<string, DateConfig>): DateAsset[] {
  return Object.entries(configByDate).map(([date, config]) => ({
    date,
    label: dateLabel(date),
    image: config.image,
    events: config.events ?? events.filter((event) => event.date === date).map((event) => event.name),
    source: config.source,
  }));
}

export const itineraries: ItineraryAsset[] = events.map((event) => ({
  ...event,
  pdf: itineraryPdfPath(event),
}));

export const floorPlans: DateAsset[] = buildDateAssets(floorPlanByDate);

export const floorPlanSpecialPages: DateAsset[] = [
  {
    date: "2026-07-25",
    label: "Saturday, July 25, 2026",
    image: "/floor-plans/july-25-christmas-in-july.png",
    events: ["Christmas in July"],
    source: "Saturday special page kept separate from the July 25 event floor map",
  },
];

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
