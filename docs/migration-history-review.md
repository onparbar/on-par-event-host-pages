# Private migration-history comparison

This helper prepares text evidence for Tina's canonical history/adoption review.
It never connects to a database, executes SQL, repairs history, edits migration
files, or decides that a rollout is safe. It reads **every** SQL migration in the
repository's migration directory, including the eight-digit legacy version.
Do not use a reduced directory to conceal drift.

## Owner input

Use the existing private owner audit if it contains the original recorded
`version` and ordered `statements` fields. Otherwise, on the separately verified
Event Host project, the owner can run the entire
[`final-call-migration-history-export.sql`](../scripts/sql/final-call-migration-history-export.sql)
file using existing authenticated access. The query uses a read-only transaction
and rolls back. It reads only migration history, without executing its SQL.

**The export is private:** recorded SQL can contain credentials, seeded data or
other applications' source. Never put the export in GitHub, a chat transcript or
shared build logs. Save only the `history_json` result cell as a UTF-8 JSON array
in an owner-controlled local file. Do not save a CLI table or wrapper object.
The optional repository folder `.private-migration-audit/` is gitignored; the
owner should also restrict local access to the file. Do not change memberships,
grants or credentials simply to run this helper.

The expected shape is:

```json
[{ "version": "20260101120000", "statements": ["select 1;"] }]
```

These are fictional examples, not Event Host history. Null or empty statement
arrays mean the recorded text is unavailable; they never establish equivalence.

From the reviewed source checkout:

```sh
node scripts/review-migration-history.mjs /private/path/history.json
```

The command needs only Node.js and local files. It does not load environment
files or start the application. Exit 0 means a report was generated, **not** that
migrations may be applied. Invalid input exits 1 with a generic message that
does not echo private content. The report always says `review_required` and
`mayApply: false`.

## What the comparison proves

Each local file has a SHA-256 fingerprint and one finding:

| Finding                         | Meaning                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `same_version_same_text`        | A history row has that version and the same compared text.                                   |
| `text_match_other_version`      | One differently numbered history row has the same text; review the canonical representation. |
| `same_version_different_text`   | The version exists but text differs, even if another row matches.                            |
| `same_version_text_unavailable` | The version exists but its recorded text is absent or empty.                                 |
| `ambiguous_text_matches`        | Several history rows have the same text; no automatic mapping is chosen.                     |
| `no_text_match`                 | No exact text match; this does not prove missing schema or justify replay.                   |

The tool joins recorded statements with a newline, trims only outer whitespace,
and preserves statement order, comments, internal whitespace, transaction wrappers
and quoted values. Statement serialization alone may therefore produce a
mismatch. Split/combined migrations and equivalent final schema need manual SQL
and catalog review. Identical recorded SQL is not proof of current schema,
successful historic execution, source freshness, or deployment identity.

The report contains no SQL or remote migration names; unrelated remote versions
are represented by a count rather than listed. It fingerprints the full private
history input and local inventory for comparison across reviews. These hashes
are change detectors, not authentication, completeness or target attestations.
Record the verified target, checkout SHA, capture time and provenance privately;
keep the report private until its contents have been reviewed for sharing.

## Exact manifest still required

Tina's October 20 report identifies 15 remote records and 18 repository files.
Those numbers are reported evidence; Carlos's account cannot yet verify the live
database. The owner should supply a complete proposed manifest for review:

1. Every historical file's proposed canonical path/version, its recorded SQL
   evidence and whether it stays, splits or is represented elsewhere. Preserve
   all 15 actual remote records, including the four other-application records
   whose private SQL must remain outside this public repo.
2. An explicit adoption ledger for the seven unrecorded operational versions:
   `20260806120000`, `20260806160000`, `20260811150000`, `20260812134500`,
   `20260814120000`, `20260831132500`, `20260923130000`. Distinguish observed
   current structural/data effects from historical execution. The old staff
   backfill is superseded; preserve current Food Runner assignments. Do not
   replay mapping upserts or backfills to make filenames line up.
3. Preservation of the live Mini Golf constraint extension and uncapped open
   play, plus any other verified baseline deltas.
4. Exact proposed repository and history operations, with rationale and owner
   authorization recorded separately. The helper generates no repair commands.

After technical review and owner approval of that concrete manifest, recheck the
target and current history/schema. Require a fresh dry run proposing only
`20261013181916_final_call_interval_evidence.sql`. The helper cannot replace that
dry run, the six preflight checks, post-migration checks, or live source acceptance.
Shared booking authority and Waitlist migrations remain separate workstreams.

References: [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations)
and [history repair behavior](https://supabase.com/docs/reference/cli/supabase-migration-repair).
History repair changes records; it is not a schema migration or a harmless
diagnostic, and no repair is authorized by this document.
