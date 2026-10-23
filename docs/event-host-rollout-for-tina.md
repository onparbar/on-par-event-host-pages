# Event Host: Tina's access and migration steps

Updated October 23, 2026. Carlos selected the GitHub workflow with **no additional
paid Vercel seat**. This document covers the source evidence change in
[PR #3](https://github.com/onparbar/on-par-event-host-pages/pull/3).
It does not activate shared reservation protection or change a reservation.

## Current hold points — October 23

Both Carlos accounts now have Vercel Viewer access. Database access remains an
owner decision; the owner-operated path is available. The combined candidate's
October 20 Git preview attempt was rejected with a permission error. Viewer
access is not evidence of permission to create a deployment. Tina must use an
already-authorized owner workflow or resolve the specific permission issue;
do not add a paid seat or alter commit attribution to bypass it.
Tina's authenticated CLI
inspection reports six passing preflight rows, but substantial historical
migration/version drift. **Do not run the apply step below until the exact
canonical history/adoption manifest has been reviewed and owner-authorized and
a fresh dry run lists only the source migration.** Preserve the original 15 remote
history records plus the two October 21 staff-workflow records
(`20261021183041` and `20261021183254`), the current Mini Golf constraint extension and current Food
Runner assignments. Current effects of unrecorded operational files do not
prove past execution. Do not replay mapping upserts or superseded backfills,
blanket-mark versions applied, or conceal drift with a reduced manifest.
Keep other applications' SQL and private audit data out of this public repo.

The [private migration-history comparison helper](migration-history-review.md)
can fingerprint the full local inventory against an existing owner audit or a
read-only history export. It makes no database connection or repair and always
requires review. Its report helps prepare the exact manifest; it does not
establish schema equivalence or replace the source-only dry run.

The source candidate now incorporates operations through `afcbada`, preserving
the floor-plan, kitchen, itinerary and revision-safe staff workflow changes from
`ef6e45f`, the October 22 platter calculations and contract-order replay guard
from `1bcc612`, and the legacy duplicate-contract guard from `be9a129`.
The October 23 `c6268a3` release adds scoped staff refill dispatch, exact-order status
polling and checklist completion using the existing BWA field. Food Runner
`8263040` and the earlier operations lineage are preserved.
The subsequent `5f2f041` workspace release adds event-scoped navigation, manual
staff POC, shared task/activity/reminder evidence, request notes and operating
timelines using the existing checked-save records. It preserves source/revision
checks, seating-only buffers and untimed Mini Golf; no migration was added.
The subsequent `afcbada` release preserves visual refresh `2181e97`, corrects
canonical package-label parsing and adds fresh staff confirmation for otherwise
complete checklists with contract warnings. Required critical tasks still block
closeout; the server records current warnings for Admin without clearing source
review flags. Existing GoTab and floor-plan checked-save runtime is preserved.
Tina acknowledged the source handoff and Waitlist diagnostic in
[comment 6351700367](https://github.com/onparbar/on-par-event-host-pages/pull/3#issuecomment-6351700367).
Her operations release does not resolve the source adoption manifest, source-only
dry run or authorized Preview of this combined candidate; those remain required.
The local inventory contains 20 migrations; export the full current remote history
and compare all local files rather than assuming the older count is current.
Tina reported the October 23 operations promotion in
[comment 6373119796](https://github.com/onparbar/on-par-event-host-pages/pull/3#issuecomment-6373119796),
following her separate staff-access decision and operations Preview checks.
An independent October 23 configuration-only release check confirms `afcbada`
as production, the intended database target, and live Tripleseat/GoTab modes.
This is configuration evidence, not source-migration or live-data acceptance.
The operations Preview for `afcbada` does not contain this combined source
candidate. Physical KDS receipt and live multi-device staff actions remain owner
validation; older task evidence without source fingerprints cannot be matched
retrospectively to a historical contract revision. No such acceptance is claimed
by the local combined tests. No food was submitted or replayed for this handoff.
Vercel Production tracks `main`; PR #3 targets
`codex/event-host-dashboard-deploy`, which has diverged from `main`. A reviewed
release path and explicit production approval are still required. Do not
retarget the PR, change branch tracking or promote an older preview as a shortcut.

The new authenticated runtime endpoint in section 4 can verify configuration
before any database migration. It performs no database or upstream request.
It does not prove database connectivity, installed migrations, live source
completeness or shared booking protection.

Carlos clarified that Mini Golf has **no capacity cap**. Preserve its open-play
behavior for Level Up, Wild Axe and Great Escape; do not model the courses as
three exclusive booking slots, impose a player limit, or derive a limit from
the approximate 800-person description. Mini Golf remains visible as an
uncapped entertainment item, separate from the 29 finite reservable resources.
This does not change the existing whole-venue buyout rules. No capacity-policy
decision is outstanding for Mini Golf and no source-only migration change is
needed for this clarification.

Carlos approved Tina’s seating-only buffers on October 22. Entertainment, including
karaoke and VIP rooms, allows back-to-back bookings; actual overlaps remain blocked.
Seating retains 60-minute setup and 30-minute cleanup. The separate shared authority
PR carries this policy in a new migration and remains disabled until acceptance.

## 1. Give Carlos free Vercel visibility

1. Sign in to Vercel and select team **`tina-marketing4464`**.
2. Open **Settings → Members**.
3. Invite **Carlos's existing Vercel account email** (provided privately) with
   **Viewer / Viewer Pro** selected.
   Do not select Member, Developer, or a paid upgrade for this workflow.
4. Carlos accepts the invitation. If a draft invitation is still on screen,
   change its selected role to Viewer before sending it.
5. Open the team's **eventhost** project. Confirm its connected repository is
   **`onparbar/on-par-event-host-pages`**.
6. In **Settings → Environments → Production → Branch Tracking**, confirm which
   branch publishes production. PR #3 currently targets
   **`codex/event-host-dashboard-deploy`**. Report the actual value if different;
   do not change branch tracking to make it match this document.

The repository is already public and Carlos already has GitHub write access.
Vercel built earlier source commits successfully, but the October 20 combined
candidate's preview was denied by deployment permissions. No additional GitHub
invitation is needed to prepare source changes. An authorized owner must handle
the current preview blocker; Viewer access does not establish deployment or
hosting-setting permission. Tina retains those actions.
If Vercel protects a preview, use the Viewer login or its supported sharing flow;
do not disable deployment protection.

## 2. Choose who will perform the database migration

The Event Host Supabase project is **`tmnstuthbllnoqgepotn`**:
[open the project](https://supabase.com/dashboard/project/tmnstuthbllnoqgepotn).
Carlos's connected Supabase account currently cannot see it.

**To let Carlos's assistant finish the database work:**

1. In Supabase, open the organization containing that project, then its
   **Team / Members** settings.
2. Invite **Carlos's Supabase account email** (provided privately) as **Developer**.
3. If the current plan offers project-scoped roles, restrict access to this
   Event Host project. Project-scoped roles are available on Team/Enterprise;
   Free/Pro organization roles cover every project in that organization.
4. If that broader scope is unsuitable, keep the existing plan and use the
   owner-operated migration below instead. Do not upgrade just for this task.
5. Carlos accepts the invitation within 24 hours while signed in to the invited
   Supabase account. The connected tool must then list this exact project before
   any migration is attempted. If the dashboard works but the connector does
   not, Carlos can reconnect the Supabase integration to that invited account.

Alternatively, Tina or the existing database administrator can run section 3.
No database password, service key, or API token should be pasted into chat or
GitHub. Use the provider's login flow and local password prompt if requested.

## 3. Apply only the source evidence migration

The exact migration is
[`20261013181916_final_call_interval_evidence.sql`](../supabase/migrations/20261013181916_final_call_interval_evidence.sql).
It adds the append-only receipt table, service-only interval RPC and three
indexes. Existing booking records are not updated. Index creation can briefly
lock existing schedule tables; use a quiet period and confirm the project's
existing backup/recovery status before applying it.

**Do not apply `20261013182233_shared_reservation_authority.sql` or merge PR #4
as part of this procedure.** That work still needs writer integration and live
concurrency acceptance.

### Prepare a fresh checkout

These commands are for Tina or her technical assistant's terminal. They use a
pinned Supabase CLI version whose flags were checked for this handoff. Run them
one section at a time; check the stated result before advancing.

```sh
git clone --single-branch --branch codex/final-call-source-evidence https://github.com/onparbar/on-par-event-host-pages.git eventhost-source-rollout
cd eventhost-source-rollout
git rev-parse HEAD
npx --yes supabase@2.119.0 init
npx --yes supabase@2.119.0 login
npx --yes supabase@2.119.0 link --project-ref tmnstuthbllnoqgepotn
```

The repository has migrations but no CLI config; `init` creates a local config in
this fresh checkout. Do not commit that generated configuration. Compare the
checked-out SHA to PR #3's latest commit before proceeding.

In Vercel, Tina must separately confirm that the **Preview** deployment being
tested uses `SUPABASE_URL=https://tmnstuthbllnoqgepotn.supabase.co` (or the source's
same default when that variable is absent). If Preview intentionally uses a
different database, stop and identify that project first. Do not copy production
credentials into a different environment just to make a test pass.

### Run read-only checks and inspect migration history

```sh
npx --yes supabase@2.119.0 db query --linked --project-ref tmnstuthbllnoqgepotn --file scripts/sql/final-call-interval-preflight.sql
npx --yes supabase@2.119.0 migration list --project-ref tmnstuthbllnoqgepotn
npx --yes supabase@2.119.0 db push --project-ref tmnstuthbllnoqgepotn --dry-run --skip-vault
```

Expected: all **six preflight rows say PASS**, and the dry run proposes only
`20261013181916_final_call_interval_evidence.sql`.

If a preflight row says STOP, an older migration is pending, history is out of
sync, or the dry run lists the shared authority migration, stop and return that
output. Do not use `--include-all`, reset the database, remove migration history,
or rerun older schema files. If the source objects already exist, run the
verification below and reconcile history before attempting another migration.

### Apply and verify

Only after the preceding checks pass and the owner approves the exact source
migration/reconciliation on the verified target:

```sh
npx --yes supabase@2.119.0 db push --project-ref tmnstuthbllnoqgepotn --skip-vault
npx --yes supabase@2.119.0 migration list --project-ref tmnstuthbllnoqgepotn
npx --yes supabase@2.119.0 db query --linked --project-ref tmnstuthbllnoqgepotn --file scripts/sql/final-call-interval-verify.sql
```

Confirm migration **`20261013181916`** is recorded remotely and all **seven
verification rows say PASS**. Then run:

```sh
npx --yes supabase@2.119.0 db query --linked --project-ref tmnstuthbllnoqgepotn --file scripts/sql/final-call-interval-smoke.sql
npx --yes supabase@2.119.0 db advisors --project-ref tmnstuthbllnoqgepotn --type security
```

Expected smoke result: `service_interval_read = PASS`. Submit the entire smoke
file together; an invalid response or permission error must stop the operation.
The checks are read-only and return no guest
names or raw event payloads. Report any advisor findings for the new receipt
table or RPC; unrelated existing findings are separate work.

The SQL check files can also be opened on GitHub, copied with **Raw**, and run in
this project's **SQL Editor**. Use the CLI for the migration itself so Supabase
records migration history. Do not paste the migration into SQL Editor as an
untracked shortcut. A successful CLI command alone is not proof that every
PASS/STOP row passed; inspect the returned rows.

## 4. Verify the preview before releasing through GitHub

### Configuration-only check, before source acceptance

The combined candidate exposes `GET /api/entertainment-schedule/runtime` with
the existing Bearer service authentication. It reports only the resolved
Supabase project ref, whether a database credential is configured, effective
Tripleseat live/mock selection, deployment environment and full Git SHA. The
database URL resolver and live/mock selector are shared with the actual clients.
There are no database reads/writes, snapshot syncs, upstream calls or receipts.
Unknown/custom database URLs and unknown deployment identities fail verification.

From the **Final Call workspace**, run:

```sh
npm run event-host:runtime -- https://VERIFIED-IMMUTABLE-PREVIEW-HOST tmnstuthbllnoqgepotn FULL_40_CHARACTER_PREVIEW_COMMIT
```

Provision the existing matching `ENTERTAINMENT_SCHEDULE_API_TOKEN` into the
consumer's process environment as `EVENT_HOST_SCHEDULE_API_TOKEN` through an
approved secret manager/environment loader. These scripts do not automatically
load an env file. Never place credentials in arguments, comments, logs or email.
Do not rotate or replace an unavailable token simply to run a test.

Preview protection is separate from service authentication. Where existing
Vercel project permissions allow Trusted Sources access, supply a short-lived
Event Host project OIDC token as `EVENT_HOST_PREVIEW_OIDC_TOKEN` and its exact
canonical preview origin as `EVENT_HOST_PREVIEW_ORIGIN`. Both must be present.
The consumer sends `x-vercel-trusted-oidc-idp-token` only to that bound preview;
it refuses a different preview, production, or redirects. It never implicitly
uses a Final Call project's ambient OIDC token. A Chrome Viewer session alone
does not authenticate this command. Keep Deployment Protection enabled; the
owner can alternatively use supported authenticated CLI transport to inspect
the same endpoint securely.

Require the expected database ref, full commit, Preview environment, configured
credential and live adapter selection. `configurationVerified: true` proves
only those settings for that candidate, never database access or available
inventory; `availability` remains `unknown`.

### Source acceptance and release

1. Open PR #3's **Vercel** check and select the latest Ready preview for its exact
   commit. Give Carlos the ordinary deployment/preview URL and commit SHA.
2. Tina checks that existing server-side settings are present in the intended
   environment: the entertainment service token, Supabase secret/service role
   credential, and live Tripleseat connection/location. Confirm presence and
   scope only; do not copy values into chat. The interval read requires live
   Tripleseat mode, not mock mode. Reuse the established integration credentials.
3. After migration verification and approval for receipt-producing acceptance,
   Carlos runs the prepared local diagnostic against that preview using the
   existing service token supplied securely. It uses the same process environment
   and optional origin-bound Preview authentication described above. The command accepts an optional
   third argument for the verified Event Host preview origin:

   ```sh
   npm run event-host:inspect -- YYYY-MM-DD YYYY-MM-DD https://VERIFIED-EVENTHOST-PREVIEW-HOST
   ```

   This command runs from the **Final Call workspace**, not this Event Host
   checkout. Replace the dates and preview origin with the verified test target.
   It accepts only the known production host or Event Host preview hosts within
   Tina's team. A protected-preview response is not an application test result;
   use authenticated testing rather than turning protection off.

4. Confirm version 2, complete interval/buyout/snapshot coverage, valid original
   timestamps, receipt ID/revision, and no unexplained review issues. Compare a
   real event spanning the start of the requested window, a Tentative buyout
   without allocation rows, and an empty interval with Tripleseat. If a needed
   example does not exist, use an approved test environment; do not invent or
   modify a real booking to manufacture a passing result.
5. A successful interval request persists an evidence receipt but never changes
   reservations. `availability: unknown` remains the correct result until the
   separate shared-protection work is complete. Failure/staleness and receipt
   failures must be tested in an isolated environment, without breaking the live
   integration. Review/resynchronize old saved allocations through the normal
   staff workflow only when an actual mismatch has been identified.
6. After database, preview and mirror acceptance, obtain the reviewed release
   plan and explicit owner approval. The PR target currently differs from the
   tracked production branch; merging this PR alone is not a verified production
   release procedure. Preserve the latest operations lineage, validate the exact
   release SHA and redacted contract, then use only the approved deployment path
   and recheck production. Do not merge just because a preview build is green.

Keep the REX and Waitlist `ENTERTAINMENT_INTERVAL_EVIDENCE` flags off until their
mirror checks pass. Those applications must preserve the original receipt,
revision, interval and clocks. Shared claims and guest confirmations stay gated.

## What Tina should return

- Confirmation that the **free Viewer invitation** was sent, and the production
  branch shown in Vercel.
- Either **Supabase Developer invitation sent**, or the migration-list result,
  six preflight PASS rows, seven verification PASS rows, smoke PASS and relevant
  advisor findings.
- The tested **preview URL, deployment commit SHA and Supabase project ref**.
- Dates/IDs of suitable existing spanning-event and Tentative examples, shared
  privately with Carlos rather than in the public GitHub PR. No guest names,
  credentials or raw database exports are needed.

## Recovery and completion

If the migration fails, its explicit transaction rolls back its DDL. Inspect the
actual error and database state before retrying. If application acceptance fails
after migration, leave the additive source objects installed and keep the PR
unmerged/mirror flags off. Do not delete receipts or roll back unrelated tables.

Event Host completeness is complete only when the verified deployment uses the
verified migration, real source examples pass, review issues are resolved, and
both mirrors preserve the evidence. Passing SQL checks and a Ready preview alone
do not establish that outcome.

References: [Vercel free Viewer seats](https://vercel.com/docs/plans/pro-plan#team-seats),
[public repository collaboration](https://vercel.com/docs/deployments/troubleshoot-project-collaboration),
[Supabase roles and invitations](https://supabase.com/docs/guides/platform/access-control),
[migration history and deployment](https://supabase.com/docs/guides/deployment/database-migrations).
