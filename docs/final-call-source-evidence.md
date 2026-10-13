# Final Call source evidence

The authenticated schedule endpoint keeps its existing reservation projection
and adds `evidence.version=1`. No new credential or database migration is
required. The evidence object omits event names, notes, booking identifiers,
raw errors, environment variable names and raw source snapshots.

## Reading the report

- `generatedAt`: when this response was assembled. Never use it as the source
  synchronization time.
- `days[].sync`: status, start, completion, last successful upstream sync and
  processed event count for the saved operating date. A null value means that
  no synchronization has been established.
- `days[].syncFresh`: successful live sync, valid ordered timestamps, matching
  completion/last-success time and an age between zero and 120 seconds.
- `days[].issues`: safe diagnostic codes for missing configuration, source
  warnings, unhealthy/stale sync, invalid event times, unresolved events or
  allocations and reservation conflicts. Fresh sync timing does not erase
  these issues.
- `days[].events`: stable event identifiers, status, full-buyout flag,
  event interval, source/sync timestamps, review codes and matching allocation
  IDs. Events with no allocation rows remain visible. Every Tentative event is
  marked as a buyout; consumers must block the whole venue for its interval.
- `coverage`: the explicitly requested saved operating dates. Both overlap
  completeness and historical buyout completeness are **false** in version 1.

The entertainment Tripleseat search now rejects missing/unstable pagination,
missing or repeated IDs, unexpectedly empty pages and failed status fallbacks.
An empty unfiltered search checks all fallback statuses; finding a Definite
event does not skip Tentative results. Saved database reads now traverse exact
counts with stable ordering and reject missing pages, duplicate identities or
changing totals. These checks detect common truncation failures; separate
paginated HTTP reads are not one atomic database snapshot.

## Remaining availability gates

1. Verify a deployed response against its actual upstream sync record, including
   an upstream failure that leaves the saved schedule visible.
2. Implement and persist proof of interval-overlap coverage, including events
   starting before the requested interval and the required buffers. Current
   syncs search by event start date; merely adding adjacent dates does not prove
   arbitrary multi-day coverage.
3. Resynchronize and verify every Tentative event after deploying the new
   inclusion rule. Existing saved schedules may have omitted such events.
4. Make REX and Waitlist preserve this evidence with the original source times;
   a freshly downloaded mirror must not reset freshness.
5. Add shared atomic reservation claims across every event and walk-in writer
   before any application can promise that additional inventory is secured.

Keep automatic availability and reservation writes disabled until these gates
pass. A fresh diagnostic response alone is not approval to reserve anything.

## Interval contract — October 13, 2026

An authenticated request with `coverage=interval` now selects version 2. The
legacy saved-day response remains the default. Apply migration
`20261013181916_final_call_interval_evidence.sql` before testing this mode.

Version 2 reads Tripleseat with the documented `date_range_start` and
`date_range_end` overlap filters. It retains events whose start precedes the
requested dates, searches the neighboring calendar dates for protection
windows, and includes one hour on each side of the requested Eastern interval.
Calendar boundaries account for 23-hour and 25-hour DST days. Missing or invalid
event times remain visible as review issues; every Tentative event remains a
venue buyout, including those without saved allocations.

Saved events and allocations are read in one invoker SQL function call from one
statement snapshot. It includes overlapping intervals regardless of operating
date, retains uncertain event times, and rejects more than 10,000 records. It
does not synchronize or rewrite any booking. A newly discovered ordinary event,
changed source content, unresolved allocation, orphaned saved event, conflict or
old read produces review issues. The immutable service receipt stores only the
minimal projection, exact interval, original source timestamps and content
revision. Missing receipt storage fails the request rather than returning an
unrecorded or stale success. Browser roles have no RPC or receipt access.

`overlapComplete` describes search coverage, not available inventory. Consumers
must also inspect issues, timestamps, identities and their requested interval.
`availability` remains `unknown`: REX/Waitlist evidence, shared claims and live
acceptance are separate requirements. No mirror or booking writer is enabled by
this opt-in read path. Mirrors must preserve the original receipt and times and
must not truncate spanning reservations by `operatingDate`.

Before rollout: verify the migration and live authenticated read on the intended
Vercel/Supabase projects; compare a spanning event and a Tentative buyout to
Tripleseat; resolve allocation review issues; propagate the contract through
both mirrors. The connected accounts still lack access to Event Host's
`tina-marketing4464` Vercel team and `tmnstuthbllnoqgepotn` Supabase project.
