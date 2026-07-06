# On Par Entertainment Events Agent Brain

Informational knowledge base for event request, booking, planning, and event-output agents.

Last updated: July 1, 2026

## What This Document Is

This is the agent's event reference brain for On Par Entertainment. Use it to understand what Tripleseat event line items mean, what food and entertainment options imply operationally, how seating should be interpreted, and what details must appear in floor plans, entertainment schedules, and itineraries.

This is not just a setup guide. It is the source to answer questions like:

- What does `The Full Course | WING BAR - Food + Beverage` include?
- How many guests fit in a bowling lane, darts lane, VIP section, or karaoke room?
- Which floor-plan areas should be reserved when Tripleseat says `VIP 1`, `VIP 2`, `The Big Show`, `WAT Tables`, or `Main Dining Room`?
- What does each food platter mean?
- Which event details must be captured before a booking or BEO can be trusted?
- What should be flagged as missing or risky?

## Non-Negotiable Data Rules

- Tripleseat is the source of truth for booked event details.
- Never use anything below the `Estimated Billing` section of a BEO/contract.
- Never use payment information from a BEO.
- Never expose, copy, commit, or summarize API secrets.
- For a confirmed event, every floor plan, entertainment schedule, and itinerary must match the BEO/contract above `Estimated Billing`.
- If the BEO document is missing, say so clearly and rely only on available API event/booking fields.
- Do not guess food, drink, or entertainment reservations. If the line item is not present, mark it as not listed.

## Event Basics

Venue:

- On Par Entertainment
- 4464 Indian Ripple Road, Beavercreek, Ohio 45440
- Party pricing reference: 2026 Party Pricing, Beavercreek, Ohio

General event terms from current pricing reference:

- Seating block: 2-hour guaranteed seating block
- Minimum spend: $1,000
- December minimum spend: $2,000
- Booking fee: $100
- Gratuity: 20% automatically applied
- Buffet minimum: 15 guests
- Family-style food service includes fountain drinks, juice, and water
- Food + beverage package pricing includes a $20 drink card per guest
- Beverage package drink cards are valid for drinks on tap
- $20 is the minimum drink card value and can be increased

Use pricing and capacity information for reference and quoting support, but always confirm availability and final selections in Tripleseat.

## Tripleseat Calendar Statuses

- Green: definite
- Yellow: closed
- Blue: prospect
- Brown: lost
- Red: full buyout

For floor plans, entertainment schedules, and final itineraries, prioritize definite and closed events unless the user gives a different scope.

## Required Event Fields

Every event record should include:

- event name
- event date
- day of week
- event start and end time
- guest count
- Tripleseat status
- booked room or area
- food package or platters
- drink package or drink-card terms
- entertainment reservations
- entertainment quantities
- entertainment time windows
- seating notes
- food setup notes
- special instructions
- BEO verification status

If any of those are missing, flag the event before producing final outputs.

## Food Package Dictionary

Food package names often appear in BEOs as package labels plus a selected buffet type.

### The Front Nine

Meaning:

- Food-only buffet package.
- Includes guaranteed seating accommodations for 2 hours.
- BEO examples commonly state soft drinks included or soft drinks free of charge.

Common BEO forms:

- `The Front Nine - Food Only`
- `The Front Nine | TACO BAR- Food Only`
- `The Front Nine | APPETIZER BAR- Food Only`
- `The Front Nine w/COOKIES - Food + COOKIES`

Agent interpretation:

- Treat as a food package, not entertainment.
- Capture the selected buffet type: Wing Bar, Taco Bar, Appetizer Bar, or dessert/cookies variant.
- Reserve seating for the guest count for at least the guaranteed 2-hour block unless the BEO adds extra seating time.
- If guest count is over 100 and food setup applies, plan 2 food tables.

### The Full Course

Meaning:

- Food + beverage buffet package.
- Includes guaranteed seating accommodations for 2 hours.
- Includes soft drinks.
- Current pricing reference says Food + Beverage includes a $20 drink card per guest.

Common BEO forms:

- `The Full Course - Food + Beverage`
- `The Full Course | WING BAR - Food + Beverage`
- `The Full Course | APPETIZER BAR - Food + Beverage`

Agent interpretation:

- Treat as a food and beverage package.
- Capture selected buffet type.
- Note drink-card/beverage inclusion only when shown in the BEO or current pricing reference.
- Reserve seating for the guaranteed seating block.

