# On Par Entertainment Events Knowledge Base

Handoff guide for an event request, booking, and event-output agent.

Last updated: June 9, 2026

## Purpose

This knowledge base explains how On Par Entertainment event requests move from Tripleseat intake to finished host-facing outputs:

- floor plans
- entertainment schedules
- event itineraries
- hosted Next.js pages for Vercel

The agent's job is to keep every event artifact accurate against Tripleseat, especially the BEO/contract, while avoiding sensitive billing and payment data.

## Golden Rules

- Use Tripleseat as the source of truth for event name, date, time, guest count, room or area, food, drink options, and reserved entertainment.
- Do not use anything below the Estimated Billing section of a Tripleseat BEO or contract.
- Do not use or store payment information.
- Do not print, display, commit, or share API secrets.
- Use only the local `.env` credentials under `Secret Files/` for Tripleseat API access.
- Every finished floor plan, entertainment schedule, and itinerary must be checked back against Tripleseat before it is considered complete.
- Multiple events can happen on one day, so highlights, labels, and schedule sections must be specific to each event.

## Workspace Map

Main workspace:

`/Users/christinamyers/Desktop/EVENTS`

Important files and folders:

- `Secret Files/.env`: local credentials. Never commit or display.
- `Tripleseat API/`: local Tripleseat API helpers.
- `outputs/tripleseat/`: sanitized pulled events, BEO text, manifests, and verification reports.
- `floor-plan-tool/`: local browser tool and map assets for editable floor-plan creation.
- `canva floor plans/`: working PNG copies of finished floor plans.
- `entertainment schedules/`: working PNG copies of generated entertainment schedules.
- `ITINERARY/`: itinerary HTML/PDF outputs.
- `public/`: deployable Vercel assets copied into the Next.js app.
- `src/app/`: Next.js routes for index, floor plans, entertainment schedules, and itineraries.
- `src/lib/events.ts`: route-facing event and asset index.
- `public/data/event-plan-data.json`: deployable event data used by the hosted itinerary route.
- `docs/on-par-events-knowledge-base.md`: this handoff guide.

GitHub repo:

`https://github.com/marketing4464/on-par-event-host-pages`

## Tripleseat Calendar Statuses

Tripleseat calendar color key:

- Green: definite
- Yellow: closed events
- Blue: prospects
- Brown: lost events
- Red: full buyout events

For build-ready floor plans and schedules, prioritize definite and closed events unless the user says otherwise.

## Event Request Intake

For a new request or booking inquiry, collect or confirm:

- event name or client/company name
- requested event date
- requested start and end time
- estimated guest count
- event type
- requested spaces or areas
- reserved entertainment
- food package or food setup needs
- drink options or bar package
- special setup instructions
- whether the event is definite, closed, prospect, lost, or full buyout

Before building outputs, confirm the event is represented correctly in Tripleseat and has enough BEO/contract information to support floor plan and schedule decisions.

## Pulling Events From Tripleseat

Use the local Tripleseat helpers. They already sanitize sensitive fields and remove common financial data.

Example event pull:

```bash
python3 "Tripleseat API/pull_events.py" \
  --start 06/09/2026 \
  --end 06/30/2026 \
  --status definite \
  --status closed \
  --details \
  --out outputs/tripleseat/june-09-30-2026-definite-closed-events.json
```

Extract BEO text above Estimated Billing:

```bash
python3 "Tripleseat API/extract_beos.py" \
  --events outputs/tripleseat/june-09-30-2026-definite-closed-events.json \
  --out-dir outputs/tripleseat/beo_text \
  --manifest outputs/tripleseat/beo_manifest.json
```

If a BEO document view is missing, verify the event through available API event, booking, document, and attachment fields. Record the limitation in the verification status.

## BEO Extraction Rules

Only use BEO/contract content above Estimated Billing.

Use these fields for planning:

- event name
- event date
- event time
- guest count
- booked room or area
- reserved entertainment
- food setup and menu notes
- drink options
- special setup instructions

Do not use:

- estimated billing
- billing summary
- grand totals
- deposit information
- payments
- amount due
- card or payment details
- client contact information unless explicitly needed for booking operations

## Floor Plan Workflow

Use the BEO to identify:

