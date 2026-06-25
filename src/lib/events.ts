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
    "date": "2026-06-25",
    "label": "Thursday, June 25, 2026",
    "image": "/floor-plans/june-25-floor-plans.png",
    "events": [
      "Lowes MST Team",
      "Space Force"
    ]
  },
  {
    "date": "2026-07-07",
    "label": "Tuesday, July 7, 2026",
    "image": "/floor-plans/july-07-work-event-for-30-co-workers.png",
    "events": [
      "Work event for 30 co-workers"
    ]
  },
  {
    "date": "2026-07-09",
    "label": "Thursday, July 9, 2026",
    "image": "/floor-plans/july-09-lexisnexis-government-markets-meeting.png",
    "events": [
      "LexisNexis Government Markets Meeting"
    ]
  },
  {
    "date": "2026-07-10",
    "label": "Friday, July 10, 2026",
    "image": "/floor-plans/july-10-floor-plans.png",
    "events": [
      "Oculii",
      "Core4ce"
    ]
  },
  {
    "date": "2026-07-14",
    "label": "Tuesday, July 14, 2026",
    "image": "/floor-plans/july-14-jennifer-nicholson.png",
    "events": [
      "Jennifer Nicholson"
    ]
  },
  {
    "date": "2026-07-15",
    "label": "Wednesday, July 15, 2026",
    "image": "/floor-plans/july-15-lexisnexis.png",
    "events": [
      "LexisNexis 07/15/2026"
    ]
  },
  {
    "date": "2026-07-19",
    "label": "Sunday, July 19, 2026",
    "image": "/floor-plans/july-19-husbands-60th-birthday.png",
    "events": [
      "Husband's 60th birthday"
    ]
  },
  {
    "date": "2026-07-21",
    "label": "Tuesday, July 21, 2026",
    "image": "/floor-plans/july-21-beacon-investing.png",
    "events": [
      "Beacon Investing"
    ]
  },
  {
    "date": "2026-07-22",
    "label": "Wednesday, July 22, 2026",
    "image": "/floor-plans/july-22-north-dayton-school-of-discovery.png",
    "events": [
      "North Dayton School of Discovery Staff Engagement Event."
    ]
  },
  {
    "date": "2026-07-23",
    "label": "Thursday, July 23, 2026",
    "image": "/floor-plans/july-23-floor-plans.png",
    "events": [
      "Danis 07/23/2026",
      "GS1"
    ]
  }
];

export const entertainmentSchedules: DateAsset[] = [
  {
    "date": "2026-06-25",
    "label": "Thursday, June 25, 2026",
    "image": "/entertainment-schedules/june-25-entertainment-schedule.png",
    "events": [
      "Lowes MST Team",
      "Space Force"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-07",
    "label": "Tuesday, July 7, 2026",
    "image": "/entertainment-schedules/july-07-entertainment-schedule.png",
    "events": [
      "Work event for 30 co-workers"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-09",
    "label": "Thursday, July 9, 2026",
    "image": "/entertainment-schedules/july-09-entertainment-schedule.png",
    "events": [
      "LexisNexis Government Markets Meeting"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-10",
    "label": "Friday, July 10, 2026",
    "image": "/entertainment-schedules/july-10-entertainment-schedule.png",
    "events": [
      "Oculii",
      "Core4ce"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-14",
    "label": "Tuesday, July 14, 2026",
    "image": "/entertainment-schedules/july-14-entertainment-schedule.png",
    "events": [
      "Jennifer Nicholson"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-15",
    "label": "Wednesday, July 15, 2026",
    "image": "/entertainment-schedules/july-15-entertainment-schedule.png",
    "events": [
      "LexisNexis 07/15/2026"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-19",
    "label": "Sunday, July 19, 2026",
    "image": "/entertainment-schedules/july-19-entertainment-schedule.png",
    "events": [
      "Husband's 60th birthday"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-21",
    "label": "Tuesday, July 21, 2026",
    "image": "/entertainment-schedules/july-21-entertainment-schedule.png",
    "events": [
      "Beacon Investing"
    ],
    "source": "Tripleseat API pull June 25, 2026; no BEO view returned"
  },
  {
    "date": "2026-07-22",
    "label": "Wednesday, July 22, 2026",
    "image": "/entertainment-schedules/july-22-entertainment-schedule.png",
    "events": [
      "North Dayton School of Discovery Staff Engagement Event."
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  },
  {
    "date": "2026-07-23",
    "label": "Thursday, July 23, 2026",
    "image": "/entertainment-schedules/july-23-entertainment-schedule.png",
    "events": [
      "Danis 07/23/2026",
      "GS1"
    ],
    "source": "Tripleseat BEO/API pull June 25, 2026"
  }
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