### The Back Nine

Meaning:

- Beverage-only package.
- Example BEO language: guaranteed seating accommodations for 2 hours, preloaded $20 RFID card for each guest, soft drinks included.

Common BEO form:

- `The Back Nine - Beverage Only`

Agent interpretation:

- Treat as a beverage package, not a food package.
- Do not add food setup unless a food line item is also present.
- Seating still matters because the package can include guaranteed seating accommodations.

## Buffet Type Dictionary

### Wing Bar

Description:

- Deep fried jumbo wings with ranch or blue cheese.
- Pricing reference says served with famous french fries.

When used:

- Appears under Front Nine or Full Course package lines.
- If BEO says `WING BAR`, list the event food as Wing Bar.

### Taco Bar

Description:

- Build-your-own tacos.
- Protein/options from pricing reference: pork verde, chicken in red ranchero sauce, or Mexican ground beef.
- Toppings include sour cream and salsa.

When used:

- Appears as `TACO BAR`.
- Treat as buffet food setup requiring food table placement.

### Appetizer Bar

Description:

- Mozzarella sticks with marinara.
- Crispy chicken tenders.
- Signature tater kegs.

When used:

- Appears as `APPETIZER BAR` or `App Bar`.
- Treat as buffet food setup requiring food table placement.

### With Dessert / Cookies

Description:

- Dessert variant of buffet package.
- Pricing reference shows `With Dessert` as a buffet tier.
- BEO examples include `w/COOKIES`.

When used:

- Capture cookies/dessert explicitly in the itinerary.
- Keep the main buffet type, such as App Bar, in the food line.

## Shareable Platter Dictionary

Each platter serves 8 guests unless a newer source says otherwise.

### Mozzarella Sticks

- Served with marinara sauce.
- Treat as a shareable platter.

### Fry Platter

- Golden crispy fries, piled high.
- Treat as a shareable platter.

### Veggie Tray

- Fresh vegetables with ranch dressing.
- BEO wording may say assorted fresh vegetables served with ranch dressing.
- Treat as a shareable platter.

### Tater Keg Platter

- Crispy mashed-potato tots with cheese, bacon, and chives.
- BEO wording may say super-sized crispy on the outside, mashed potato on the inside tots.
- Treat as a shareable platter.

### Wing Platter

- Jumbo/traditional wings with celery and ranch or blue cheese.
- Treat as a shareable platter.

### Chicken Tender Platter

- Fried chicken tenders.
- Dipping sauce may be ranch or the guest's choice depending on BEO wording.
- Treat as a shareable platter.

### Garden Salad Platter

- Chopped romaine, tomato, cucumber, red onion, cheese, and carrots.
- Treat as a shareable platter.

## Beverage Dictionary

### Soft Drinks Included / Free Of Charge

Meaning:

- Non-alcoholic drink inclusion.
- BEO wording may say `Soft drinks included` or `Soft drinks free of charge`.

Agent interpretation:

- Put this in drink options.
- Do not infer alcoholic beverage package from this alone.

### Food + Beverage Package

Meaning:

- Food package with beverage component.
- Current pricing reference says it includes a $20 drink card per guest.

Agent interpretation:

- Include `Food + Beverage package`.
- Include drink card only when needed for booking explanation or when BEO/pricing reference is being used for sales support.
- For operational itineraries, `Food + Beverage package` and `soft drinks included` are usually enough.

### Beverage Only / Back Nine

Meaning:

- Beverage package without food.
- Example BEO says preloaded $20 RFID card per guest and soft drinks included.

Agent interpretation:

- Do not create food table unless there are separate food lines.
- Include seating if guaranteed seating is listed.

### Big Show Private Self-Pour Taps

Meaning:

- The Big Show private space rental includes private self-pour taps.
- Also includes soft drinks in current references.

Agent interpretation:

- Put this under drink options for The Big Show events.
- Do not interpret it as a full event buyout.

## Entertainment Dictionary

### Mini Golf

Reference:

- 3 courses total.
- 9 holes each.
- Pricing reference: per person per course, or all three courses.
- BEO examples: `Mini Golf per person, per 9 holes`, `Mini Golf per person, all 3 courses`.

Operational rules:

- Mini golf is untimed unless Tripleseat explicitly states a time.
- Do not add an entertainment schedule time block for mini golf unless a time is listed.
- If guests receive mini golf coins and do not use them during the event, pricing reference says coins may be used later.

Floor-plan implications:

- Mark mini golf only if the event needs a reserved/identified area.
- Available floor-plan buttons: Level Up Mini Golf, Wild Axe Mini Golf, Great Escape Mini Golf.

### Duckpin Bowling

Reference:

- 12 lanes available.
- Each lane holds 6 people.
- BEO line examples:
  - `Duckpin Bowling per hour, per lane Sunday-Thursday`
  - `Duckpin Bowling per hour, per lane Friday-Saturday`
  - `1 lane for 2 hours`
  - `4 lanes of bowling for 2 hours`

Operational rules:

- Capture lane count.
- Capture time window if BEO lists it.
- If BEO does not list a time, use duration and ask/flag for exact schedule.
- Add lane reservation to both floor plan and entertainment schedule.

Floor-plan implications:

- Bowling lanes run down the right side and are labeled 1 through 12.
- If BEO says lane closest to karaoke, use lane 1 or the closest available lane near karaoke per map reference.
- Available presets: Lanes 1-5, Lanes 1-7, Lanes 8-12, All Lanes, Lane 1 through Lane 12.

### Darts

Reference:

- Pricing sheet says each lane holds 8 people and 2 lanes available.
- Floor-plan tool currently has 5 darts lane positions labeled Darts 1-5.
- BEO examples may say `*6 people per lane`.

Operational rule:

- Use the BEO for the specific event capacity/quantity when present.
- If BEO and pricing reference differ, do not resolve silently. Flag the conflict and follow the BEO for that event's schedule.

Floor-plan implications:

- Darts lanes are at the lower-right side.
- Available preset: Darts 1-5.
- Darts conversation area is available as `Darts Convo`.

### Neo Shuffleboard

Reference:

- Pricing reference says each lane holds 12 people and 5 lanes available.
- BEO/floor-plan notes may refer to 2 shuffleboard lanes/tables in the mapped area.
- BEO examples may say `*8 people per lane`.

Operational rule:

- Use BEO quantity for the event.
- If time is not listed, use duration and flag exact time as missing.

Floor-plan implications:

- Neo shuffleboard lanes are narrow vertical lanes above VIP seating, between karaoke/VIP and bowling.
- Highlight each lane individually.
- Available preset: Shuffle 1-2.

### Pool Tables

Reference:

- 3 tables available.
- BEO examples: `Pool Table Friday-Saturday`, `1 table for 2 hours`, `3 tables for 2 hours`.

Operational rule:

- Capture table count and duration.
- Add to floor plan and entertainment schedule when reserved.

Floor-plan implications:

- Available preset: Pool 1-3.

### Karaoke Rooms

Private room capacities and reference rates:

| Room | Capacity |
| --- | ---: |
| Ocean Room | 1-16 guests |
| Gem Room | 1-9 guests |
| Royal Room | 1-14 guests |
| Disco Inferno | 1-16 guests |
| Prime Room | 1-18 guests |

Operational rules:

- Use room name and time window from BEO.
- If a package says The Big Show, it includes private space with 5 karaoke rooms plus public karaoke space.

Floor-plan implications:

- Private karaoke rooms are along the upper-right side.
- Available room presets: Disco, Prime, Royal, Gem, Ocean.

### The Big Show

Meaning:

- Private space rental.
- Accommodates 100 guests.
- Includes 5 private karaoke rooms plus public karaoke space.
- Includes private self-pour taps.
- Includes TVs with HDMI setup.
- BEO may call this `The Big Show - Space Rental Only`.

Operational rules:

- Treat as a private space/entertainment area.
- Include private self-pour taps under drink options.
- If BEO lists sponsor or TV text, include it in special instructions.
- Do not reserve Main area seating for a group that has The Big Show unless Tripleseat separately says to.

Floor-plan implications:

- Highlight Big Show/public karaoke area.
- Mark food setup in the public karaoke space with `F`.
- Use event color for Big Show and the food marker.

## Seating And Area Dictionary

### Global Seating Rules