- event name
- guest count
- date and day of week
- time
- room or reserved areas
- food table setup
- reserved entertainment

Canva references:

- Canva design name: `2026 FLOOR PLANS` or `2026 Floor Plans`
- Use Canva page 43 as the map key and sizing reference.
- Use Canva page 44 as the labeled location reference when needed.
- Start new floor plans from a clean blank floor map.

Local tool references:

- `floor-plan-tool/index.html`
- `floor-plan-tool/assets/blank-floor-map.png`
- `floor-plan-tool/assets/map-key.png`

Floor plan construction rules:

- Put the day and date at the top left in black.
- Put event name, guest count in parentheses, and event time under the date.
- Give each event on the same day a unique highlight color.
- Use the same color for one event's title, seating highlights, entertainment highlights, and food table markers.
- Use square or rectangle highlights sized to the map key.
- Set highlights to about 50% transparency so the floor map remains visible.
- Mark food tables as `F`.
- If guest count is over 100, mark 2 food tables.
- Add reserved entertainment to the floor plan, not only seating.
- Add reservation times to timed entertainment areas.
- Mini golf is not timed entertainment.

Area and seating notes:

- Rectangle tables fit 10 guests.
- Square tables fit 4 guests.
- There are 2 VIP sections.
- Each VIP section fits up to 20 guests.
- Conversation wall areas fit up to 10 guests.
- Karaoke includes public karaoke space plus 5 private rooms.
- If an event has The Big Show, do not reserve Main area seating for that event.
- If an event has The Big Show, food setup goes in public karaoke on a fold-out table and should be marked `F`.
- For VIP1, reserve VIP1, the four rectangle tables in front of VIP1, and the conversation wall before using tables near Level Up mini golf.
- For VIP2, reserve the table closest to Bowling.
- Highlight neo shuffleboard lanes individually.

Save outputs:

- Working PNG copy: `canva floor plans/`
- Deployable PNG copy: `public/floor-plans/`
- Canva copy: add to the `2026 FLOOR PLANS` design on a new page.

## Entertainment Schedule Workflow

The entertainment schedule is built from the floor plan and BEO entertainment reservations.

For each event, include:

- event name
- guest count
- event time
- entertainment item
- quantity or lanes/tables/rooms when available
- reserved time window
- duration when relevant

Schedule rules:

- One date can contain multiple event sections.
- Each event should have a distinct highlight color matching its floor plan.
- Keep events ordered by date, then time.
- If multiple events share the same day, make each event visually distinct.
- If the BEO lists staggered entertainment times, use the staggered times, not the full event time.
- If an entertainment time is not listed, check whether the reservation is for 1 hour or 2 hours.
- Mini golf does not need a timed reservation window unless Tripleseat explicitly states one.

Current linked-thread schedule generator:

```bash
python3 generate_entertainment_schedules_from_thread.py
```

Current local output builder:

```bash
python3 build_event_outputs.py
```

Save outputs:

- Working PNG copy: `entertainment schedules/`
- Deployable PNG copy: `public/entertainment-schedules/`
- Hosted route: `/entertainment-schedules`

## Itinerary Workflow

The itinerary should summarize each event in operational language.

Include:

- event name
- date
- time
- guest count
- room or booked area
- food options
- drink options
- reserved entertainment
- special instructions
- verification status

Keep the itinerary in date/time order. For multiple events on one day, keep each event as a separate card or section.

Current hosted route:

`/itineraries`

Deployable data source:

`public/data/event-plan-data.json`

## Hosted Next.js App

The Vercel-ready app is in the root of this repo.

Routes:

- `/`: index page
- `/floor-plans`: hosted floor-plan maps
- `/entertainment-schedules`: hosted entertainment schedule PNGs
- `/itineraries`: hosted event itinerary cards

Local development:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Asset verification:

```bash
python3 verify_next_assets.py
```

Sync working assets into `public/`:

```bash
python3 sync_public_assets.py
```

## Verification Checklist

Before handoff, confirm:

