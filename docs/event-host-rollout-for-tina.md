# Event Host: Tina's access and migration steps

Prepared October 13, 2026. Carlos selected the GitHub workflow with **no additional
paid Vercel seat**. This document covers the source evidence change in
[PR #3](https://github.com/onparbar/on-par-event-host-pages/pull/3).
It does not activate shared reservation protection or change a reservation.

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
Vercel built its source PR successfully. No additional GitHub invitation or paid
Vercel role is needed to prepare changes and generate Git previews. Viewer
access does not permit editing hosting settings; Tina retains those actions.
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
npx --yes supabase@2.119.0 db query --project-ref tmnstuthbllnoqgepotn --file scripts/sql/final-call-interval-preflight.sql
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

Only after the preceding checks pass:

```sh
npx --yes supabase@2.119.0 db push --project-ref tmnstuthbllnoqgepotn --skip-vault
npx --yes supabase@2.119.0 migration list --project-ref tmnstuthbllnoqgepotn
npx --yes supabase@2.119.0 db query --project-ref tmnstuthbllnoqgepotn --file scripts/sql/final-call-interval-verify.sql
```

Confirm migration **`20261013181916`** is recorded remotely and all **seven
verification rows say PASS**. Then run:

```sh
npx --yes supabase@2.119.0 db query --project-ref tmnstuthbllnoqgepotn --file scripts/sql/final-call-interval-smoke.sql
npx --yes supabase@2.119.0 db advisors --project-ref tmnstuthbllnoqgepotn --type security
```

Expected smoke result: `service_interval_read = PASS`, with event and reservation
counts. Zero counts can be valid. The checks are read-only and return no guest
names or raw event payloads. Report any advisor findings for the new receipt
table or RPC; unrelated existing findings are separate work.

The SQL check files can also be opened on GitHub, copied with **Raw**, and run in
this project's **SQL Editor**. Use the CLI for the migration itself so Supabase
records migration history. Do not paste the migration into SQL Editor as an
untracked shortcut. A successful CLI command alone is not proof that every
PASS/STOP row passed; inspect the returned rows.

## 4. Verify the preview before releasing through GitHub

1. Open PR #3's **Vercel** check and select the latest Ready preview for its exact
   commit. Give Carlos the ordinary deployment/preview URL and commit SHA.
2. Tina checks that existing server-side settings are present in the intended
   environment: the entertainment service token, Supabase secret/service role
   credential, and live Tripleseat connection/location. Confirm presence and
   scope only; do not copy values into chat. The interval read requires live
   Tripleseat mode, not mock mode. Reuse the established integration credentials.
3. Carlos runs the prepared local diagnostic against that preview using the
   existing service token supplied securely. The command accepts an optional
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
6. After database and preview acceptance, approve/merge **PR #3 only** into the
   confirmed production branch. Let the existing Git integration deploy it, then
   confirm the deployed SHA and repeat the source checks on production. If an
   approval or promotion is required by existing Vercel settings, Tina performs
   it. Do not merge just because a preview build is green.

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