- Rectangle tables fit 10 guests.
- Square tables fit 4 guests.
- VIP sections each fit up to 20 guests.
- Conversation wall areas fit up to 10 guests.
- Guaranteed seating block is normally 2 hours.
- Extra guaranteed seating time may appear as `Extra hour(s) for guaranteed reserved seating past 2 hours`.
- If a food package is attached to the event, plan food table placement.
- If guest count is over 100 and food setup applies, mark 2 food tables.

### VIP 1

Meaning:

- VIP 1 is the left VIP couch section inside the Main Wall/VIP area.

Reserve with:

- VIP 1 itself.
- The four rectangle tables in front of VIP 1.
- The conversation wall before using tables near Level Up mini golf.
- VIP conversation walls between Karaoke and VIP when applicable.

Floor-plan tool preset:

- `VIP 1 Full`
- `VIP 1`
- `VIP Food`

### VIP 2

Meaning:

- VIP 2 is the right VIP section above the Main Wall, closer to Bowling.

Reserve with:

- VIP 2 itself.
- The table closest to Bowling when a full VIP 2 setup is needed.
- Related conversation/support seating when applicable.

Floor-plan tool preset:

- `VIP 2 Full`
- `VIP 2`
- `VIP Food`

### Main Dining Room

Meaning:

- Main dining/event seating area.
- Can combine rectangle tables, center rectangles, right rectangles, conversation walls, and nearby table areas.

Floor-plan tool presets:

- Left Rectangles
- Center Rectangles
- Right Rectangles
- Conversation Walls
- Level Up Squares
- Main Food 1 and Main Food 2 are available as food table markers in the map data.

Operational rule:

- For large events, choose table groups that fit guest count.
- Highlight tables individually instead of one large block when individual seats/tables are visible.

### GEG Tables

Meaning:

- Great Escape Golf/GEG table area in the mapped floor-plan tool.

Floor-plan tool:

- `GEG Tables`
- `ge-table-1`, `ge-table-2`, `ge-table-3`

Operational rule:

- Use when Tripleseat lists `GEG Tables` or when seating overflow is assigned near Great Escape.

### WAT Tables

Meaning:

- WAT table area in the mapped floor-plan tool.

Floor-plan tool:

- `wat-table-1`, `wat-table-2`, `wat-table-3`

Operational rule:

- Use when Tripleseat lists `WAT Tables`.

### Clubhouse

Meaning:

- Separate mapped area in the floor-plan tool.

Operational rule:

- Use when Tripleseat lists `Clubhouse`.

### Patio

Meaning:

- Patio area exists in map data as `patio-reserved`.

Operational rule:

- Only reserve when Tripleseat explicitly lists Patio or notes outdoor/patio use.

## Food Table Placement Rules

Use `F` markers in the event color.

Known food marker locations:

- VIP food table near VIP 1/VIP 2.
- Main food tables near Main Dining Room.
- Karaoke food table for The Big Show/public karaoke.

Rules:

- Food package or platters generally require a food table.
- One food table is usually enough for smaller events unless BEO says otherwise.
- If guest count is over 100 and food setup applies, mark 2 food tables.
- The Big Show food setup goes in public karaoke on a fold-out table.
- Keep food markers visible but not blocking important map labels.

## Event Line Item Interpretation Guide

Use this table when reading BEO line items.

| BEO line item contains | Agent should capture | Floor-plan impact | Schedule impact |
| --- | --- | --- | --- |
| `The Front Nine` | Food-only buffet package, buffet type, seating block | Reserve seating and food table | No entertainment unless separate lines |
| `The Full Course` | Food + Beverage package, buffet type, seating block | Reserve seating and food table | No entertainment unless separate lines |
| `The Back Nine` | Beverage-only package, drink card/soft drinks when listed | Reserve seating if guaranteed | No entertainment unless separate lines |
| `Wing Bar` | Wing buffet | Food table | No entertainment |
| `Taco Bar` | Taco buffet | Food table | No entertainment |
| `Appetizer Bar` or `App Bar` | Appetizer buffet | Food table | No entertainment |
| `w/COOKIES` or dessert | Dessert/cookies add-on | Food/dessert setup | No entertainment |
| `Tater Keg Platter` | Shareable platter, serves 8 | Food table | No entertainment |
| `Wing Platter` | Shareable platter, serves 8 | Food table | No entertainment |
| `Chicken Tender Platter` | Shareable platter, serves 8 | Food table | No entertainment |
| `Pretzel Bite Platter` | Shareable platter, serves 8 | Food table | No entertainment |
| `Veggie Tray` | Shareable platter, serves 8 | Food table | No entertainment |
| `Fry Platter` | Shareable platter, serves 8 | Food table | No entertainment |
| `Duckpin Bowling` | Lane count, duration, time window | Highlight lane numbers | Add time block |
| `Darts` | Lane count, duration, time window | Highlight darts lanes | Add time block |
| `Pool Table` | Table count, duration, time window | Highlight pool tables | Add time block |
| `Neo Shuffleboard` | Lane/table count, duration, time window | Highlight shuffle lanes | Add time block |
| `Mini Golf` | Guest count and course count | Mark only when needed | Untimed unless BEO gives time |
| `The Big Show` | Private space, karaoke rooms, self-pour taps, TVs | Highlight Big Show/public karaoke and karaoke food | Add private-space time block |
| `Extra hour(s) for guaranteed reserved seating` | Seating extends past 2 hours | Extend seating reservation | Does not create entertainment by itself |

