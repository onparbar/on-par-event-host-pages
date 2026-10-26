import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const versionPattern = /^(?:\d{8}|\d{14})$/;
const filenamePattern = /^((?:\d{8}|\d{14}))_[a-zA-Z0-9_-]+\.sql$/;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const invalid = () => {
  throw new Error('Invalid migration review input.');
};
const ordered = (a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0);

/** Offline text evidence only. Never executes SQL or authorizes a migration. */
export function reviewMigrationHistory(files, snapshot) {
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.length > 5000 ||
    !Array.isArray(snapshot) ||
    snapshot.length > 5000
  )
    invalid();
  const localVersions = new Set();
  const local = files
    .map((file) => {
      const match = typeof file?.filename === 'string' && filenamePattern.exec(file.filename);
      if (!match || typeof file.sql !== 'string' || !file.sql.trim() || localVersions.has(match[1]))
        invalid();
      localVersions.add(match[1]);
      return { version: match[1], filename: file.filename, textHash: sha256(file.sql.trim()) };
    })
    .sort(ordered);
  const remoteVersions = new Set();
  const remote = snapshot
    .map((row) => {
      if (
        !row ||
        typeof row.version !== 'string' ||
        !versionPattern.test(row.version) ||
        remoteVersions.has(row.version) ||
        !Object.hasOwn(row, 'statements') ||
        Object.keys(row).some((key) => !['version', 'statements'].includes(key)) ||
        (row.statements !== null &&
          (!Array.isArray(row.statements) ||
            row.statements.some((statement) => typeof statement !== 'string')))
      )
        invalid();
      remoteVersions.add(row.version);
      // Preserve order, comments, internal whitespace and quoted literals. Never
      // split on semicolons or guess semantic equivalence of combined migrations.
      const text = row.statements?.join('\n').trim() ?? '';
      return {
        version: row.version,
        textHash: text ? sha256(text) : null,
        statements: row.statements,
      };
    })
    .sort(ordered);
  const matchedRemoteVersions = new Set();
  const comparisons = local.map((file) => {
    const sameVersion = remote.find((row) => row.version === file.version);
    const matches = remote.filter((row) => row.textHash === file.textHash);
    for (const row of matches) matchedRemoteVersions.add(row.version);
    let finding;
    if (sameVersion && sameVersion.textHash === null) finding = 'same_version_text_unavailable';
    else if (sameVersion && sameVersion.textHash !== file.textHash)
      finding = 'same_version_different_text';
    else if (matches.length > 1) finding = 'ambiguous_text_matches';
    else if (sameVersion) finding = 'same_version_same_text';
    else if (matches.length === 1) finding = 'text_match_other_version';
    else finding = 'no_text_match';
    return {
      filename: file.filename,
      localVersion: file.version,
      localTextSha256: file.textHash,
      finding,
      textMatchVersions: matches.map((row) => row.version),
    };
  });
  return {
    formatVersion: 1,
    status: 'review_required',
    databaseContacted: false,
    mayApply: false,
    normalization:
      'local SQL trimmed at outer edges; recorded statement array joined with LF then outer-trimmed; no other normalization',
    localManifestSha256: sha256(JSON.stringify(local)),
    historySnapshotSha256: sha256(
      JSON.stringify(remote.map(({ version, statements }) => ({ version, statements }))),
    ),
    localFileCount: local.length,
    remoteRecordCount: remote.length,
    remoteRecordsWithoutText: remote.filter((row) => row.textHash === null).length,
    remoteRecordsNotTextMatched: remote.filter((row) => !matchedRemoteVersions.has(row.version))
      .length,
    comparisons,
  };
}

async function readBoundedFile(path, maxBytes) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maxBytes) invalid();
  const buffer = await readFile(path);
  if (buffer.length > maxBytes) invalid();
  return buffer.toString('utf8');
}

export async function readMigrationReview(snapshotPath, migrationDirectory) {
  const names = await readdir(migrationDirectory);
  const sqlNames = names.filter((name) => name.toLowerCase().endsWith('.sql'));
  if (sqlNames.some((name) => !filenamePattern.test(name)) || sqlNames.length > 5000) invalid();
  const files = [];
  let totalBytes = 0;
  for (const filename of sqlNames.sort()) {
    const sql = await readBoundedFile(resolve(migrationDirectory, filename), 2 * 1024 * 1024);
    totalBytes += Buffer.byteLength(sql);
    if (totalBytes > 20 * 1024 * 1024) invalid();
    files.push({ filename, sql });
  }
  const snapshot = JSON.parse(await readBoundedFile(snapshotPath, 20 * 1024 * 1024));
  return reviewMigrationHistory(files, snapshot);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/review-migration-history.mjs /private/path/history.json');
    process.exitCode = 1;
  } else {
    try {
      const directory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
      console.log(JSON.stringify(await readMigrationReview(process.argv[2], directory), null, 2));
    } catch {
      // Never echo raw SQL, input content, file paths, or provider errors.
      console.error(
        'Could not produce a migration review. Check the private JSON export and local SQL filenames. No database was contacted.',
      );
      process.exitCode = 1;
    }
  }
}
