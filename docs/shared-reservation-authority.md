# Shared reservation authority: disabled foundation

Migration `20261013182233_shared_reservation_authority.sql` adds a private claim
ledger and service-only claim/read-back RPCs. It does not import existing bookings,
change any application writer, publish source checkpoints or enable live claims.
`control.enabled`, `control.baseline_ready` and every writer flag default to
false. Keep them false until the cutover below is implemented and verified.

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
replaced. No automatic compensation cancels a booking.

The caller must retain its operation key before dispatch, read back an uncertain
result with the identical request, and verify local/provider updates before
confirming to the guest. Never retry uncertainty with a new key. The Final Call
workspace has a bounded server client and lost-response tests; its live runtime
still uses the unconfigured booking adapter.

## Required cutover work

1. Verify the target database, deployed schema, and complete authenticated source
   envelopes. Establish a reviewed mapping from existing event/allocation/booking
   IDs to claims. Deduplicate VIP/imported echoes; a buyout must retain its event
   identity and cover its own allocations without creating conflicting duplicates.
2. Build a resumable baseline importer and checkpoint publisher. Cover existing
   event/manual reservations, REX bookings and unexpired checkout holds, and
   Waitlist active sessions/physical occupancy. Persist source revisions and exact
   import ownership. Refresh failures must clear completeness or let checkpoints
   expire; a mirror download must never refresh the upstream clock.
3. Route every capacity mutation through the authority. Event Host includes
   `saveSync`, `saveContractEvidence`, manual create/edit/clear/restore and both
   scheduled and on-demand synchronization. REX includes ordinary/checkout/staff
   creation, customer modifications, paid replacement, rescheduling, check-in,
   kiosk extensions, live room transfer, expiry and cancellation. Remove its
   missing-RPC ordinary-write fallbacks when shared protection is required.
   Waitlist includes `resource-sessions.ts` start/extension/end and the actual
   bowling/darts selling and equipment-control paths; a queue status alone is
   not an occupancy claim.
4. Implement explicit owned release, checkout conversion, and multi-group event
   changes as transactionally verified operations. The current primitive replaces
   one same-kind claim with one final group; it is not a complete booking lifecycle.
   Claims must remain conservative if a downstream database/provider write fails.
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
expiry, catalog expansion, buffers and database privileges. PGlite queues calls;
it does not prove separate-connection PostgreSQL lock contention. No production
migration, baseline import, real reservation or writer cutover has been performed.

Live Event Host verification currently needs access to Vercel team
`tina-marketing4464` and Supabase project `tmnstuthbllnoqgepotn`.