## Floor Plan Highlight Rules

- Add day/date at top left in black.
- Under the date, add event name, guest count in parentheses, and event time.
- Give every event on the same day a unique color.
- Use the same event color for label, seating, entertainment, and food markers.
- Highlights should be around 50% transparency.
- Use page 43 in Canva as the map key and sizing reference.
- Use page 44 in Canva as the labeled location reference.
- Add the blank floor map first.
- Highlight assigned tables, areas, entertainment spaces, and food tables.
- Add times to timed entertainment areas.
- Do not add times to mini golf unless Tripleseat explicitly lists a time.
- Multiple events on one map must remain visually distinct.

## Entertainment Schedule Rules

Each schedule date should include:

- date
- each event on that date
- event color
- event time
- guest count
- entertainment item
- quantity
- time window
- duration

Ordering:

- Sort by date.
- Within each date, sort by event time.

Missing time handling:

- If BEO lists duration but no exact time, write `Time not listed on BEO` and include the duration.
- Do not invent a time.
- If the user later gives a staggered schedule, update the schedule to use the staggered times.

Mini golf:

- List as untimed unless Tripleseat gives a specific time.

## Itinerary Rules

Each itinerary card/section should include:

- event name
- date
- time
- guest count
- room or area
- food options
- drink options
- entertainment reservations
- special instructions
- verification status

Use operational wording. Do not include prices, billing, deposits, or payment status from BEOs.

## Current Event Detail Matrix

This matrix summarizes the current deployable event data. Always re-check Tripleseat before using it for a new production handoff.

### Lowes MST Team

- Date/time: Thursday, June 25, 2026, 11:00 AM - 2:00 PM
- Guests: 23
- Area: VIP 1
- Food:
  - Premium Taco Bar
  - Wing Platter
  - Fry Platter
  - Veggie Tray
- Drinks:
  - No drink package listed on extracted BEO
- Entertainment:
  - Duckpin Bowling, 4 lanes, 11:00 AM - 2:00 PM, 3 hours
  - Pool Table, 1 table, 11:00 AM - 2:00 PM, 3 hours
- Special instructions:
  - VIP 1 is listed in the event summary on the current BEO.
- Floor-plan interpretation:
  - Highlight VIP 1 full support seating and 1 VIP food table.
  - Highlight bowling lanes 1-4 and pool table 1 using the event window shown on the BEO.
- Verification: BEO checked above billing section; room assignment updated to VIP 1.

### Space Force

- Date/time: Thursday, June 25, 2026, 6:00 PM - 10:00 PM
- Guests: 250
- Areas: Main Dining Room, VIP 1, VIP 2, GEG Tables, WAT Tables
- Food:
  - Tater Keg Platter
  - Wing Platter
  - Chicken Tender Platter
  - Pretzel Bite Platter
  - Veggie Tray
- Drinks:
  - No drink package listed on extracted BEO
- Entertainment:
  - No reserved entertainment listed on the available BEO/API fields.
- Special instructions:
  - BEO includes an extra hour for guaranteed reserved seating past 2 hours.
- Floor-plan interpretation:
  - Highlight Main Dining Room, VIP 1, VIP 2, GEG Tables, and WAT Tables.
  - Mark 2 main food tables because the guest count is over 100 and food setup is listed.
  - No reserved entertainment is listed on the current BEO.
- Verification: BEO checked above billing section.

