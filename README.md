# On Par Event Host Pages

Next.js app for On Par event operations on Vercel, including the protected
Event Kitchen Prep Dashboard.

## Knowledge Base

- `docs/on-par-events-knowledge-base.md` - event agent brain with food packages, platters, beverage meanings, seating/area rules, entertainment options, current event details, and verification rules.

## Routes

- `/` - index
- `/floor-plans` - protected, persistent Event Host floor-plan editor
- `/entertainment-schedules` - protected, persistent Entertainment Schedule resource grid
- `/itineraries` - protected rolling Event Host plans and itinerary cards
- `/kitchen` - protected daily Event Kitchen Prep Dashboard and print checklist
- `/event-host-addons` - protected live food add-on entry for kitchen events

## Local Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/kitchen`. In non-production development, the
existing admin gate retains its local fallback PIN. Set `EVENT_HOST_ADMIN_PIN`
in an untracked `.env.local` to use a different four-digit value. Production
does not have a fallback and remains locked until this variable is configured.
Set `EVENT_HOST_SESSION_SECRET` to an independent random value of at least 32
characters so the signed HTTP-only session cookie cannot be derived from the
four-digit PIN. The existing server-only Supabase or Tripleseat secret is used
as a compatibility fallback, but a dedicated session secret is preferred.

### Mock kitchen data

To run without Tripleseat or Supabase:

```bash
TRIPLESEAT_MOCK=true pnpm dev
```

The redacted mock day is July 28, 2026 and includes Taco, Wing, Appetizer,
platter-only, mixed, dessert, unknown-item, special-note, and no-food review
cases. Mock persistence is process-local and is not a substitute for the
configured Supabase database. The sync layer refuses to write mock events to
the database backend, preventing missing live credentials from replacing a
real kitchen day with fixtures.

### Live kitchen data

The dashboard reuses the existing OAuth 2.0 authorization-code connection and
supports its existing generic client-name fallbacks. The primary server-only
names are:

- `TRIPLESEAT_CLIENT_ID`
- `TRIPLESEAT_CLIENT_SECRET`
- `TRIPLESEAT_REDIRECT_URI`
- `TRIPLESEAT_ACCESS_TOKEN`
- `TRIPLESEAT_REFRESH_TOKEN`
- `TRIPLESEAT_LOCATION_ID`
- `TRIPLESEAT_SITE_ID` (required for webhook administration, not daily reads)
- `TRIPLESEAT_API_BASE_URL` (optional; defaults to the official `/v1` base)
- `TRIPLESEAT_TOKEN_ENCRYPTION_KEY` (encrypts refreshed token state at rest)
- `TRIPLESEAT_WEBHOOK_SIGNING_KEY`

The checked-in `.env.example` contains names only. Never add these values to a
public-prefixed variable.

The adapter makes read-only calls to:

- `GET /v1/events/search`
- `GET /v1/events/{event_id}?show_financial=true`
- `GET /v1/bookings/{booking_id}?show_financial=true`
- `GET /v1/events/{event_id}/menu_item_selections`
- `GET /v1/events/{event_id}/notes`

The Entertainment Schedule reuses those server-only reads and projects
entertainment document line items, menu selections, room assignments, event
times, status, IDs, and update timestamps into a safe scheduling snapshot.
Tripleseat remains read-only; block edits are saved only in Event Host.

Kitchen and Entertainment Schedule synchronization filter the configured OPE
location and exact `DEFINITE` event status.
Structured menu selections are preferred. Approved `Food Packages` and
`Food Platters` document line items are the fallback when selections are
absent. It does not scrape Tripleseat or automate login.

Kitchen calculations persist only the approved food-related subset of
descriptions and notes. Separately, the protected Event Host plan sync reads
each event's Tripleseat Notes endpoint for operational details that may not be
on the contract. Those note fragments are stripped of markup, contact details
and links are redacted, financial-only fragments are excluded, and source note
IDs/timestamps are retained. Operational note text is display-only: it never
changes guest counts, food quantities, pan calculations, or entertainment
reservations. Truncated or ambiguous data is marked `Needs Review`.