- Tripleseat event count matches the planning data.
- Every event ID in the pulled Tripleseat data exists in the planning data.
- Every BEO extraction stopped at or above Estimated Billing.
- No billing/payment markers appear in extracted BEO text, generated HTML, or deployable event data.
- Event name matches Tripleseat.
- Event date and day of week match Tripleseat.
- Event time matches Tripleseat.
- Guest count matches Tripleseat.
- Food and drink options match Tripleseat.
- Entertainment reservations match Tripleseat.
- Floor-plan areas match the BEO and Canva map key.
- Food tables are marked correctly.
- Guest counts over 100 have 2 food tables when food setup applies.
- Entertainment times are shown on floor plans when applicable.
- Entertainment schedule matches the floor plan and BEO.
- Itinerary matches the BEO, floor plan, and entertainment schedule.
- Multiple events on one day are visually distinct.
- Hosted floor-plan sections are ordered by date.
- Hosted entertainment schedule sections are ordered by date.
- All public asset references exist.

Run:

```bash
python3 verify_event_outputs.py
python3 verify_next_assets.py
```

Note: `verify_event_outputs.py` checks the full local generated workflow. `verify_next_assets.py` checks the deployable Next.js app.

## Current Hosted Event Data

As of this handoff, the deployed planning data covers these 9 Tripleseat events:

| Date | Event | Guests | Time | Entertainment Items | Verification |
| --- | --- | ---: | --- | ---: | --- |
| 2026-06-09 | The Greentree Group Leadership Event | 12 | 6:00 PM - 9:00 PM | 2 | BEO checked above billing section |
| 2026-06-12 | Oasis Turf & Tree employee outing | 30 | 12:00 PM - 5:00 PM | 5 | BEO checked above billing section |
| 2026-06-13 | Graduation Party | 75 | 3:00 PM - 6:00 PM | 1 | BEO checked above billing section |
| 2026-06-20 | Emily's bachelorette party | 12 | 5:00 PM - 8:00 PM | 2 | BEO checked above billing section |
| 2026-06-20 | CJ 20th reunion | 150 | 6:30 PM - 9:30 PM | 0 | API fields checked; no BEO document view returned |
| 2026-06-20 | CJA CLASS OF 2016 10 yr reunion meet up | 100 | 8:00 PM - 10:00 PM | 0 | API fields checked; no BEO document view returned |
| 2026-06-24 | Expo Experts | 70 | 2:00 PM - 5:00 PM | 2 | BEO checked above billing section |
| 2026-06-24 | Sydney Lance | 40 | 2:00 PM - 5:00 PM | 3 | BEO checked above billing section |
| 2026-06-25 | Space Force | 250 | 6:00 PM - 8:00 PM | 0 | BEO checked above billing section |

Hosted floor plans currently exist for:

- 2026-06-09
- 2026-06-12
- 2026-06-13
- 2026-06-20
- 2026-06-24
- 2026-06-25

Hosted entertainment schedule images currently exist for:

- 2026-05-30
- 2026-05-31
- 2026-06-05
- 2026-06-06
- 2026-06-07
- 2026-06-09
- 2026-06-12
- 2026-06-13
- 2026-06-20
- 2026-06-24
- 2026-06-25

## GitHub And Vercel Handoff

After updating data or assets:

1. Sync assets into `public/`.
2. Run verification.
3. Review the hosted pages locally if a dev server is available.
4. Commit only the deployable app and documentation files.
5. Do not commit `Secret Files/`, `outputs/`, `beo_extracts/`, `canva floor plans/`, or `entertainment schedules/`.
6. Push to GitHub.
7. Vercel can deploy from the GitHub repo.

Suggested commit commands:

```bash
git status --short
git add public src docs README.md package.json next.config.ts tsconfig.json vercel.json verify_next_assets.py
git commit -m "Update event host assets"
git push
```

## Booking Agent Quick Script

Use this as the operating rhythm:

1. Pull the requested date range from Tripleseat.
2. Extract BEOs and stop at Estimated Billing.
3. Build or update planning data.
4. Build floor plans from BEO seating, food, area, and entertainment requirements.
5. Build entertainment schedules from the BEO and floor plans.
6. Build itinerary cards from the BEO and verified outputs.
7. Verify every artifact against Tripleseat.
8. Copy deployable assets into `public/`.
9. Run verification scripts.
10. Push the Vercel-ready app to GitHub.

The work is complete only when the BEO, floor plan, entertainment schedule, itinerary, and hosted HTML/Next.js pages all agree.