### Work event for 30 co-workers

- Date/time: Tuesday, July 7, 2026, 4:00 PM - 8:00 PM
- Guests: 30
- Area: VIP 1
- Food:
  - The Full Course - Food + Beverage
  - Premium Taco Bar
  - Dessert
  - Wing Platter
- Drinks:
  - Food + Beverage package
- Entertainment:
  - Duckpin Bowling, 5 lanes, 5:00 PM - 6:00 PM, 1 hour
  - Mini Golf, 30 guests, Untimed, 9 holes
- Special instructions:
  - Need to start around 4:00 PM and end by 8:00 PM.
  - VIP 1 is listed in the current BEO event summary.
- Floor-plan interpretation:
  - Highlight VIP 1 full support seating and 1 VIP food table.
  - Highlight bowling lanes 1-5 and label 5-6.
  - Mini golf is untimed and does not need a time label.
- Verification: BEO checked above billing section; room assignment updated to VIP 1.

### LexisNexis Government Markets Meeting

- Date/time: Thursday, July 9, 2026, 6:30 PM - 8:30 PM
- Guests: 100
- Areas: VIP 1, VIP 2
- Food:
  - The Full Course | TACO BAR - Food + Beverage
  - Veggie Tray
- Drinks:
  - Food + Beverage package
  - Soft drinks included
- Entertainment:
  - Duckpin Bowling, 7 lanes, Time not listed on BEO, 2 hours
  - Pool Table, 3 tables, Time not listed on BEO, 2 hours
  - Neo Shuffleboard, 2 tables, Time not listed on BEO, 2 hours
  - Prime Room, 1 room, 7:00 PM - 9:00 PM, 2 hours
- Special instructions:
  - Booking description asks for bowling, karaoke, and add-on activities for the team.
  - VIP 1 and VIP 2 are listed in the current BEO event summary.
  - VIP 1 and VIP 2 do not provide seated capacity for 100 guests; confirm overflow seating approach if operations needs a full seating map.
- Floor-plan interpretation:
  - Highlight VIP 1 and VIP 2 support seating plus both VIP food tables.
  - Highlight bowling lanes 1-7, pool tables 1-3, and shuffleboard tables 1-2 with 2-hour labels.
  - Highlight Prime Room and label 7-9.
- Verification: BEO checked above billing section; room assignment updated to VIP 1 and VIP 2.

### Oculii

- Date/time: Friday, July 10, 2026, 2:00 PM - 4:00 PM
- Guests: 23
- Area: VIP 2
- Food:
  - Veggie Tray
- Drinks:
  - No drink package listed on extracted BEO
- Entertainment:
  - Darts, 1 lane, 2:00 PM - 4:00 PM, 2 hours
  - Duckpin Bowling, 2 lanes, 2:00 PM - 4:00 PM, 2 hours
  - Pool Table, 1 table, 2:00 PM - 4:00 PM, 2 hours
  - Neo Shuffleboard, 1 table, 2:00 PM - 4:00 PM, 2 hours
  - Gem Room, 1 room, 2:00 PM - 4:00 PM, 2 hours
  - Mini Golf, 18 guests, Untimed, All 3 courses
- Floor-plan interpretation:
  - Highlight VIP 2 with its bowling-side support table and 1 VIP food table.
  - Highlight darts lane 1, bowling lanes 1-2, pool table 1, shuffleboard table 1, and Gem Room with 2:00 PM - 4:00 PM labels.
  - Mini golf is untimed.
- Verification: BEO checked above billing section.

### Core4ce

- Date/time: Friday, July 10, 2026, 5:30 PM - 7:30 PM
- Guests: 82
- Area: VIP 1
- Food:
  - The Front Nine | TACO BAR - Food Only
- Drinks:
  - Soft drinks included
- Entertainment:
  - Darts, 3 lanes, Time not listed on BEO, 2 hours
  - Duckpin Bowling, 12 lanes, Time not listed on BEO, 2 hours
  - Mini Golf, 50 guests, Untimed, 9 holes
  - Pool Table, 2 tables, Time not listed on BEO, 2 hours
  - Neo Shuffleboard, 1 table, Time not listed on BEO, 2 hours
- Special instructions:
  - API guest count is blank; using the 82-person food package quantity from the BEO for planning.
  - VIP 1 support seating does not provide seated capacity for 82 guests; confirm overflow approach if operations needs a full seating map.