## Rolling Event Host plans

The Event Host planning window is calculated in `America/New_York` from today
through the same calendar date one month later, inclusive, with end-of-month
clamping. A server-only synchronization:

- searches active Tripleseat events for the configured OPE location and keeps
  each source status; non-`DEFINITE` events are marked for review;
- reads current event details, structured menu selections, contract document
  lines, rooms, entertainment, and every event's Notes endpoint;
- stores safe normalized snapshots, note provenance, source update timestamps,
  sync timestamps, and the deterministic event-plan rule version;
- deactivates plans that disappear from the refreshed window without changing
  any Tripleseat record.

Vercel calls `GET /api/event-plans/sync` daily using `CRON_SECRET`. An
authenticated Event Host user can also refresh immediately from `/itineraries`,
which calls the protected `POST` form of the same route.

Tripleseat’s current public scope names are `read` and `write`; no
resource-specific scope catalog is published. The application performs only
read calls and preserves the existing OAuth application rather than replacing
its current scope grant. OAuth 1.0 is not used.

## Event Host floor plans

`/floor-plans` is the floor-plan system of record. The editor renders the
fixed 1920×1080 OPE venue geometry from typed configuration in
`src/lib/floor-plans/configuration/`, then stores dated events, seating, food
tables, rooms, custom annotations, source timestamps, validation results, and
immutable revisions in Supabase. The deterministic generator favors contiguous
seating, includes an ADA food table when food service is present, preserves
locked manual assignments, and marks unknown or ambiguous source data as
`Needs Review` instead of guessing.

Refresh and Generate retrieve the selected date directly from Tripleseat before
floor-plan generation. Floor Plans never generate from the legacy local event
list when the live Tripleseat connection is unavailable.

Entertainment assignments use the same `entertainment_reservations` records as
`/entertainment-schedules`; the floor plan does not keep a second copy. Every
Tripleseat access remains server-side and read-only. Apply
`supabase/migrations/20260803120000_event_host_floor_plans.sql` after the
Entertainment Schedule migration before enabling this route in Preview.

## Build

```bash
pnpm build
```

The repository root contains private customer-derived event assets used by the
full internal application. A successful root build does not make the root safe
to upload. Use the allowlisted Preview packaging process below for kitchen
deployments.

## Kitchen tests

```bash
pnpm test
pnpm test:watch
```

The deterministic suite covers Eastern-time calculations; every Taco,
Wing, and Appetizer boundary; tortilla rounding; platter multipliers and
approved packing; tray/chafing exclusions; package classification; unknown
items; manual BWA persistence; webhook idempotency; and public-payload secret
exclusion. Entertainment tests additionally cover all canonical resources,
normalization, cross-midnight scheduling, floor-plan matching, auto-assignment,
overlaps, persistent manual overrides, audits, idempotent sync, and safe
Tripleseat projections.

Kitchen calculations live in `src/lib/kitchen/` and do not make network or
database calls. See `docs/kitchen-rules.md` for approved calculations and
`docs/open-questions.md` for every unresolved rule and source conflict.

## Vercel backend

Checklist reads, saves, submissions, and admin-state updates run in the Next.js API
routes deployed as Vercel Functions. Supabase is used only as the Postgres database;
the app does not invoke a Supabase Edge Function.

Configure these server-only environment variables in Vercel for Production and
Preview:

- `SUPABASE_URL` — the project URL (the current project URL is also the built-in default)
- `SUPABASE_SECRET_KEY` — a Supabase secret API key
- `CRON_SECRET` — a strong random bearer secret used only by Vercel Cron

`SUPABASE_SERVICE_ROLE_KEY` and the JSON-formatted `SUPABASE_SECRET_KEYS` are also
accepted during migration. Never prefix these values with `NEXT_PUBLIC_`.

