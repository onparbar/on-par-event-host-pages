# Event Food → GoTab KDS architecture

Status: Local integration implementation with dry-run enabled by default. Live dispatch remains operationally disabled until catalog mappings, the dedicated spot/customer, routing, and physical KDS tests are complete.

## Existing Event Host workflow

- Next.js 16 App Router with TypeScript and React 19, deployed on Vercel.
- Supabase/Postgres is accessed server-side through the existing service-role REST storage adapters. There is no ORM.
- Tripleseat uses the existing server-only OAuth client, encrypted token storage, signed webhook route, exact-event refresh, and daily synchronization.
- `src/lib/kitchen/rules.ts`, `config.ts`, `normalize.ts`, and `addons.ts` are the single deterministic source for food names, quantities, pan sizes, chafing dishes, prep timing, and Event Host add-ons.
- Contracted food is stored in `kitchen_event_snapshots` and `kitchen_checklists`. Manual food add-ons are revisioned in `kitchen_event_add_ons` and immediately appear on the Kitchen dashboard.
- Staff can add or change food in Event Add-Ons. Kitchen staff can change readiness/prepped/verified state and staff assignments. Admin can archive events and review source evidence. There is not currently a general food approval, correction, refill-dispatch, pan-size override, or service-time override workflow.
- The existing Tripleseat webhook is idempotent and signature-verified. Vercel Cron currently runs the event-plan synchronization once daily. There is no durable job queue.

## New workflow

1. Tripleseat remains the source for event identity, status, schedule, guest count, contracted food, documents, and rooms.
2. The existing kitchen generator produces operational food rows. A new server-only normalizer projects those rows into versioned Event Food requests without recalculating kitchen rules.
3. Event Host stores each request and a transactional outbox dispatch in one database transaction. A unique idempotency key prevents duplicate tickets.
4. Contract food is scheduled for its prep-due time. Approved add-ons, VIP food, refills, and corrections enqueue immediately.
5. A server-side worker claims due outbox records. In dry-run mode it stores a sanitized payload preview and never calls GoTab ordering APIs.
6. When both safety switches explicitly allow it, the worker submits a documented payment-free $0 catalog order to the dedicated Event Food spot/customer and saves returned GoTab identifiers. Signed webhooks or order reconciliation provide later confirmation.

## Database changes

The migration adds:

- `event_food_product_mappings`: canonical keys, aliases, GoTab product UUIDs, pan behavior, station assignment, and verification state.
- `event_food_requests`: normalized contracted food, add-ons, VIP add-ons, refills, corrections, and cancellations.
- `event_food_dispatches`: durable outbox records with unique idempotency keys, scheduling, retry state, sanitized previews, and GoTab identifiers.
- `event_food_audit_log`: immutable user/reason/before/after history.
- `gotab_webhook_receipts`: signature-verified delivery deduplication.
- `gotab_integration_status`: one sanitized capability snapshot; no credentials or tokens.

All tables use RLS, deny browser roles, and grant access only to the service role.

## GoTab integration constraints

- Payment information is completely out of scope. Event Host must never read, store, log, display, transmit, authorize, capture, refund, or otherwise use any GoTab payment method or payment data.
- Event Food dispatch may use only verified $0 catalog products and the dedicated internal Event Food customer. It must never use a guest customer, guest tab, guest phone number, or guest payment instrument.

The implementation uses only documented public interfaces:

- Client Credentials: `POST https://gotab.io/api/oauth/token` with `api_access_id`, `api_access_secret`, and `grant_type=client_credentials`.
- Authorized locations: `GET https://gotab.io/api/loc`; the configured UUID must match exactly and the first result is never selected implicitly.
- Catalog reads: `POST https://gotab.io/api/graph`, using the documented location/menu/category/product query shapes.
- Menu read: `GET https://gotab.io/api/loc/{locationUuid}/menus`.
- Ordering: `POST https://api.gotab.io/loc/{locationUuid}/tabs` with `openTab=false`, the dedicated spot/customer, verified catalog products, and no payment object when the $0 balance is already zero.
- Webhooks: raw-body HMAC-SHA256 verification against `X-GoTab-Signature`.

The integration uses a separate closed $0 tab for each dispatch batch because GoTab's guide states that the public API currently supports closed tabs while examples also discuss open tabs. Each request uses Event Host's stable idempotency key as its external reference. The system never invents a payment and cannot create an order while the kill switch is disabled or dry-run mode is enabled.

## Product mapping and provisioning

- Mapping is by canonical key plus explicit aliases, never by display-name equality alone.
- Missing mappings create visible exceptions and remain unsent.
- The initial catalog manifest is generated from Event Host’s existing food/add-on rules with proposed separate half-pan/full-pan products where a pan applies.
- Catalog writes are not attempted until the credentials demonstrate a supported public write endpoint and an administrator approves the manifest. If writes are unavailable, staff provisions through GoTab Manager and records the resulting UUIDs.
- Provisioning must match canonical key plus stored UUID and must never modify unrelated catalog entries.

## KDS routing

- Expo receives full event context.
- Each food product maps to exactly one prep station: Fryer, Grill, Cold Prep, or Expo fallback.
- The dedicated Event Food spot is responsible for routing into the Event Kitchen station group.
- Separate pan-size products are preferred until modifier visibility is physically confirmed on Expo, Fryer, and Grill.
- Device configuration and routing remain a physical acceptance step; API success alone is not acceptance.

## Scheduling and corrections

- Service-time priority: Event Host override → structured Tripleseat service time → itinerary time → event start minus configured lead minutes.
- Timestamps are stored in UTC and displayed in `America/New_York`.
- Unsent event changes update/reschedule the same source version. A sent reduction, product change, or pan change creates a visible correction request rather than silently changing kitchen work.
- Event cancellation cancels unsent dispatches and flags sent dispatches for human review.

## Retry, reconciliation, and duplicate prevention

- Idempotency format: `{eventId}:{sourceType}:{sourceRecordId}:{sourceVersion}:{action}` with a unique database constraint.
- Separate refill button presses use distinct source record IDs and are never collapsed.
- Temporary timeouts, 429 responses, and server failures use bounded exponential backoff and respect `Retry-After`.
- Authentication, mapping, pan, quantity, spot, station, and signature failures are permanent until configuration changes.
- Reconciliation claims due/failed outbox records, checks known GoTab identifiers before retrying uncertain sends, refreshes upcoming Tripleseat events, and detects unconfirmed dispatches.

## Rollout and rollback

1. Phase 1: `EVENT_KDS_ENABLED=false`, `EVENT_KDS_DRY_RUN=true`; mapping and payload previews only.
2. Phase 2: one authorized test event and test tickets.
3. Phase 3: physical Expo/Fryer/Grill verification.
4. Phase 4: one monitored real event with the existing Kitchen dashboard as the manual backup.
5. Phase 5: controlled general enablement.

Rollback is immediate: set `EVENT_KDS_ENABLED=false`. This stops new dispatch claims without removing Event Host food data or the current Kitchen dashboard. Do not delete dispatch/audit rows. Any already-sent ticket is handled with an explicit correction and staff communication.

## Outstanding acceptance gates

- Rotated credentials stored directly in Vercel.
- Exact location, spot, internal customer, catalog, station, and station-group capability checks.
- Complete product mapping and approved provisioning manifest.
- Authorized test confirmation that the documented payment-free $0 order is accepted at the Event Food spot, plus duplicate lookup verification.
- Database migration applied and validated in the target Supabase project.
- Authorized real test ticket visually verified on Expo, Fryer, Grill, and Cold Prep when present.