- Floor-plan interpretation:
  - Highlight VIP 1 full support seating and surrounding tables plus one VIP food table.
  - Highlight darts lanes 1-3, all 12 bowling lanes, pool tables 1-2, and shuffleboard table 1 with 2-hour labels.
  - Mini golf is untimed; guest quantity exceeds the listed room seating footprint and should remain flagged.
- Verification: BEO checked above billing section; guest count inferred from BEO food quantity and seating-capacity mismatch flagged.

### Jennifer Nicholson

- Date/time: Tuesday, July 14, 2026, 6:30 PM - 9:30 PM
- Guests: 30
- Areas: Big Show, Gem Room, Royal Room
- Food:
  - The Front Nine w/COOKIES | TACO BAR - Food + COOKIES
  - Pretzel Bite Platter
- Drinks:
  - The Back Nine - Beverage Only
  - Soft drinks free of charge
- Entertainment:
  - Gem Room, 1 room, 6:30 PM - 9:30 PM, 3 hours
- Special instructions:
  - Black bean and lettuce.
  - Food setup in Royal Room from 6:30 PM - 7:30 PM.
  - Presentation at 7:00 PM.
  - Entertainment from 8:00 PM - 9:30 PM.
- Floor-plan interpretation:
  - Highlight Big Show/public karaoke, Gem Room, and Royal Room.
  - Mark the Royal Room food setup and note the 6:30-7:30 setup window.
  - Carry the presentation and entertainment timing notes onto the floor plan labels.
- Verification: BEO checked above billing section; Big Show/Gem/Royal room setup details flagged.

### LexisNexis 07/15/2026

- Date/time: Wednesday, July 15, 2026, 6:30 PM - 9:00 PM
- Guests: 110
- Area: Main Dining Room
- Food:
  - The Full Course | TACO BAR - Food + Beverage
  - Veggie Tray
- Drinks:
  - Food + Beverage package
  - Soft drinks included
- Entertainment:
  - Duckpin Bowling, 7 lanes, Time not listed on BEO, 2 hours
  - Pool Table, 3 tables, Time not listed on BEO, 2 hours
  - Neo Shuffleboard, 2 tables, Time not listed on BEO, 2 hours
  - Prime Room, 1 room, Time not listed on BEO, 2 hours
- Special instructions:
  - Booking description requests the same games, karaoke, and food as the July 9, 2026 event.
- Floor-plan interpretation:
  - Highlight Main Dining Room seating and 2 main food tables because the guest count is over 100.
  - Highlight bowling lanes 1-7, pool tables 1-3, and shuffleboard tables 1-2 with 2-hour labels.
  - Highlight Prime Room, but keep its timing flagged as not listed on this BEO.
- Verification: BEO checked above billing section; Prime Room time not listed on this BEO.

### Husband's 60th birthday

- Date/time: Sunday, July 19, 2026, 1:00 PM - 3:00 PM
- Guests: 35
- Area: VIP 1
- Food:
  - Taco Bar
- Drinks:
  - No drink package listed on extracted BEO
- Entertainment:
  - No reserved entertainment listed on the available BEO/API fields.
- Special instructions:
  - The extracted BEO shows Taco Bar under food-bar choices but does not show the package label.
- Floor-plan interpretation:
  - Highlight VIP 1 full support seating and 1 VIP food table.
  - No reserved entertainment is listed on the extracted BEO.
- Verification: BEO checked above billing section; food package label missing from document text.

### Beacon Investing

- Date/time: Tuesday, July 21, 2026, 5:30 PM - 7:30 PM
- Guests: 13
- Area: Main Dining Room
- Food:
  - No BEO document view returned by Tripleseat API
- Drinks:
  - No BEO document view returned by Tripleseat API
- Entertainment:
  - No reserved entertainment listed on the available BEO/API fields.
- Floor-plan interpretation:
  - Highlight Main Dining Room seating only.
  - Do not add food, drink, or entertainment reservations that are not present in the available API fields.
- Verification: API event and booking fields checked; no BEO document view returned.

### North Dayton School of Discovery Staff Engagement Event.

- Date/time: Wednesday, July 22, 2026, 4:00 PM - 6:00 PM
- Guests: 50
- Area: Main Dining Room
- Food:
  - The Front Nine | TACO BAR - Food Only