The kitchen migrations are
`supabase/migrations/20260728180226_kitchen_dashboard.sql`,
`supabase/migrations/20260729170012_create_kitchen_item_readiness.sql`,
`supabase/migrations/20260729173807_create_kitchen_event_add_ons.sql`, and
`supabase/migrations/20260729181000_harden_kitchen_event_add_ons.sql`, and
`supabase/migrations/20260730210401_add_kitchen_item_completion.sql`. The
add-on hardening migration adds optimistic revisions so concurrent Event Host
tablets cannot silently overwrite one another. The completion migration keeps
the prep Ready state separate from the final sent-out Completed state. These migrations
store only event/booking identifiers, safe source snapshots, normalized
selections, generated checklists and rule versions, manual BWA, per-item
workflow state, sync state, encrypted token state, and webhook idempotency receipts. Public
roles are denied; only server-side service/secret access is granted.

The Entertainment Schedule migration is
`supabase/migrations/20260729152402_entertainment_schedule.sql`. It seeds the
33 canonical physical resources and creates event snapshots, reservations,
audit history, and per-operating-day sync state. Its tables are also denied to
browser roles and accessed only from protected server routes. See
`docs/entertainment-schedule.md` for matching rules, floor-plan setup, API
behavior, and rollout validation.

The rolling Event Host plan migration is
`supabase/migrations/20260730130000_create_event_host_event_plans.sql`. It
creates server-only plan snapshots and singleton sync state with RLS enabled
and explicit `service_role` access only.

The Event Host floor-plan migration is
`supabase/migrations/20260803120000_event_host_floor_plans.sql`. It adds the
remaining entertainment resources plus normalized dated floor plans, events,
assignments, revisions, and conflict acknowledgements. All tables and RPCs are
restricted to server-side `service_role` access.

## Webhooks

The receiver is `POST /api/kitchen/webhook`. It verifies the exact
raw body using Tripleseat’s `X-Signature` HMAC-SHA256 format before parsing and
deduplicates re-signed retries within a ten-minute window before refreshing
the source event. Stalled processing receipts are reclaimable after ten
minutes, and an identical later update is processed after the window. The
handler resolves incomplete event payloads through a fresh event read and
refreshes both the stored and new local dates when an event moves.

After the preview URL is stable, an authorized Tripleseat administrator must
register the receiver with relevant event create/update/status/guest-count/
date-time and event-document create/update/signed actions. Keep event financial
payloads disabled. The application does not programmatically create, update, or
delete Tripleseat webhook configuration.

## Vercel preview

The repository is already linked to its existing Vercel project. Before
creating a preview:

1. Apply the kitchen and Entertainment Schedule Supabase migrations and run
   Supabase security advisors.
2. Add the server-only variable names from `.env.example` to the Vercel Preview
   environment.
3. Configure `EVENT_HOST_ADMIN_PIN` and confirm Vercel Deployment Protection or
   another approved access boundary is enabled. Configure a dedicated
   `EVENT_HOST_SESSION_SECRET` as well.
4. Run `pnpm test` and `pnpm build`.
5. Build the allowlisted kitchen bundle outside the repository and deploy from
   that bundle:

   ```bash
   PREVIEW_PARENT="$(mktemp -d)"
   node scripts/prepare-sanitized-preview.mjs "$PREVIEW_PARENT/bundle"
   cd "$PREVIEW_PARENT/bundle"
   npx vercel deploy --target preview
   ```

   Never run `vercel deploy` from the repository root. The allowlisted bundle
   intentionally excludes raw Tripleseat exports, customer datasets, PDFs,
   floor plans, flyers, and other event assets.
6. Validate `/kitchen`, `/event-host-addons`, an add-on appearing on the
   matching kitchen event, readiness through reload, a saved BWA through
   resync, a signed webhook retry, and one printed redacted real contract.

Production promotion requires explicit user approval after the preview is
reviewed and the blockers in `docs/open-questions.md` are resolved or formally
accepted. The privacy-minimized kitchen Preview bundle is not a complete copy
of Event Host and must not be promoted over the existing full Production
deployment; Production requires a separately reviewed full-app package.
