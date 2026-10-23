import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMigrationReview, reviewMigrationHistory } from './review-migration-history.mjs';

const local = (sql = 'select 1;', version = '20260101120000') => [
  { filename: `${version}_fixture.sql`, sql },
];
const remote = (statements = ['select 1;'], version = '20260101120000') => [
  { version, statements },
];
const finding = (files, history) => reviewMigrationHistory(files, history).comparisons[0].finding;
const folders = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe('offline migration history review', () => {
  it('recognizes outer-trimmed exact text without granting permission to apply', () => {
    const report = reviewMigrationHistory(local('\n select 1; \n'), remote());
    expect(report.comparisons[0].finding).toBe('same_version_same_text');
    expect(report).toMatchObject({
      status: 'review_required',
      databaseContacted: false,
      mayApply: false,
    });
  });
  it('reports another recorded version without inventing a rename or repair', () => {
    expect(finding(local(), remote(['select 1;'], '20260101130000'))).toBe(
      'text_match_other_version',
    );
  });
  it('keeps same-version different text visible even if another version matches', () => {
    expect(
      finding(local(), [...remote(['select 2;']), ...remote(['select 1;'], '20260101130000')]),
    ).toBe('same_version_different_text');
  });
  it('never strips comments, quoted whitespace or transaction wrappers', () => {
    for (const sql of ['-- audited\nselect 1;', 'begin;\nselect 1;\ncommit;', 'select  1;']) {
      expect(finding(local(sql), remote())).toBe('same_version_different_text');
    }
    expect(finding(local("select 'a  b';"), remote(["select 'a b';"]))).toBe(
      'same_version_different_text',
    );
  });
  it('preserves statement order and never parses semicolons inside dollar-quoted bodies', () => {
    const statements = ['do $$ begin perform 1; perform 2; end $$;', 'select 3;'];
    expect(finding(local(statements.join('\n')), remote(statements))).toBe(
      'same_version_same_text',
    );
    expect(finding(local(statements.join('\n')), remote([...statements].reverse()))).toBe(
      'same_version_different_text',
    );
  });
  it('leaves split and combined migrations for semantic review', () => {
    expect(
      finding(local('select 1;\nselect 2;'), [
        ...remote(),
        ...remote(['select 2;'], '20260101130000'),
      ]),
    ).toBe('same_version_different_text');
  });
  it('reports missing statements and ambiguous matches conservatively', () => {
    for (const statements of [null, [], [' \n']])
      expect(finding(local(), remote(statements))).toBe('same_version_text_unavailable');
    expect(finding(local(), [...remote(), ...remote(['select 1;'], '20260101130000')])).toBe(
      'ambiguous_text_matches',
    );
    expect(finding(local(), [])).toBe('no_text_match');
  });
  it('rejects duplicate versions, malformed records, unsupported files and empty SQL', () => {
    for (const rows of [
      [...remote(), ...remote()],
      [{ version: 20260101120000, statements: [] }],
      [{ version: '20260101120000', statements: [null] }],
      [{ version: '20260101120000' }],
      [{ version: '20260101120000', statements: [], unexpected: 'private-value' }],
    ]) {
      expect(() => reviewMigrationHistory(local(), rows)).toThrow(
        'Invalid migration review input.',
      );
    }
    for (const files of [
      [...local(), ...local()],
      local(''),
      [{ filename: '../secret.sql', sql: 'secret' }],
      [],
    ]) {
      expect(() => reviewMigrationHistory(files, remote())).toThrow(
        'Invalid migration review input.',
      );
    }
  });
  it('accepts the existing eight-digit legacy version and hashes all inputs deterministically', () => {
    const files = [...local('select 2;', '20260625'), ...local()];
    const history = [...remote(), ...remote(['select 2;'], '20260625')];
    const report = reviewMigrationHistory(files, history);
    expect(reviewMigrationHistory([...files].reverse(), [...history].reverse())).toEqual(report);
    expect(
      reviewMigrationHistory(files, [...history, ...remote(["select 'other';"], '20260101140000')])
        .historySnapshotSha256,
    ).not.toBe(report.historySnapshotSha256);
  });
  it('omits SQL, remote names and unrelated remote identities from reports', () => {
    const report = reviewMigrationHistory(local(), [
      ...remote(),
      ...remote(["select 'PRIVATE_OTHER_APP';"], '20251231123456'),
    ]);
    expect(report.remoteRecordsNotTextMatched).toBe(1);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_OTHER_APP|20251231123456|select 1/);
  });
  it('reads local files, rejects symlinks, and keeps parse failures out of CLI output', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'migration-review-'));
    folders.push(folder);
    const migrations = join(folder, 'migrations');
    await mkdir(migrations);
    const history = join(folder, 'history.json');
    await writeFile(history, JSON.stringify(remote()));
    const filename = local()[0].filename;
    await writeFile(join(migrations, filename), local()[0].sql);
    expect((await readMigrationReview(history, migrations)).localFileCount).toBe(1);
    await symlink(join(migrations, filename), join(migrations, '20260101130000_link.sql'));
    await expect(readMigrationReview(history, migrations)).rejects.toThrow();
    await writeFile(history, 'PRIVATE_BROKEN_JSON');
    const cli = fileURLToPath(new URL('./review-migration-history.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, history], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('PRIVATE_BROKEN_JSON');
    expect(result.stderr).not.toContain(folder);
  });
  it('runs the CLI against the complete repository without modifying history or migrations', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'migration-review-cli-'));
    folders.push(folder);
    const history = join(folder, 'history.json');
    const input = JSON.stringify(remote());
    await writeFile(history, input);
    const cli = fileURLToPath(new URL('./review-migration-history.mjs', import.meta.url));
    const report = JSON.parse(execFileSync(process.execPath, [cli, history], { encoding: 'utf8' }));
    const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
      .filter((name) => name.endsWith('.sql')).sort();
    expect(report.localFileCount).toBe(migrations.length);
    expect(report.comparisons.map((entry) => entry.filename).sort()).toEqual(migrations);
    expect(migrations).toEqual(expect.arrayContaining([
      '20261021183041_staff_workflow_revision_safety.sql',
      '20261021183254_staff_workflow_write_cutover.sql',
    ]));
    expect(report.mayApply).toBe(false);
    expect(await readFile(history, 'utf8')).toBe(input);
  });
  it('exports real PostgreSQL history as private JSON in a read-only transaction with rollback', async () => {
    const db = new PGlite();
    try {
      await db.exec(
        'create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);',
      );
      await db.query('insert into supabase_migrations.schema_migrations values ($1, $2, $3)', [
        '20260101120000',
        ['select 1;'],
        'PRIVATE_NAME',
      ]);
      const sql = await readFile(
        new URL('./sql/final-call-migration-history-export.sql', import.meta.url),
        'utf8',
      );
      const rows = (await db.exec(sql)).flatMap((result) => result.rows);
      expect(rows).toEqual([{ history_json: remote() }]);
      expect(finding(local(), rows[0].history_json)).toBe('same_version_same_text');
      // A later injected write must fail under the actual transaction mode.
      await expect(
        db.exec(
          sql.replace('rollback;', 'delete from supabase_migrations.schema_migrations; rollback;'),
        ),
      ).rejects.toThrow(/read-only/);
      await db.exec('rollback;');
      expect(
        (await db.query('select count(*)::int as count from supabase_migrations.schema_migrations'))
          .rows,
      ).toEqual([{ count: 1 }]);
    } finally {
      await db.close();
    }
  });
});
