# Shared reservation authority: disabled claim and lifecycle operations

Migration `20261013182233_shared_reservation_authority.sql` adds a private claim
ledger and service-only claim/read-back RPCs. It does not import existing bookings,
change any application writer, publish source checkpoints or enable live claims.
`control.enabled`, `control.baseline_ready` and every writer flag default to
false. Keep them false until the cutover below is implemented and verified.

Migration `20261020175405_shared_reservation_lifecycle.sql` adds atomic multi-group
replacement, owned release and exact checkout-hold conversion. It also leaves
every gate disabled. These are separate from Tina's **source-only** migration
handoff; do not include either shared migration in the source rollout.

## Transaction behavior

`shared_inventory_claim(writer, operation_key, request)` locks one venue control
row in a READ COMMITTED transaction. It verifies the expected ledger revision,
fresh complete checkpoints for Event Host/REX/Waitlist, all writer cutover flags,
the exact final physical resource set, and the ownership of any replaced claims.
Source coverage must include the requested interval plus an hour on each side.
Checkpoints expire after two minutes; they are not automatically created here.

The transaction enforces bowling/dart adjacency, five-room Big Show expansion,
29-unit buyout expansion, one-hour event pre-protection, and a separate 20-minute
room-cleaning constraint. Synthetic Big Show and open-play mini golf are not
additional finite units. Checkout holds use database-clock expiry; ordinary
bookings never expire automatically. Event requests require an approval reference;
the trusted caller remains responsible for verifying the real staff decision.

The result is `secured`, `conflict` or `unknown`. Requests and results are persisted
under `(writer, operation_key)`; service credentials cannot update that operation
history. Reuse with different request data fails. `shared_inventory_operation`
reads the original operation after uncertain acceptance. Both duplicate claims
and read-back return unknown if the secured claim has since expired or been
replaced. The lifecycle migration additionally verifies exact resources, times,
expiry, writer, owner, event and kind on read-back and v1 retries. No automatic
compensation cancels a booking.

The caller must retain its operation key before dispatch, read back an uncertain
result with the identical request, and verify local/provider updates before
confirming to the guest. Never retry uncertainty with a new key. The Final Call
workspace has a bounded server client and lost-response tests; its live runtime
still uses the unconfigured booking adapter.

## Lifecycle API

`shared_inventory_mutate(writer, operation_key, request)` accepts:

```json
{
  "action": "replace",
  "ownerReference": "original-source-booking-id",
  "eventId": "original-event-id",
  "kind": "event",
  "approvalReference": "verified-staff-decision-id",
  "expectedRevision": 12,
  "sourceRevisions": {"event-host":"original-r1","rexreplace":"original-r2","waitlist":"original-r3"},
  "replaceClaimIds": ["exact-owned-claim-uuid"],
  "claims": [
    {"group":"bowling","resourceIds":["bowling-3","bowling-4"],"startsAt":"2026-11-01T20:00:00Z","endsAt":"2026-11-01T21:00:00Z"},
    {"group":"darts","resourceIds":["darts-1"],"startsAt":"2026-11-01T20:00:00Z","endsAt":"2026-11-01T21:00:00Z"}
  ]
}
```

- `replace` installs the whole final set or changes nothing. Every original must
  belong to the same writer/owner/event/kind. A later conflict, source loss or
  invalid group rolls back all interim releases, claims and child receipts.
- `release` requires a nonempty original set, an empty `claims` array and a
  `confirmationReference`. The trusted server must verify the source cancellation
  or session end **before** releasing. Stale source checkpoints do not prevent
  this explicit owned release; cutover and expected revision still apply.
- `convert` requires exactly one live owned checkout hold, one final
  `room-booking` claim, and a `confirmationReference` to the verified payment.
  Resources, event identity and interval must remain exact. It creates a durable
  non-expiring booking and deactivates the hold within the venue lock.

An `applied` result contains `action`, final `revision`, ordered `claims` receipts,
and `releasedClaimIds`. Revision advances once per new claim, or once for a
release-only operation. The whole change is one transaction. Read-back uses
`shared_inventory_operation` with the original writer/key/request; a later
release, replacement or expiry invalidates the old success receipt.

