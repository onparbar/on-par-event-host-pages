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

export const events = (eventPlanData as { events: EventPlan[] }).events;

export const floorPlans: DateAsset[] = [
  {
    date: "2026-06-09",
    label: "Tuesday, June 9, 2026",
    image: "/floor-plans/june-09-greentree.png",
    events: ["The Greentree Group Leadership Event"],
  },
  {
    date: "2026-06-12",
    label: "Friday, June 12, 2026",
    image: "/floor-plans/june-12-oasis.png",
    events: ["Oasis Turf & Tree employee outing"],
  },
  {
    date: "2026-06-13",
    label: "Saturday, June 13, 2026",
    image: "/floor-plans/june-13-graduation-party.png",
    events: ["Graduation Party"],
  },
  {
    date: "2026-06-14",
    label: "Sunday, June 14, 2026",
    image: "/floor-plans/june-14-ope-employee-appreciation-patio-party.png",
    events: ["OPE Employee Appreciation Patio Party"],
  },
  {
    date: "2026-06-20",
    label: "Saturday, June 20, 2026",
    image: "/floor-plans/june-20-floor-plans.png",
    events: ["Emily's bachelorette party", "CJ 20th reunion", "CJA CLASS OF 2016 10 yr reunion meet up"],
  },
  {
    date: "2026-06-24",
    label: "Wednesday, June 24, 2026",
    image: "/floor-plans/june-24-floor-plans.png",
    events: ["Expo Experts", "Sydney Lance"],
  },
  {
    date: "2026-06-25",
    label: "Thursday, June 25, 2026",
    image: "/floor-plans/june-25-space-force.png",
    events: ["Space Force"],
  },
];

export const entertainmentSchedules: DateAsset[] = [
  {
    date: "2026-05-30",
    label: "Saturday, May 30, 2026",
    image: "/entertainment-schedules/may-30-entertainment-schedule.png",
    events: ["Joe's 75th Surprise Bday", "Creative Foam"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-05-31",
    label: "Sunday, May 31, 2026",
    image: "/entertainment-schedules/may-31-entertainment-schedule.png",
    events: ["Connie McFarren Grad Party", "AJ & Alan Faulkner Graduation Party"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-06-05",
    label: "Friday, June 5, 2026",
    image: "/entertainment-schedules/june-05-entertainment-schedule.png",
    events: ["Keep Smiling Dental"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-06-06",
    label: "Saturday, June 6, 2026",
    image: "/entertainment-schedules/june-06-entertainment-schedule.png",
    events: ["Heather Sommer"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-06-07",
    label: "Sunday, June 7, 2026",
    image: "/entertainment-schedules/june-07-entertainment-schedule.png",
    events: ["Worthwhile State Sales"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-06-09",
    label: "Tuesday, June 9, 2026",
    image: "/entertainment-schedules/june-09-entertainment-schedule.png",
    events: ["The Greentree Group Leadership Event"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-06-12",
    label: "Friday, June 12, 2026",
    image: "/entertainment-schedules/june-12-entertainment-schedule.png",
    events: ["Oasis Turf & Tree employee outing"],
    source: "Linked schedule thread, latest staggered update",
  },
  {
    date: "2026-06-13",
    label: "Saturday, June 13, 2026",
    image: "/entertainment-schedules/june-13-entertainment-schedule.png",
    events: ["Graduation Party"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-06-14",
    label: "Sunday, June 14, 2026",
    image: "/entertainment-schedules/june-14-entertainment-schedule.png",
    events: ["OPE Employee Appreciation Patio Party"],
    source: "Tripleseat BEO pulled June 9, 2026",
  },
  {
    date: "2026-06-20",
    label: "Saturday, June 20, 2026",
    image: "/entertainment-schedules/june-20-entertainment-schedule.png",
    events: ["Emily's bachelorette party", "CJ 20th reunion", "CJA CLASS OF 2016 10 yr reunion meet up"],
    source: "Current EVENTS workspace data",
  },
  {
    date: "2026-06-24",
    label: "Wednesday, June 24, 2026",
    image: "/entertainment-schedules/june-24-entertainment-schedule.png",
    events: ["Sydney Lance"],
    source: "Linked schedule thread",
  },
  {
    date: "2026-06-25",
    label: "Thursday, June 25, 2026",
    image: "/entertainment-schedules/june-25-entertainment-schedule.png",
    events: ["Space Force"],
    source: "Linked schedule thread",
  },
];

export function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