- Drinks:
  - Soft drinks included
- Entertainment:
  - Darts, 2 lanes, Time not listed on BEO, 1 hour
  - Duckpin Bowling, 2 lanes, Time not listed on BEO, 1 hour
  - Neo Shuffleboard, 1 table, Time not listed on BEO, 2 hours
- Floor-plan interpretation:
  - Highlight Main Dining Room seating and 1 main food table.
  - Highlight darts lanes 1-2 and bowling lanes 1-2 with 1-hour labels.
  - Highlight shuffleboard table 1 with a 2-hour label.
- Verification: BEO checked above billing section.

### Danis 07/23/2026

- Date/time: Thursday, July 23, 2026, 1:00 PM - 3:00 PM
- Guests: 23
- Area: Main Dining Room
- Food:
  - The Front Nine w/COOKIES | TACO BAR - Food + COOKIES
  - Tater Keg Platter
- Drinks:
  - Soft drinks included
- Entertainment:
  - Darts, 2 lanes, Time not listed on BEO, 2 hours
  - Duckpin Bowling, 2 lanes, Time not listed on BEO, 2 hours
  - Neo Shuffleboard, 2 tables, Time not listed on BEO, 2 hours
- Floor-plan interpretation:
  - Highlight Main Dining Room seating and 1 main food table.
  - Highlight darts lanes 1-2, bowling lanes 1-2, and shuffleboard tables 1-2 with 2-hour labels.
  - Duckpin quantity is interpreted from the 4 lane-hours line on the BEO.
- Verification: BEO checked above billing section; bowling quantity interpreted from lane-hours line.

### GS1

- Date/time: Thursday, July 23, 2026, 2:00 PM - 5:00 PM
- Guests: 118
- Area: Main Dining Room
- Food:
  - The Front Nine | TACO BAR - Food Only
  - Tater Keg Platter
  - Veggie Tray
- Drinks:
  - The Back Nine - Beverage Only
  - Soft drinks included
- Entertainment:
  - Darts, 3 lanes, 2:30 PM - 4:30 PM, 2 hours
  - Duckpin Bowling, 10 lanes, 2:30 PM - 4:30 PM, 2 hours
  - Mini Golf, 25 guests, Untimed, 9 holes
  - Pool Table, 1 table, 2:30 PM - 4:30 PM, 2 hours
  - Gem Room, 1 room, 2:30 PM - 4:30 PM, 2 hours
- Floor-plan interpretation:
  - Highlight Main Dining Room seating and 2 main food tables because the guest count is over 100.
  - Highlight darts lanes 1-3, bowling lanes 1-10, pool table 1, and Gem Room with 2:30-4:30 labels.
  - Mini golf is untimed and should remain unlabeled on the floor map.
- Verification: BEO checked above billing section.

## Missing Information Flags

Flag an event when:

- no BEO document view is returned
- food package is missing
- drink package is missing
- entertainment time is missing
- entertainment quantity is missing
- BEO capacity conflicts with pricing/floor-plan reference
- Tripleseat room assignment conflicts with a line-item package such as The Big Show
- guest count is over 100 and food-table count is not clear
- event has multiple rooms/areas and seating distribution is not clear
- special instructions mention sponsor/TV/setup and the floor plan or itinerary does not include them

## Agent Response Rules

When answering an event question:

1. Identify whether the question is about booking/sales, floor plan, schedule, itinerary, or verification.
2. Pull event truth from Tripleseat/BEO first.
3. Use this knowledge base to interpret line items.
4. State missing data clearly.
5. Do not invent quantities, times, rooms, or food.
6. Do not mention prices from BEOs or any payment status.
7. For customer-facing wording, keep it simple and positive.
8. For internal operations, include exact room, table, lane, timing, food table, and verification details.

## Output Requirements

Floor plan must show:

- day/date
- event name
- guest count
- event time
- unique event color
- seating/area highlights
- food table markers
- entertainment highlights
- entertainment time labels when timed

Entertainment schedule must show:

- date
- event name
- guest count
- entertainment item
- quantity
- time window
- duration
- event-specific color/highlight

Itinerary must show:

- event name
- date
- time
- guest count
- room/area
- food
- drink options
- entertainment
- special instructions
- verification status

The work is complete only when Tripleseat/BEO, floor plan, entertainment schedule, itinerary, and hosted pages all agree.