References are evidence identifiers, not authorization by themselves. The
trusted application must validate staff decisions, payments and cancellations.
`service_role` can still directly alter private tables, so installing these RPCs
does not establish a least-privilege writer boundary or prevent existing bypasses.

Final Call now has a tested durable operation journal: it commits exact intent
before dispatch, rejects key reuse with different data, and only reads back
after a restart or duplicate call. A crash before send remains a reconciliation
case; even `operation_not_found` never triggers an automatic new write. Its
separate local migration has not been applied to the hosted Final Call database.

## Required cutover work

1. Verify the target database, deployed schema, and complete authenticated source
   envelopes. Establish a reviewed mapping from existing event/allocation/booking
   IDs to claims. Deduplicate VIP/imported echoes; a buyout must retain its event
   identity and cover its own allocations without creating conflicting duplicates.
2. Build a resumable baseline importer and checkpoint publisher after reviewing
   the actual identities. Final Call's `npm run inventory:baseline -- input.json`
   now creates an offline review manifest with explicit ownership, verified-mirror
   deduplication, Tentative-buyout absorption, original clocks, expired-hold
   exclusions and overlap findings. It performs no import and cannot establish
   live completeness. Cover existing
   event/manual reservations, REX bookings and unexpired checkout holds, and
   Waitlist active sessions/physical occupancy. Persist source revisions and exact
   import ownership. Refresh failures must clear completeness or let checkpoints
   expire; a mirror download must never refresh the upstream clock.
3. Route every capacity mutation through the authority. Event Host includes
   `saveSync`, `saveContractEvidence`, manual create/edit/clear/restore and both
   scheduled and on-demand synchronization. REX includes ordinary/checkout/staff
   creation, customer modifications, paid replacement, rescheduling, check-in,
   kiosk extensions, live room transfer, expiry and cancellation. Remove its
   missing-RPC ordinary-write fallbacks. The companion REX
   `codex/booking-write-fail-closed` change removes create, move and paid-replacement
   fallbacks; it does not route those operations through this shared authority.
   Waitlist includes `resource-sessions.ts` start/extension/end and the actual
   bowling/darts selling and equipment-control paths; a queue status alone is
   not an occupancy claim.
4. Wire the now-tested release, conversion and multi-group operations into each
   application's actual lifecycle. Claims must remain conservative if a downstream database/provider write fails.
   Staff need a durable reconciliation record and tooling for partial outcomes.
5. Prevent legacy writers from bypassing the authority. Service-role credentials
   are trusted and bypass RLS; these flags do not prove application routing or
   forbid direct SQL writes. Keep the private schema out of exposed API schemas,
   grant only server-side RPC access, and determine the final server identity
   boundaries before distributing credentials to other applications.
6. On designated test inventory, run competing requests over separate real
   database connections from the actual applications. Prove that only one wins,
   and exercise duplicate calls, expired holds, source loss, changed revisions,
   owned replacement, buyouts, buffer boundaries and failures before/after commit.
   Reconcile the baseline while writers are quiesced, then enable the system only
   after every path is accounted for. Disabling claims is fail-closed; do not fall
   back to the old unprotected writes.

## Local evidence and limitations

The SQL tests apply the actual migrations to PGlite and exercise transactional
claims, idempotency, conflicts, source/cutover gates, replacement ownership,
expiry, catalog expansion, buffers, batch rollback, conversion, cancellation,
exact read-back and database privileges.

`pnpm test:shared-postgres` creates its own throwaway PostgreSQL 18.4 cluster on
loopback, uses four distinct backend connections and destroys it afterward. It
does not accept a database URL or read production credentials. Pinned development
dependencies include the native binary; pnpm allows its symlink setup on macOS
ARM64 and Linux x64. Other platforms may require `pnpm approve-builds`.

Ten real PostgreSQL scenarios prove lock contention, same-key concurrency,
timeout rollback, lost-response recovery, uncommitted invisibility, expiry and
freshness after lock wait, conversion-versus-cancellation, batch rollback and
browser/service privileges. These are local authority tests, **not** proof that
the deployed applications use it or that Tina's schema matches the fixture.
No production migration, baseline import, real reservation or writer cutover has
been performed.

Vercel preview access now works through `carlos@onparbar.com`. Live database
verification still needs Supabase access to `tmnstuthbllnoqgepotn` for
`carloschavando@gmail.com`, plus verified server-side source credentials.
